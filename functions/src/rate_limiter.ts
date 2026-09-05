import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { assertCapability, hasCapability } from './authorization_policy';

function getDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export type RateLimitPolicy =
  | 'AUTH_LOGIN'
  | 'AUTH_VERIFICATION'
  | 'STAFF_PIN'
  | 'CHECKOUT'
  | 'PAYMENT'
  | 'PUBLIC_READ'
  | 'ADMIN'
  | 'DEVELOPER';

export const DEFAULT_RATE_LIMIT_POLICIES: Record<RateLimitPolicy, RateLimitConfig> = {
  AUTH_LOGIN: { maxRequests: 5, windowSeconds: 300 },
  STAFF_PIN: { maxRequests: 5, windowSeconds: 60 },
  AUTH_VERIFICATION: { maxRequests: 5, windowSeconds: 300 },
  CHECKOUT: { maxRequests: 10, windowSeconds: 60 },
  PAYMENT: { maxRequests: 15, windowSeconds: 60 },
  PUBLIC_READ: { maxRequests: 60, windowSeconds: 60 },
  ADMIN: { maxRequests: 30, windowSeconds: 60 },
  DEVELOPER: { maxRequests: 60, windowSeconds: 60 },
};

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicy, RateLimitConfig> = DEFAULT_RATE_LIMIT_POLICIES;

export const DEFAULT_ENDPOINT_LIMITS: Record<string, RateLimitConfig> = {
  checkout: { maxRequests: 10, windowSeconds: 60 },
  pickup_verify: { maxRequests: 20, windowSeconds: 60 },
  payment_session: { maxRequests: 15, windowSeconds: 60 },
  role_assignment: { maxRequests: 5, windowSeconds: 300 },
  profile_provision: { maxRequests: 5, windowSeconds: 300 },
  verification_application: { maxRequests: 5, windowSeconds: 300 },
  step_up_challenge: { maxRequests: 5, windowSeconds: 60 },
  emergency_action: { maxRequests: 5, windowSeconds: 60 },
  refund: { maxRequests: 10, windowSeconds: 60 },
  inventory_adjustment: { maxRequests: 20, windowSeconds: 60 },
  unlock_order: { maxRequests: 10, windowSeconds: 60 },
  rating: { maxRequests: 10, windowSeconds: 60 },
  order_status: { maxRequests: 30, windowSeconds: 60 },
  cash_payment: { maxRequests: 20, windowSeconds: 60 },
  kitchen_view: { maxRequests: 60, windowSeconds: 60 },
  pickup_view: { maxRequests: 60, windowSeconds: 60 },
  cashier_view: { maxRequests: 60, windowSeconds: 60 },
  developer_telemetry: { maxRequests: 20, windowSeconds: 60 },
  permission_simulation: { maxRequests: 30, windowSeconds: 60 },
};

export const ENDPOINT_LIMITS: Record<string, RateLimitConfig> = DEFAULT_ENDPOINT_LIMITS;

// In-memory cache for dynamic rate limits fetched from systemConfig/securityRateLimits
interface CachedRateLimits {
  limits: Record<string, RateLimitConfig>;
  cachedAt: number;
}
let memoryCachedLimits: CachedRateLimits | null = null;
const CACHE_TTL_MS = 60000; // 60-second TTL

/**
 * Resets the in-memory rate limit cache (useful on config updates or in tests).
 */
export function clearRateLimitsCache(): void {
  memoryCachedLimits = null;
}

/**
 * Retrieves the effective endpoint rate limits by merging hardcoded defaults
 * with dynamic Firestore overrides from systemConfig/securityRateLimits.
 * Employs in-memory caching and safe fail-closed fallbacks.
 */
