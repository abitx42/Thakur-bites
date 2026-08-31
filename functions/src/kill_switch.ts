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

export interface PublicSystemStatusDoc {
  mode: SystemOperationalMode;
  orderingAvailable: boolean;
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
 * Hardened Separation of Duties:
 * - Manager: Can trigger DEGRADED and FINANCIAL_FROZEN. Cannot trigger EMERGENCY_HALT or restore from freeze/halt.
 * - Security Admin & Admin: Full authority over all mode transitions and restorations.
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

  const { mode, reason } = request.data;
  const validModes: SystemOperationalMode[] = ['NORMAL', 'DEGRADED', 'FINANCIAL_FROZEN', 'EMERGENCY_HALT'];
  if (!mode || !validModes.includes(mode)) {
    throw new HttpsError('invalid-argument', `Invalid mode. Must be one of: ${validModes.join(', ')}.`);
  }

  // Strict String & Type Validation (P1: Reject non-string / empty reason objects)
  if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200)) {
    throw new HttpsError('invalid-argument', 'Reason must be a valid string between 1 and 200 characters.');
  }
  const safeReason = typeof reason === 'string' ? reason.trim() : 'Administrative update';

  // Separation of Duties Matrix Validation
  const currentSnap = await db.collection('systemConfig').doc('global').get();
  const currentMode = (currentSnap.data()?.mode as SystemOperationalMode) || 'NORMAL';

  if (mode === 'EMERGENCY_HALT' && actorRole === 'manager') {
    throw new HttpsError(
      'permission-denied',
      'Permission denied. Only Security Administrators and Admins are authorized to initiate an EMERGENCY_HALT.'
    );
  }

  if (mode === 'NORMAL' && (currentMode === 'FINANCIAL_FROZEN' || currentMode === 'EMERGENCY_HALT') && actorRole === 'manager') {
    throw new HttpsError(
      'permission-denied',
      'Permission denied. Restoring NORMAL operations from FINANCIAL_FROZEN or EMERGENCY_HALT requires Security Administrator or Admin authorization.'
    );
  }

  const now = admin.firestore.Timestamp.now();
  
  // 1. Private Audit Configuration Document (Internal staff UID & reason preserved privately)
  const privateConfigRef = db.collection('systemConfig').doc('global');
  await privateConfigRef.set({
    mode,
    reason: safeReason,
    updatedBy: request.auth.uid,
    updatedAt: now,
  });

  // 2. Public Sanitized Document (Zero PII or internal reason leakage)
  const publicStatusRef = db.collection('publicSystemStatus').doc('global');
  await publicStatusRef.set({
    mode,
    orderingAvailable: mode === 'NORMAL',
    updatedAt: now,
  });

  await logSecurityEvent({
    eventType: 'OPERATIONAL_MODE_CHANGED',
    severity: mode === 'NORMAL' ? 'INFO' : 'CRITICAL',
    actorUid: request.auth.uid,
    details: { previousMode: currentMode, newMode: mode, reason: safeReason, actorRole },
  });

  return {
    success: true,
    mode,
    updatedBy: request.auth.uid,
    updatedAt: now.toDate().toISOString(),
  };
});
