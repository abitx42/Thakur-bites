import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

export type SecuritySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SecurityEventParams {
  eventType: string;
  severity: SecuritySeverity;
  actorUid?: string;
  orderId?: string;
  requestId?: string;
  details?: Record<string, any>;
}

// In-memory rate-deduplication map (fingerprint -> { count, firstSeen, docRef })
const deduplicationWindowMs = 30000; // 30 seconds
const eventDeduplicationCache = new Map<string, { count: number; firstSeen: number; eventId: string }>();

/**
 * Logs structured, correlation-tracked security events with automatic deduplication.
 */
export async function logSecurityEvent(params: SecurityEventParams): Promise<string> {
  const db = admin.firestore();
  const nowMs = Date.now();
  const { eventType, severity, actorUid = 'anonymous', orderId, requestId, details = {} } = params;

  const fingerprint = `${eventType}:${actorUid}:${orderId || 'none'}`;
  const cached = eventDeduplicationCache.get(fingerprint);

  if (cached && (nowMs - cached.firstSeen) < deduplicationWindowMs) {
    cached.count++;
    // Update existing document with incremented suppression count asynchronously
    db.collection('securityEvents').doc(cached.eventId).update({
      suppressedOccurrences: cached.count,
      lastOccurrenceAt: admin.firestore.Timestamp.now(),
    }).catch(() => {});
    return cached.eventId;
  }

  const eventId = `sec_${crypto.randomBytes(8).toString('hex')}`;
  eventDeduplicationCache.set(fingerprint, { count: 1, firstSeen: nowMs, eventId });

  // Evict old entries from memory cache if size exceeds 1000
  if (eventDeduplicationCache.size > 1000) {
    const cutoff = nowMs - deduplicationWindowMs;
    for (const [key, val] of eventDeduplicationCache.entries()) {
      if (val.firstSeen < cutoff) {
        eventDeduplicationCache.delete(key);
      }
    }
  }

  const now = admin.firestore.Timestamp.now();
  const eventDoc = {
    eventId,
    eventType,
    severity,
    actorUid,
    orderId: orderId || null,
    requestId: requestId || `req_${crypto.randomBytes(6).toString('hex')}`,
    timestamp: now,
    suppressedOccurrences: 1,
    details,
  };

  await db.collection('securityEvents').doc(eventId).set(eventDoc);
  return eventId;
}