export async function getEffectiveEndpointLimits(): Promise<Record<string, RateLimitConfig>> {
  const now = Date.now();
  if (memoryCachedLimits && (now - memoryCachedLimits.cachedAt) < CACHE_TTL_MS) {
    return memoryCachedLimits.limits;
  }

  const merged: Record<string, RateLimitConfig> = { ...DEFAULT_ENDPOINT_LIMITS };

  try {
    const configSnap = await getDb().collection('systemConfig').doc('securityRateLimits').get();
    if (configSnap.exists) {
      const data = configSnap.data();
      const overrides = data?.limits;
      if (overrides && typeof overrides === 'object') {
        for (const [endpoint, conf] of Object.entries(overrides)) {
          if (
            conf &&
            typeof conf === 'object' &&
            typeof (conf as any).maxRequests === 'number' &&
            typeof (conf as any).windowSeconds === 'number'
          ) {
            merged[endpoint] = {
              maxRequests: Math.max(1, Math.min(1000, Math.floor((conf as any).maxRequests))),
              windowSeconds: Math.max(5, Math.min(3600, Math.floor((conf as any).windowSeconds))),
            };
          }
        }
      }
    }
    memoryCachedLimits = {
      limits: merged,
      cachedAt: now,
    };
  } catch (err: any) {
    console.warn('⚠️ Failed to load dynamic securityRateLimits from Firestore, using fallbacks:', err?.message);
    if (!memoryCachedLimits) {
      memoryCachedLimits = { limits: merged, cachedAt: now };
    }
  }

  return memoryCachedLimits.limits;
}

/**
 * Resolves the active RateLimitConfig for a specific endpoint.
 */
export async function getEffectiveRateLimit(endpoint: string): Promise<RateLimitConfig> {
  const limits = await getEffectiveEndpointLimits();
  return limits[endpoint] || DEFAULT_ENDPOINT_LIMITS[endpoint] || { maxRequests: 30, windowSeconds: 60 };
}

/**
 * Checks and updates sliding window rate limit for an actor on a specific endpoint.
 * College NAT-Aware Architecture:
 * - Authenticated users are keyed on UID (strict individual quota, immune to noisy campus neighbors).
 * - Anonymous / IP-based requests apply a NAT multiplier to avoid blocking entire college subnets.
 */
export async function enforceRateLimit(
  actorId: string,
  endpoint: string,
  options?: { isIpBased?: boolean; natMultiplier?: number }
): Promise<void> {
  const baseConfig = await getEffectiveRateLimit(endpoint);
  const multiplier = options?.isIpBased ? (options.natMultiplier || 10) : 1;
  const maxAllowed = baseConfig.maxRequests * multiplier;

  const now = Date.now();
  const windowStart = now - baseConfig.windowSeconds * 1000;
  const docKey = `${endpoint}_${actorId}`;
  const rateLimitRef = getDb().collection('rateLimits').doc(docKey);

  const isAllowed = await getDb().runTransaction(async (transaction) => {
    const snap = await transaction.get(rateLimitRef);
    let timestamps: number[] = [];

    if (snap.exists) {
      const data = snap.data() || {};
      const existing: number[] = Array.isArray(data.timestamps) ? data.timestamps : [];
      timestamps = existing.filter(t => t > windowStart);
    }

    if (timestamps.length >= maxAllowed) {
      return false;
    }

    timestamps.push(now);
    if (timestamps.length > 100) {
      timestamps = timestamps.slice(-100);
    }
    const expireAt = admin.firestore.Timestamp.fromMillis(now + baseConfig.windowSeconds * 1000);

    transaction.set(rateLimitRef, {
      actorId,
      endpoint,
      timestamps,
      isIpBased: options?.isIpBased || false,
      lastUpdatedAt: admin.firestore.Timestamp.now(),
      expireAt,
    });

    return true;
  });

  if (!isAllowed) {
    // Record centralized deterministic security alert
    await logSecurityEvent({
      eventType: 'RATE_LIMIT_EXCEEDED',
      severity: 'LOW',
      actorUid: actorId,
      details: {
        endpoint,
        maxRequests: maxAllowed,
        windowSeconds: baseConfig.windowSeconds,
        isIpBased: options?.isIpBased || false,
      },
    });

    throw new HttpsError(
      'resource-exhausted',
      `Rate limit exceeded for ${endpoint}. Please wait a moment before trying again.`
    );
  }
}

