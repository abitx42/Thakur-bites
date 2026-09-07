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
 * Universal timestamp normalizer that safely handles:
 * - Firestore Timestamp objects (.toMillis())
 * - Epoch seconds (e.g. 1720000000) -> converted to ms
 * - Epoch milliseconds (e.g. 1720000000000)
 * - Date objects (.getTime())
 * - ISO 8601 or RFC strings (Date.parse(str))
 * - Serialized Firestore JSON {_seconds, _nanoseconds}
 * - null, undefined, NaN -> returns 0
 */
export function normalizeTimestampToMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || ts <= 0) return 0;
    // Numbers below 1e11 represent epoch seconds (e.g. 1.7e9 vs 1.7e12)
    return ts < 1e11 ? Math.round(ts * 1000) : Math.round(ts);
  }
  if (typeof ts.toMillis === 'function') {
    return ts.toMillis();
  }
  if (ts instanceof Date) {
    return ts.getTime();
  }
  if (typeof ts._seconds === 'number') {
    return ts._seconds * 1000 + Math.round((ts._nanoseconds || 0) / 1e6);
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
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

  const sessionCreatedMs = normalizeTimestampToMillis(data.createdAt);

  // Priority 9: Token revocation awareness via Firebase Auth tokensValidAfterTime (Normalized)
  try {
    const authUser = await admin.auth().getUser(userId);
    if (authUser && authUser.tokensValidAfterTime) {
      const validAfterMs = normalizeTimestampToMillis(authUser.tokensValidAfterTime);
      if (validAfterMs > 0 && sessionCreatedMs > 0 && sessionCreatedMs < validAfterMs) {
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
  const expiresAtMs = normalizeTimestampToMillis(data.expiresAt);
  const lastActivityMs = normalizeTimestampToMillis(data.lastActivityAt);

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
