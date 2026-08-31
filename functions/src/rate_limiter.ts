import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

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
  refund: { maxRequests: 10, windowSeconds: 60 },
  inventory_adjustment: { maxRequests: 20, windowSeconds: 60 },
  unlock_order: { maxRequests: 10, windowSeconds: 60 },
  rating: { maxRequests: 10, windowSeconds: 60 },
  order_status: { maxRequests: 30, windowSeconds: 60 },
  cash_payment: { maxRequests: 20, windowSeconds: 60 },
};

/**
 * Checks and updates sliding window rate limit for an actor on a specific endpoint.
 * Fix 7: Adds expireAt TTL timestamp and array pruning to prevent unbounded document accumulation.
 */
export async function enforceRateLimit(actorId: string, endpoint: string): Promise<void> {
  const config = ENDPOINT_LIMITS[endpoint] || { maxRequests: 30, windowSeconds: 60 };
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;
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

    if (timestamps.length >= config.maxRequests) {
      return false;
    }

    timestamps.push(now);
    const expireAt = admin.firestore.Timestamp.fromMillis(now + config.windowSeconds * 2000);

    transaction.set(rateLimitRef, {
      actorId,
      endpoint,
      timestamps,
      lastUpdatedAt: admin.firestore.Timestamp.now(),
      expireAt,
    });

    return true;
  });

  if (!isAllowed) {
    // Record security alert
    await db.collection('securityEvents').doc().set({
      eventType: 'RATE_LIMIT_EXCEEDED',
      actorUid: actorId,
      endpoint,
      severity: 'warn',
      timestamp: admin.firestore.Timestamp.now(),
      details: { maxRequests: config.maxRequests, windowSeconds: config.windowSeconds },
    });

    throw new HttpsError('resource-exhausted', 'Request blocked. Please try again in a few moments.');
  }
}
