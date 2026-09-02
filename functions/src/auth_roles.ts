import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { syncUserCustomClaims } from './claims_manager';
import { assertCapability, isDeveloperRole } from './authorization_policy';

const db = admin.firestore();

const VALID_ROLES: UserRole[] = ['customer', 'student', 'kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin'];

/**
 * Assigns a verified RBAC role to a staff member with session revocation and permissionsVersion tracking.
 * Strictly enforces separation of duties, atomic claims merge, and rate limiting.
 */
export const assignStaffRole = onCall<{ targetUid: string; newRole: UserRole }>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  await enforceRateLimit(request.auth.uid, 'role_assignment');

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  try {
    assertCapability(callerRole, 'manage_staff_roles');
  } catch (err) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_ROLE_ASSIGNMENT_ATTEMPT',
      severity: 'CRITICAL',
      actorUid: request.auth.uid,
      details: { callerRole },
    });
    throw new HttpsError('permission-denied', 'Only administrators can assign staff roles.');
  }

  const { targetUid, newRole } = request.data;
  if (!targetUid || typeof targetUid !== 'string' || targetUid.length > 128 || !VALID_ROLES.includes(newRole)) {
    throw new HttpsError('invalid-argument', 'Valid targetUid (max 128 chars) and role required.');
  }

  // Separation of Duties: Admin cannot promote to developer/security_admin unless caller is an engineering administrator
  if ((newRole === 'developer' || newRole === 'security_admin') && !isDeveloperRole(callerRole)) {
    throw new HttpsError('permission-denied', 'Only developers or security administrators can grant engineering administrator roles.');
  }

  // 1. Fetch target user record and verify existence
  let existingRole: UserRole = 'student';
  try {
    const userRecord = await admin.auth().getUser(targetUid);
    const existingClaims = userRecord.customClaims || {};
    existingRole = (existingClaims.role as UserRole) || 'student';
  } catch (err: any) {
    throw new HttpsError('not-found', `Target user ${targetUid} does not exist in Firebase Auth.`);
  }

  // Last Engineering Admin (Developer / Security Admin) Protection (TB-NEW-024)
  if (isDeveloperRole(existingRole) && !isDeveloperRole(newRole)) {
    if (!isDeveloperRole(callerRole)) {
      throw new HttpsError('permission-denied', 'Only developers or security administrators can demote an engineering administrator.');
    }
    const devAdminsSnap = await db.collection('staffUsers')
      .where('role', 'in', ['developer', 'security_admin'])
      .get();
    if (devAdminsSnap.docs.length <= 1 && devAdminsSnap.docs.some(d => d.id === targetUid)) {
      throw new HttpsError('failed-precondition', 'Cannot demote the last remaining developer or security administrator. System requires at least one active engineering administrator.');
    }
  }

  const now = admin.firestore.Timestamp.now();

  // 2. Monotonically Allocate Global Permissions Version (TB-NEW-023)
  const authorityRef = db.collection('systemConfig').doc('permissions_authority');
  const nextVersion = await db.runTransaction(async (t) => {
    const snap = await t.get(authorityRef);
    const cur = (snap.exists ? Number(snap.data()?.version || 0) : 0) + 1;
    t.set(authorityRef, { version: cur, lastAssignedTo: targetUid, updatedAt: now }, { merge: true });
    return cur;
  });

  // 3. Set Custom User Claims atomically without overwriting accountType/priorityLevel
  await syncUserCustomClaims(targetUid, {
    role: newRole,
    permissionsVersion: nextVersion,
    assignedAt: new Date().toISOString(),
  });

  // 4. Force token refresh by revoking existing sessions
  await admin.auth().revokeRefreshTokens(targetUid);

  // 5. Update staff user record
  await db.collection('staffUsers').doc(targetUid).set({
    uid: targetUid,
    role: newRole,
    permissionsVersion: nextVersion,
    assignedBy: request.auth.uid,
    updatedAt: now,
  }, { merge: true });

  // 6. Record immutable security audit event
  await logSecurityEvent({
    eventType: 'ROLE_ASSIGNMENT',
    severity: newRole === 'admin' || newRole === 'security_admin' ? 'HIGH' : 'INFO',
    actorUid: request.auth.uid,
    details: {
      targetUid,
      assignedRole: newRole,
      previousRole: existingRole,
      permissionsVersion: nextVersion,
    },
  });

  return {
    success: true,
    targetUid,
    assignedRole: newRole,
    permissionsVersion: nextVersion,
  };
});
