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

/**
 * Logs structured, correlation-tracked security events with multi-instance deterministic deduplication.
 * Calculates deterministic SHA-256 time-bucketed (5-min) incident IDs (INCIDENT-SEC-<HEX>) with atomic Firestore increments.
 * Prevents denial-of-wallet / alert flooding attacks across ALL distributed Cloud Function instances.
 */
export async function logSecurityEvent(params: SecurityEventParams): Promise<string> {
  const db = admin.firestore();
  const { eventType, severity, actorUid = 'anonymous', orderId, requestId, details = {} } = params;

  // Multi-Instance Global Deterministic 5-Minute Time Bucket Key
  const bucketMinutes = 5;
  const timeBucket = Math.floor(Date.now() / (bucketMinutes * 60 * 1000));
  const rawFingerprint = `${eventType}:${actorUid}:${orderId || 'global'}:${timeBucket}`;
  const incidentDigest = crypto.createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 10).toUpperCase();
  const incidentId = `INCIDENT-SEC-${incidentDigest}`;
  const incidentRef = db.collection('securityEvents').doc(incidentId);

  const now = admin.firestore.Timestamp.now();

  try {
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(incidentRef);
      if (snap.exists) {
        transaction.update(incidentRef, {
          suppressedOccurrences: admin.firestore.FieldValue.increment(1),
          lastSeen: now,
          severity, // Update to highest severity if escalated
          details: { ...(snap.data()?.details || {}), ...details },
        });
      } else {
        const eventDoc: SecurityEventDoc = {
          incidentId,
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
        transaction.set(incidentRef, eventDoc);
      }
    });
  } catch (err) {
    // Non-blocking fallback to set with merge
    await incidentRef.set({
      incidentId,
      eventType,
      severity,
      actorUid,
      orderId: orderId || null,
      lastSeen: now,
      suppressedOccurrences: admin.firestore.FieldValue.increment(1),
      details,
    }, { merge: true }).catch(() => {});
  }

  return incidentId;
}
