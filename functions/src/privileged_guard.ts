import { Timestamp } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logSecurityEvent } from './security_logger';
import { PRIVILEGED_SESSION_IDLE_TIMEOUT_MS } from './mfa_totp';

function getDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

/**
 * Validates that an operation is performed within an active 6-hour privileged session
 * with a 30-minute idle activity threshold.
 */
export async function assertPrivilegedSession(
  userId: string,
  sessionId: string | undefined | null,
  operation: string
): Promise<{ sessionId: string; role: string }> {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('psess_')) {
    await logSecurityEvent({
      eventType: 'PRIVILEGED_OPERATION_BLOCKED_NO_SESSION',
      severity: 'HIGH',
      actorUid: userId,
      details: { operation },
    });
    throw new HttpsError(
      'permission-denied',
      `PRIVILEGED_SESSION_REQUIRED: Operation '${operation}' requires an active 6-hour privileged session with MFA.`
    );
  }

  const db = getDb();
  const sessionRef = db.collection('privilegedSessions').doc(sessionId);
  const sessionDoc = await sessionRef.get();

  if (!sessionDoc.exists) {
    throw new HttpsError('permission-denied', 'Invalid privileged session identifier.');
  }

  const data = sessionDoc.data()!;
  if (data.userId !== userId || data.status !== 'ACTIVE') {
    throw new HttpsError('permission-denied', 'Privileged session does not belong to the active user or has been revoked.');
  }

  // Priority 9: Privileged role check - Demoted roles immediately lose privileged session validity
  const privilegedRoles = ['admin', 'manager', 'developer', 'security_admin'];
  if (!privilegedRoles.includes(data.role)) {
    await sessionRef.update({ status: 'REVOKED', reason: 'ROLE_NOT_PRIVILEGED' }).catch(() => {});
    throw new HttpsError('permission-denied', 'ROLE_REVOKED: User role is not authorized for privileged sessions.');
  }

  // Priority 9: Token revocation awareness via Firebase Auth tokensValidAfterTime
  try {
    const authUser = await admin.auth().getUser(userId);
    if (authUser && authUser.tokensValidAfterTime) {
      const validAfterMs = new Date(authUser.tokensValidAfterTime).getTime();
      const sessionCreatedMs = data.createdAt ? data.createdAt.toMillis() : 0;
      if (sessionCreatedMs < validAfterMs) {
        await sessionRef.update({ status: 'REVOKED', reason: 'FIREBASE_TOKENS_REVOKED' }).catch(() => {});
        throw new HttpsError(
          'unauthenticated',
          'USER_TOKENS_REVOKED: User authentication tokens have been revoked. Please sign in again.'
        );
      }
    }
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    if (err?.code === 'auth/user-not-found') {
      await sessionRef.update({ status: 'REVOKED', reason: 'USER_NOT_FOUND' }).catch(() => {});
      throw new HttpsError('unauthenticated', 'USER_NOT_FOUND: User account does not exist.');
    }
  }

  const now = Date.now();
  const expiresAtMs = data.expiresAt ? data.expiresAt.toMillis() : 0;
  const lastActivityMs = data.lastActivityAt ? data.lastActivityAt.toMillis() : 0;

  // Enforce 6-hour total lifetime
  if (now > expiresAtMs) {
    await sessionRef.update({ status: 'EXPIRED' }).catch(() => {});
    await logSecurityEvent({
      eventType: 'PRIVILEGED_SESSION_EXPIRED',
      severity: 'MEDIUM',
      actorUid: userId,
      details: { operation, sessionId },
    });
    throw new HttpsError(
      'permission-denied',
      'PRIVILEGED_SESSION_EXPIRED: Your 6-hour privileged session has expired. Please re-authenticate with your Authenticator app.'
    );
  }

  // Enforce 30-minute idle timeout
  if (now - lastActivityMs > PRIVILEGED_SESSION_IDLE_TIMEOUT_MS) {
    await sessionRef.update({ status: 'IDLE_TIMEOUT' }).catch(() => {});
    await logSecurityEvent({
      eventType: 'PRIVILEGED_SESSION_IDLE_TIMEOUT',
      severity: 'MEDIUM',
      actorUid: userId,
      details: { operation, sessionId, idleMinutes: Math.round((now - lastActivityMs) / 60000) },
    });
    throw new HttpsError(
      'permission-denied',
      'PRIVILEGED_SESSION_IDLE_TIMEOUT: Privileged portal locked after 30 minutes of inactivity. Please re-authenticate.'
    );
  }

  // Session valid: touch lastActivityAt
  await sessionRef.update({
    lastActivityAt: Timestamp.fromMillis(now),
  }).catch(() => {});

  return { sessionId, role: data.role || '' };
}