/**
 * Calculates exponential backoff delay based on consecutive failure count.
 * Failures 1–3: 0 seconds (standard response)
 * Failure 4: 5 seconds
 * Failure 5: 15 seconds
 * Failure 6+: 60 seconds
 */
export function calculateBackoffDelaySeconds(consecutiveFailures: number): number {
  if (consecutiveFailures <= 3) return 0;
  if (consecutiveFailures === 4) return 5;
  if (consecutiveFailures === 5) return 15;
  return 60;
}

/**
 * Enforces exponential backoff delay if a failure cooldown is currently active.
 */
export async function enforceExponentialBackoff(
  identifier: string,
  scope: 'staff_pin' | 'auth_login' | 'step_up'
): Promise<void> {
  const docKey = `backoff_${scope}_${identifier}`;
  const backoffRef = getDb().collection('authBackoffs').doc(docKey);
  const snap = await backoffRef.get();

  if (!snap.exists) return;

  const data = snap.data() || {};
  const blockedUntil = data.blockedUntil ? data.blockedUntil.toMillis() : 0;
  const now = Date.now();

  if (now < blockedUntil) {
    const remainingSeconds = Math.ceil((blockedUntil - now) / 1000);
    throw new HttpsError(
      'resource-exhausted',
      `Too many failed attempts. Security backoff active. Please wait ${remainingSeconds} second(s) before trying again.`
    );
  }
}

/**
 * Records an authentication failure, increments failure count, and sets the next blockedUntil window.
 */
export async function recordAuthFailure(
  identifier: string,
  scope: 'staff_pin' | 'auth_login' | 'step_up'
): Promise<{ nextBackoffSeconds: number; consecutiveFailures: number }> {
  const docKey = `backoff_${scope}_${identifier}`;
  const backoffRef = getDb().collection('authBackoffs').doc(docKey);
  const now = Date.now();

  return await getDb().runTransaction(async (transaction) => {
    const snap = await transaction.get(backoffRef);
    let consecutiveFailures = 1;

    if (snap.exists) {
      const data = snap.data() || {};
      const lastFailureAt = data.lastFailureAt ? data.lastFailureAt.toMillis() : 0;
      // If last failure was more than 10 minutes ago, reset streak
      if (now - lastFailureAt < 600000) {
        consecutiveFailures = (Number(data.consecutiveFailures) || 0) + 1;
      }
    }

    const nextBackoffSeconds = calculateBackoffDelaySeconds(consecutiveFailures);
    const blockedUntil = admin.firestore.Timestamp.fromMillis(now + nextBackoffSeconds * 1000);

    transaction.set(backoffRef, {
      identifier,
      scope,
      consecutiveFailures,
      lastFailureAt: admin.firestore.Timestamp.fromMillis(now),
      blockedUntil,
      expireAt: admin.firestore.Timestamp.fromMillis(now + 3600 * 1000), // 1 hour TTL
    });

    if (consecutiveFailures >= 6) {
      logSecurityEvent({
        eventType: 'AUTH_BRUTE_FORCE_LOCKOUT_TRIGGERED',
        severity: 'HIGH',
        actorUid: identifier,
        details: { scope, consecutiveFailures, backoffSeconds: nextBackoffSeconds },
      }).catch(() => {});
    }

    return { nextBackoffSeconds, consecutiveFailures };
  });
}

/**
 * Clears consecutive failure streak upon successful authentication.
 */
