import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logSecurityEvent } from './security_logger';

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

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicy, RateLimitConfig> = {
  AUTH_LOGIN: { maxRequests: 5, windowSeconds: 300 },
  STAFF_PIN: { maxRequests: 5, windowSeconds: 60 },
  AUTH_VERIFICATION: { maxRequests: 5, windowSeconds: 300 },
  CHECKOUT: { maxRequests: 10, windowSeconds: 60 },
  PAYMENT: { maxRequests: 15, windowSeconds: 60 },
  PUBLIC_READ: { maxRequests: 60, windowSeconds: 60 },
  ADMIN: { maxRequests: 30, windowSeconds: 60 },
  DEVELOPER: { maxRequests: 60, windowSeconds: 60 },
};

export const ENDPOINT_LIMITS: Record<string, RateLimitConfig> = {
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
  const baseConfig = ENDPOINT_LIMITS[endpoint] || { maxRequests: 30, windowSeconds: 60 };
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

