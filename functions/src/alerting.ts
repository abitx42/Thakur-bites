import { randomUUID } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { enforceAppCheck } from './app_check';
import { assertCapability } from './authorization_policy';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type AlertLevel = 'WARNING' | 'DEGRADED' | 'FINANCIAL_FROZEN' | 'BREAK_GLASS';

export interface OperationalAlert {
  alertId: string;
  level: AlertLevel;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp: Timestamp;
  acknowledged: boolean;
  acknowledgedBy?: string;
}

/**
 * Dispatches multi-tier operational alerts across staff channels.
 */
export async function dispatchOperationalAlert(
  level: AlertLevel,
  title: string,
  message: string,
  metadata: Record<string, any> = {}
): Promise<string> {
  const alertId = `ALT_${randomUUID()}`;
  const now = Timestamp.now();

  const alertDoc: OperationalAlert = {
    alertId,
    level,
    title,
    message,
    metadata,
    timestamp: now,
    acknowledged: false,
  };

  await db.collection('staffNotifications').doc(alertId).set(alertDoc);

  // High-severity security logging
  await logSecurityEvent({
    eventType: `OPERATIONAL_ALERT_${level}`,
    severity: level === 'WARNING' ? 'MEDIUM' : 'CRITICAL',
    actorUid: 'SYSTEM_ALERT_DISPATCHER',
    details: { alertId, level, title, message, metadata },
  });

  return alertId;
}

/**
 * Callable endpoint to retrieve recent staff operational alerts.
 */
export const getStaffAlertsFeed = onCall<{ limit?: number }>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  assertCapability(
    callerRole,
    'view_business_analytics',
    'Permission denied: Only managers and administrators can view staff alerts.'
  );

  const maxLimit = Math.min(request.data?.limit || 50, 100);
  const snap = await db
    .collection('staffNotifications')
    .orderBy('timestamp', 'desc')
    .limit(maxLimit)
    .get();

  const alerts: OperationalAlert[] = [];
  snap.forEach((d) => alerts.push(d.data() as OperationalAlert));

  return {
    success: true,
    count: alerts.length,
    alerts,
  };
});
