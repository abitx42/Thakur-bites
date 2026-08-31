import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type SystemOperationalMode = 'NORMAL' | 'DEGRADED' | 'FINANCIAL_FROZEN' | 'EMERGENCY_HALT';

export interface SystemConfigDoc {
  mode: SystemOperationalMode;
  reason?: string;
  updatedBy: string;
  updatedAt: admin.firestore.Timestamp;
}

/**
 * Asserts that the system operational status permits the given operation category.
 */
export async function assertOperationalMode(category: 'checkout' | 'payment' | 'refund' | 'general'): Promise<void> {
  const configDoc = await db.collection('systemConfig').doc('global').get();
  if (!configDoc.exists) {
    return; // Defaults to NORMAL
  }

  const mode = (configDoc.data()?.mode as SystemOperationalMode) || 'NORMAL';

  if (mode === 'NORMAL') {
    return;
  }

  if (mode === 'EMERGENCY_HALT') {
    throw new HttpsError(
      'unavailable',
      'Canteen operations are temporarily paused under an emergency management halt.'
    );
  }

  if (mode === 'FINANCIAL_FROZEN' && (category === 'checkout' || category === 'payment' || category === 'refund')) {
    throw new HttpsError(
      'unavailable',
      'Financial transactions and checkout are temporarily frozen for system reconciliation.'
    );
  }

  if (mode === 'DEGRADED' && category === 'checkout') {
    throw new HttpsError(
      'unavailable',
      'Online ordering is temporarily paused. Please place your order at the canteen counter.'
    );
  }
}

/**
 * Authoritative Emergency Kill Switch and Operational Mode Controller.
 * Restricted strictly to Manager, Admin, and Security Admin roles.
 */
export const setSystemOperationalMode = onCall<{ mode: SystemOperationalMode; reason?: string }>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
    throw new HttpsError(
      'permission-denied',
      'Permission denied. Only managers and security administrators can toggle system operational modes.'
    );
  }

  const { mode, reason = 'Administrative update' } = request.data;
  const validModes: SystemOperationalMode[] = ['NORMAL', 'DEGRADED', 'FINANCIAL_FROZEN', 'EMERGENCY_HALT'];
  if (!mode || !validModes.includes(mode)) {
    throw new HttpsError('invalid-argument', `Invalid mode. Must be one of: ${validModes.join(', ')}.`);
  }

  const now = admin.firestore.Timestamp.now();
  const configRef = db.collection('systemConfig').doc('global');

  await configRef.set({
    mode,
    reason: String(reason).trim().slice(0, 200),
    updatedBy: request.auth.uid,
    updatedAt: now,
  }, { merge: true });

  await logSecurityEvent({
    eventType: 'OPERATIONAL_MODE_CHANGED',
    severity: mode === 'NORMAL' ? 'INFO' : 'CRITICAL',
    actorUid: request.auth.uid,
    details: { mode, reason },
  });

  return {
    success: true,
    mode,
    updatedBy: request.auth.uid,
    updatedAt: now.toDate().toISOString(),
  };
});
