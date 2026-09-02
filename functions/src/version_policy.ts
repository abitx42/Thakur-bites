import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { assertCapability } from './authorization_policy';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface VersionPolicyData {
  latestVersion: string;
  minimumSupportedVersion: string;
  forceUpdate: boolean;
  message?: string;
  releaseNotes?: string[];
  storeUrl?: string;
  updatedAt?: admin.firestore.Timestamp;
  updatedBy?: string;
}

export interface UpdateVersionPolicyRequest {
  platform?: 'android' | 'ios' | 'web' | 'global';
  latestVersion: string;
  minimumSupportedVersion: string;
  forceUpdate?: boolean;
  message?: string;
  releaseNotes?: string[];
  storeUrl?: string;
}

export interface EnforceVersionOptions {
  requireVersion?: boolean;
  failClosedOnDbError?: boolean;
}

// In-memory cache for version policies (TTL 60 seconds) to prevent DoS & fail-open on DB drops
const policyCache = new Map<string, { policy: VersionPolicyData | null; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 1000;

/**
 * Pure semver comparison function (major.minor.patch).
 * Returns:
 *  -1 if v1 < v2
 *   0 if v1 == v2
 *   1 if v1 > v2
 */
export function compareSemver(v1: string, v2: string): number {
  const parse = (v: string) => (v || '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const p1 = parse(v1);
  const p2 = parse(v2);
  for (let i = 0; i < Math.max(p1.length, p2.length, 3); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
  }
  return 0;
}

/**
 * Server-Authoritative Version Policy Enforcer.
 * 
 * Invariants Enforced:
 * 1. Platform-Specific Lookup with Global Fallback: Resolves `platforms/{platform}` first before global.
 * 2. Fail-Closed on Sensitive Endpoints: Requires valid version string if requireVersion is set.
 * 3. Resilient In-Memory Policy Cache: If Firestore read fails, uses cached policy to avoid fail-open posture.
 */
export async function enforceAppVersionPolicy(
  clientVersion?: string,
  platform: 'android' | 'ios' | 'web' | 'global' = 'web',
  options: EnforceVersionOptions = {}
): Promise<void> {
  const { requireVersion = false, failClosedOnDbError = false } = options;

  if (!clientVersion || typeof clientVersion !== 'string' || clientVersion.trim().length === 0) {
    if (requireVersion) {
      throw new HttpsError(
        'failed-precondition',
        'APP_VERSION_REQUIRED: This sensitive endpoint requires a valid client application version.'
      );
    }
    return; // Allow unversioned calls only when requireVersion is false
  }

  const cleanVersion = clientVersion.trim();
  const cacheKey = `policy_${platform}`;
  const nowMs = Date.now();

  let policy: VersionPolicyData | null = null;
  const cached = policyCache.get(cacheKey);

  if (cached && (nowMs - cached.cachedAt < CACHE_TTL_MS)) {
    policy = cached.policy;
  } else {
    try {
      // 1. Check platform-specific policy document first
      if (platform && platform !== 'global') {
        const platSnap = await db.collection('appConfig').doc('versions').collection('platforms').doc(platform).get();
        if (platSnap.exists) {
          policy = platSnap.data() as VersionPolicyData;
        }
      }

      // 2. Global fallback
      if (!policy) {
        const globalSnap = await db.collection('appConfig').doc('versions').get();
        if (globalSnap.exists) {
          policy = globalSnap.data() as VersionPolicyData;
        }
      }

      policyCache.set(cacheKey, { policy, cachedAt: nowMs });
    } catch (err: any) {
      console.error(`[enforceAppVersionPolicy] Error reading policy for ${platform}:`, err);
      // If we have stale cache, evaluate against it rather than failing open
      if (cached && cached.policy) {
        policy = cached.policy;
      } else if (failClosedOnDbError) {
        throw new HttpsError(
          'unavailable',
          'APP_VERSION_POLICY_UNAVAILABLE: Could not verify client version compliance. Please retry.'
        );
      }
    }
  }

  if (!policy) return;

  if (policy.forceUpdate === true) {
    throw new HttpsError(
      'failed-precondition',
      'APP_VERSION_DEPRECATED_FORCED_UPDATE: System requires an immediate app update.'
    );
  }

  if (policy.minimumSupportedVersion && compareSemver(cleanVersion, policy.minimumSupportedVersion) < 0) {
    throw new HttpsError(
      'failed-precondition',
      `APP_VERSION_DEPRECATED_FORCED_UPDATE: Installed version (${cleanVersion}) is below minimum supported version (${policy.minimumSupportedVersion}).`
    );
  }
}

/**
 * Developer / Admin Authoritative Endpoint to configure App Version Policy in real time.
 */
export const updateAppVersionPolicy = onCall<UpdateVersionPolicyRequest>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  try {
    assertCapability(callerRole, 'manage_version_policy');
  } catch (err) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_VERSION_POLICY_MUTATION',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: callerRole },
    });
    throw new HttpsError('permission-denied', 'Only developers or administrators can update app version policy.');
  }

  await enforceRateLimit(request.auth.uid, 'emergency_action');

  const {
    platform = 'global',
    latestVersion,
    minimumSupportedVersion,
    forceUpdate = false,
    message = 'A new version of Thakur Bites is available.',
    releaseNotes = [],
    storeUrl = '',
  } = request.data || {};

  if (!latestVersion || typeof latestVersion !== 'string' || !minimumSupportedVersion || typeof minimumSupportedVersion !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid latestVersion and minimumSupportedVersion strings are required.');
  }

  const now = admin.firestore.Timestamp.now();
  const docRef = platform === 'global'
    ? db.collection('appConfig').doc('versions')
    : db.collection('appConfig').doc('versions').collection('platforms').doc(platform);

  const policyPayload: VersionPolicyData = {
    latestVersion: latestVersion.trim(),
    minimumSupportedVersion: minimumSupportedVersion.trim(),
    forceUpdate: Boolean(forceUpdate),
    message: typeof message === 'string' ? message.trim() : '',
    releaseNotes: Array.isArray(releaseNotes) ? releaseNotes.map(n => String(n).trim()) : [],
    storeUrl: typeof storeUrl === 'string' ? storeUrl.trim() : '',
    updatedAt: now,
    updatedBy: request.auth.uid,
  };

  await docRef.set(policyPayload, { merge: true });

  // Invalidate in-memory cache for immediate propagation
  policyCache.delete(`policy_${platform}`);
  if (platform === 'global') {
    policyCache.clear();
  }

  await logSecurityEvent({
    eventType: 'APP_VERSION_POLICY_UPDATED',
    severity: forceUpdate ? 'HIGH' : 'INFO',
    actorUid: request.auth.uid,
    details: {
      platform,
      latestVersion,
      minimumSupportedVersion,
      forceUpdate,
    },
  });

  return {
    success: true,
    platform,
    policy: policyPayload,
  };
});
