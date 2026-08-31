"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignStaffRole = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();
const VALID_ROLES = ['student', 'kitchen', 'pickup', 'manager', 'admin', 'security_admin'];
/**
 * Assigns a verified RBAC role to a staff member. Only callable by admin/security_admin.
 */
exports.assignStaffRole = (0, https_1.onCall)(async (request) => {
    if (!request.auth || !request.auth.uid) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    const callerRole = request.auth.token.role || 'student';
    if (callerRole !== 'admin' && callerRole !== 'security_admin') {
        throw new https_1.HttpsError('permission-denied', 'Only administrators can assign staff roles.');
    }
    const { targetUid, newRole } = request.data;
    if (!targetUid || !VALID_ROLES.includes(newRole)) {
        throw new https_1.HttpsError('invalid-argument', 'Valid targetUid and role required.');
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
//# sourceMappingURL=auth_roles.js.map