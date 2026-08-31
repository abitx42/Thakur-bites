import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';

const db = admin.firestore();

const VALID_ROLES: UserRole[] = ['student', 'kitchen', 'pickup', 'manager', 'admin', 'security_admin'];

/**
 * Assigns a verified RBAC role to a staff member. Only callable by admin/security_admin.
 */
export const assignStaffRole = onCall<{ targetUid: string; newRole: UserRole }>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'admin' && callerRole !== 'security_admin') {
    throw new HttpsError('permission-denied', 'Only administrators can assign staff roles.');
  }

  const { targetUid, newRole } = request.data;
  if (!targetUid || !VALID_ROLES.includes(newRole)) {
    throw new HttpsError('invalid-argument', 'Valid targetUid and role required.');
  }

  // 1. Set Firebase Auth Custom Claims
  await admin.auth().setCustomUserClaims(targetUid, { role: newRole });

  const now = admin.firestore.Timestamp.now();

  // 2. Update staff user record
  await db.collection('staffUsers').doc(targetUid).set({
    uid: targetUid,
    role: newRole,
    assignedBy: request.auth.uid,
    updatedAt: now,
  }, { merge: true });

  // 3. Record immutable security audit event
  await db.collection('securityEvents').doc().set({
    eventType: 'ROLE_ASSIGNMENT',
    actorUid: request.auth.uid,
    targetUid,
    newRole,
    timestamp: now,
  });

  return { success: true, targetUid, assignedRole: newRole };
});
