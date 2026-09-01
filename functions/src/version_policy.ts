import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';

const db = admin.firestore();

export interface VersionPolicyData {
  latestVersion: string;
  minimumSupportedVersion: string;
  forceUpdate?: boolean;
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

/**
 * Pure Semantic Version Comparator.
 */
export function compareSemver(v1: string, v2: string): number {
  const sanitize = (v: string) => {
    let clean = (v || '').trim();
    if (clean.includes('+')) clean = clean.split('+')[0];
    if (clean.includes('-')) clean = clean.split('-')[0];
    return clean;
  };

  const p1 = sanitize(v1).split('.').map(x => parseInt(x, 10) || 0);
  const p2 = sanitize(v2).split('.').map(x => parseInt(x, 10) || 0);

  while (p1.length < 3) p1.push(0);
  while (p2.length < 3) p2.push(0);

  for (let i = 0; i < 3; i++) {
    if (p1[i] < p2[i]) return -1;
    if (p1[i] > p2[i]) return 1;
  }
  return 0;
}

/**
 * Server-Authoritative Version Policy Enforcer.
 * Cloud Functions invoke this to reject calls from obsolete/vulnerable client binaries.
 */
export async function enforceAppVersionPolicy(
  clientVersion?: string,
  platform: 'android' | 'ios' | 'web' = 'web'
): Promise<void> {
  if (!clientVersion) {
    return; // Allow legacy or unversioned calls unless strictly configured
  }

  try {
    const docRef = db.collection('appConfig').doc('versions');
    const snap = await docRef.get();
    if (!snap.exists) return;

    const data = snap.data() as VersionPolicyData;
    if (data.forceUpdate === true) {
      throw new HttpsError(
        'failed-precondition',
        'APP_VERSION_DEPRECATED_FORCED_UPDATE: System requires an immediate app update.'
      );
    }

    if (data.minimumSupportedVersion && compareSemver(clientVersion, data.minimumSupportedVersion) < 0) {
      throw new HttpsError(
        'failed-precondition',
        `APP_VERSION_DEPRECATED_FORCED_UPDATE: Installed version (${clientVersion}) is below minimum supported version (${data.minimumSupportedVersion}).`
      );
    }
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    console.error('[enforceAppVersionPolicy] Error reading version config:', err);
  }
}

/**
 * Security Admin / Admin Authoritative Endpoint to configure App Version Policy in real time.
 */
export const updateAppVersionPolicy = onCall<UpdateVersionPolicyRequest>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'security_admin' && callerRole !== 'admin') {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_VERSION_POLICY_MUTATION',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: callerRole },
    });
    throw new HttpsError('permission-denied', 'Only security administrators or administrators can update app version policy.');
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
