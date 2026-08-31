import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logSecurityEvent } from './security_logger';

const db = admin.firestore();

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

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
  const rateLimitRef = db.collection('rateLimits').doc(docKey);

  const isAllowed = await db.runTransaction(async (transaction) => {
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