export async function recordAuthSuccess(
  identifier: string,
  scope: 'staff_pin' | 'auth_login' | 'step_up'
): Promise<void> {
  const docKey = `backoff_${scope}_${identifier}`;
  const backoffRef = getDb().collection('authBackoffs').doc(docKey);
  await backoffRef.delete().catch(() => {});
}

/**
 * Platform 2.0 — Retrieve Active Security Rate Limits
 * Restricted to users with view_telemetry or manage_platform_flags capabilities (admin / developer).
 */
export const getSecurityRateLimits = onCall(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }
  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!hasCapability(callerRole, 'view_telemetry') && !hasCapability(callerRole, 'manage_platform_flags')) {
    throw new HttpsError('permission-denied', 'Access denied: Requires administrator or engineering telemetry permissions.');
  }

  const snap = await getDb().collection('systemConfig').doc('securityRateLimits').get();
  const docData = snap.exists ? snap.data() || {} : {};
  const overrides: Record<string, RateLimitConfig> = (docData.limits && typeof docData.limits === 'object') ? docData.limits : {};
  const effective = await getEffectiveEndpointLimits();

  return {
    success: true,
    defaults: DEFAULT_ENDPOINT_LIMITS,
    overrides,
    effective,
    updatedAt: docData.updatedAt ? docData.updatedAt.toDate().toISOString() : null,
    updatedBy: docData.updatedBy || null,
    reason: docData.reason || null,
  };
});

/**
 * Platform 2.0 — Dynamically Configure Security Rate Limits
 * Restricted strictly to users with manage_platform_flags capability (admin / manager / developer).
 */
export const updateSecurityRateLimits = onCall(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }
  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'manage_platform_flags', 'Only managers or administrators can modify rate limit policies.');

  const { limits, reason } = request.data || {};
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw new HttpsError('invalid-argument', 'limits object is required.');
  }

  const validatedOverrides: Record<string, RateLimitConfig> = {};
  for (const [endpoint, conf] of Object.entries(limits)) {
    if (typeof endpoint !== 'string' || !endpoint.trim()) {
      continue;
    }
    const cleanEndpoint = endpoint.trim().toLowerCase();
    if (!conf || typeof conf !== 'object') {
      throw new HttpsError('invalid-argument', `Invalid rate limit configuration for ${cleanEndpoint}.`);
    }
    const { maxRequests, windowSeconds } = conf as any;
    if (typeof maxRequests !== 'number' || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) {
      throw new HttpsError('invalid-argument', `maxRequests for ${cleanEndpoint} must be an integer between 1 and 1000.`);
    }
    if (typeof windowSeconds !== 'number' || !Number.isSafeInteger(windowSeconds) || windowSeconds < 5 || windowSeconds > 3600) {
      throw new HttpsError('invalid-argument', `windowSeconds for ${cleanEndpoint} must be an integer between 5 and 3600.`);
    }

    validatedOverrides[cleanEndpoint] = {
      maxRequests,
      windowSeconds,
    };
  }

  const now = admin.firestore.Timestamp.now();
  const updatePayload = {
    limits: validatedOverrides,
    updatedAt: now,
    updatedBy: request.auth.uid,
    reason: typeof reason === 'string' ? reason.slice(0, 200) : 'Security policy threshold tuning',
  };

  await getDb().collection('systemConfig').doc('securityRateLimits').set(updatePayload, { merge: true });

  // Invalidate in-memory cache immediately so changes take effect across subsequent function invocations
  clearRateLimitsCache();

  await logSecurityEvent({
    eventType: 'SECURITY_RATE_LIMITS_UPDATED',
    severity: 'MEDIUM',
    actorUid: request.auth.uid,
    details: {
      updatedEndpoints: Object.keys(validatedOverrides),
      reason: updatePayload.reason,
    },
  });

  return {
    success: true,
    message: `Security rate limits successfully updated for ${Object.keys(validatedOverrides).length} endpoint(s).`,
    overrides: validatedOverrides,
  };
});


