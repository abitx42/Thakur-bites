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

export interface SecurityEventDoc {
  incidentId: string;
  eventId: string;
  eventType: string;
  severity: SecuritySeverity;
  actorUid: string;
  orderId: string | null;
  requestId: string;
  firstSeen: admin.firestore.Timestamp;
  lastSeen: admin.firestore.Timestamp;
  suppressedOccurrences: number;
  details: Record<string, any>;
}

// In-memory sliding deduplication window (5 minutes)
const DEDUPLICATION_WINDOW_MS = 5 * 60 * 1000;
const incidentCache = new Map<string, { count: number; firstSeen: number; incidentId: string }>();

/**
 * Logs structured, correlation-tracked security events with automatic incident grouping and deduplication.
 * Prevents denial-of-wallet / alert flooding attacks by aggregating rapid repeated failures into incidents.
 */
export async function logSecurityEvent(params: SecurityEventParams): Promise<string> {
  const db = admin.firestore();
  const nowMs = Date.now();
  const { eventType, severity, actorUid = 'anonymous', orderId, requestId, details = {} } = params;

  const fingerprint = `${eventType}:${actorUid}:${orderId || 'global'}`;
  const cached = incidentCache.get(fingerprint);

  if (cached && (nowMs - cached.firstSeen) < DEDUPLICATION_WINDOW_MS) {
    cached.count++;
    // Throttle Firestore updates to log 10, 20, 50, 100, 200, ... to minimize cost
    if (cached.count % 10 === 0 || cached.count <= 5) {
      db.collection('securityEvents').doc(cached.incidentId).update({
        suppressedOccurrences: cached.count,
        lastSeen: admin.firestore.Timestamp.now(),
      }).catch(() => {});
    }
    return cached.incidentId;
  }

  const incidentHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  const incidentId = `INCIDENT-SEC-${incidentHex}`;
  const eventId = `sec_${crypto.randomBytes(8).toString('hex')}`;
  incidentCache.set(fingerprint, { count: 1, firstSeen: nowMs, incidentId });

  // Evict expired entries if cache grows
  if (incidentCache.size > 2000) {
    const cutoff = nowMs - DEDUPLICATION_WINDOW_MS;
    for (const [key, val] of incidentCache.entries()) {
      if (val.firstSeen < cutoff) {
        incidentCache.delete(key);
      }
    }
  }

  const now = admin.firestore.Timestamp.now();
  const eventDoc: SecurityEventDoc = {
    incidentId,
    eventId,
    eventType,
    severity,
    actorUid,
    orderId: orderId || null,
    requestId: requestId || `req_${crypto.randomBytes(6).toString('hex')}`,
    firstSeen: now,
    lastSeen: now,
    suppressedOccurrences: 1,
    details,
  };

  await db.collection('securityEvents').doc(incidentId).set(eventDoc);
  return incidentId;
}
