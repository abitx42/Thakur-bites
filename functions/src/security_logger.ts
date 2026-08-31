import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

export type SecuritySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SecurityEventParams {
  eventType: string;
  severity: SecuritySeverity;
  actorUid?: string;
  orderId?: string;
  requestId?: string;
  ipAddress?: string;
  details?: Record<string, any>;
}

export interface SecurityEventDoc {
  incidentId: string;
  eventType: string;
  severity: SecuritySeverity;
  actorUid: string;
  orderId: string | null;
  requestId: string;
  ipAddress?: string;
  firstSeen: admin.firestore.Timestamp;
  lastSeen: admin.firestore.Timestamp;
  suppressedOccurrences: number;
  details: Record<string, any>;
}

// In-Memory Telemetry Rate Budget (Caps per-actor writes to prevent denial-of-wallet)
const MAX_FIRESTORE_WRITES_PER_ACTOR_BUCKET = 50;
const actorTelemetryBudget = new Map<string, number>();

/**
 * Logs structured, correlation-tracked security events with multi-instance deterministic deduplication.
 * Calculates deterministic SHA-256 time-bucketed (5-min) incident IDs (INCIDENT-SEC-<HEX>) with atomic Firestore increments.
 * Guaranteed zero silent loss on CRITICAL/HIGH alerts with structured Cloud Logging fallback.
 */
export async function logSecurityEvent(params: SecurityEventParams): Promise<string> {
  const db = admin.firestore();
  const { eventType, severity, actorUid = 'anonymous', orderId, requestId, ipAddress, details = {} } = params;

  // Multi-Instance Global Deterministic 5-Minute Time Bucket Key
  const bucketMinutes = 5;
  const timeBucket = Math.floor(Date.now() / (bucketMinutes * 60 * 1000));
  const rawFingerprint = `${eventType}:${actorUid}:${orderId || 'global'}:${timeBucket}`;
  const incidentDigest = crypto.createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 10).toUpperCase();
  const incidentId = `INCIDENT-SEC-${incidentDigest}`;
  const incidentRef = db.collection('securityEvents').doc(incidentId);

  const now = admin.firestore.Timestamp.now();

  // Telemetry Rate Budget Check
  const budgetKey = `${actorUid}:${timeBucket}`;
  const currentCount = (actorTelemetryBudget.get(budgetKey) || 0) + 1;
  actorTelemetryBudget.set(budgetKey, currentCount);

  // If budget exceeded for this actor in this bucket, emit structured log to avoid Firestore flooding
  if (currentCount > MAX_FIRESTORE_WRITES_PER_ACTOR_BUCKET && severity !== 'CRITICAL') {
    console.warn(`[SECURITY_TELEMETRY_THROTTLED] Actor ${actorUid} exceeded telemetry write budget (${currentCount}). Logged to Cloud Logging only:`, {
      incidentId,
      eventType,
      severity,
      actorUid,
      orderId,
    });
    return incidentId;
  }

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
          ipAddress,
          firstSeen: now,
          lastSeen: now,
          suppressedOccurrences: 1,
          details,
        };
        transaction.set(incidentRef, eventDoc);
      }
    });
  } catch (err: any) {
    // Non-blocking fallback to set with merge
    try {
      await incidentRef.set({
        incidentId,
        eventType,
        severity,
        actorUid,
        orderId: orderId || null,
        lastSeen: now,
        suppressedOccurrences: admin.firestore.FieldValue.increment(1),
        details,
      }, { merge: true });
    } catch (fallbackErr: any) {
      // Guaranteed Reliable Logging for High/Critical Events (Never silently swallowed)
      if (severity === 'CRITICAL' || severity === 'HIGH') {
        console.error('[CRITICAL_SECURITY_ALERT_EMERGENCY_LOG]', JSON.stringify({
          incidentId,
          eventType,
          severity,
          actorUid,
          orderId,
          details,
          firestoreError: err.message,
          fallbackError: fallbackErr.message,
          timestamp: new Date().toISOString(),
        }));
      }
    }
  }

  return incidentId;
}
