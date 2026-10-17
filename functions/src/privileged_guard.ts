import { Timestamp } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logSecurityEvent } from './security_logger';
import { PRIVILEGED_SESSION_IDLE_TIMEOUT_MS, PRIVILEGED_SESSION_LIFETIME_MS } from './mfa_totp';

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
  try {
    if (ts === null || ts === undefined) return 0;
    let millis: unknown;
    if (typeof ts === 'number') {
      // Numbers below 1e11 represent epoch seconds (e.g. 1.7e9 vs 1.7e12).
      millis = ts < 1e11 ? Math.round(ts * 1000) : Math.round(ts);
    } else if (typeof ts.toMillis === 'function') {
      millis = ts.toMillis();
    } else if (ts instanceof Date) {
      millis = ts.getTime();
    } else if (typeof ts._seconds === 'number') {
      const nanos = ts._nanoseconds === undefined ? 0 : ts._nanoseconds;
      if (!Number.isSafeInteger(ts._seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return 0;
      millis = ts._seconds * 1000 + Math.floor(nanos / 1e6);
    } else if (typeof ts === 'string') {
      millis = Date.parse(ts);
    }
    // Invalid Date/Timestamp methods must never turn comparisons into NaN or
    // return a coercible string. Match the JavaScript Date representable range.
    return typeof millis === 'number' && Number.isFinite(millis) && millis > 0 && millis <= 8.64e15 ? millis : 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Validates that an operation is performed within an active 6-hour privileged session
 * with a 30-minute idle activity threshold.
 */
export async function assertPrivilegedSession(
  userId: string,
  sessionId: string | undefined | null,
  operation: string,
  token?: Record<string, any>
): Promise<{ sessionId: string; role: string }> {
  if (typeof userId !== 'string' || !userId || userId.length > 128 || userId.includes('/')) {
    throw new HttpsError('unauthenticated', 'A valid authenticated user is required.');
  }
  if (typeof sessionId !== 'string' || !/^psess_[A-Za-z0-9_-]{1,160}$/.test(sessionId)) {
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
  let authUser: admin.auth.UserRecord;
  try {
    authUser = await admin.auth().getUser(userId);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      throw new HttpsError('unauthenticated', 'USER_NOT_FOUND: User account does not exist.');
    }
    throw new HttpsError('unavailable', 'Current account authority could not be verified. Please retry.');
  }
  if (!authUser || authUser.uid !== userId || authUser.disabled !== false) {
    throw new HttpsError('unauthenticated', 'User account is disabled or invalid.');
  }
  const currentRole = authUser.customClaims?.role;
  // Firebase may omit this optional property when no revocation epoch exists.
  // A present but malformed epoch is an authority failure, never "not revoked".
  const validAfterMs = normalizeTimestampToMillis(authUser.tokensValidAfterTime);
  if (authUser.tokensValidAfterTime !== undefined && validAfterMs === 0) {
    throw new HttpsError('unauthenticated', 'Invalid account revocation state. Please sign in again.');
  }
  // Callers that have the decoded ID token can additionally reject a revoked
  // sign-in even if MFA was attempted after that token's revocation epoch.
  if (token !== undefined && (!Number.isSafeInteger(token.auth_time) || token.auth_time <= 0 ||
      token.auth_time > Math.floor(Date.now() / 1000) || token.auth_time * 1000 < validAfterMs ||
      (token.uid !== undefined && token.uid !== userId) || (token.sub !== undefined && token.sub !== userId))) {
    throw new HttpsError('unauthenticated', 'USER_TOKENS_REVOKED: A current authenticated sign-in is required.');
  }

  let invalidation: { status: string; reason: string } | undefined;
  try {
    return await db.runTransaction(async transaction => {
      const sessionDoc = await transaction.get(sessionRef);
      if (!sessionDoc.exists) throw new HttpsError('permission-denied', 'Invalid privileged session identifier.');
      const data = sessionDoc.data()!;
      if (data.sessionId !== sessionId || data.userId !== userId || data.status !== 'ACTIVE' || data.mfaVerified !== true) {
        throw new HttpsError('permission-denied', 'Privileged session identity, MFA or active status is invalid.');
      }
      if (typeof currentRole !== 'string' || !['admin', 'manager', 'developer', 'security_admin'].includes(currentRole)) {
        invalidation = { status: 'REVOKED', reason: 'ROLE_NOT_PRIVILEGED' };
        throw new HttpsError('permission-denied', 'ROLE_REVOKED: Current user role is not authorized for privileged sessions.');
      }
      if (data.role !== currentRole) {
        invalidation = { status: 'REVOKED', reason: 'ROLE_CHANGED' };
        throw new HttpsError('permission-denied', 'ROLE_REVOKED: User role changed. Please re-authenticate with MFA.');
      }
      const now = Date.now();
      const createdMs = normalizeTimestampToMillis(data.createdAt);
      const expiresMs = normalizeTimestampToMillis(data.expiresAt);
      const activityMs = normalizeTimestampToMillis(data.lastActivityAt);
      if (!createdMs || !expiresMs || !activityMs || createdMs > now || activityMs < createdMs || activityMs > now ||
          expiresMs <= createdMs || expiresMs - createdMs > PRIVILEGED_SESSION_LIFETIME_MS || activityMs >= expiresMs) {
        invalidation = { status: 'REVOKED', reason: 'INVALID_SESSION_TIMING' };
        throw new HttpsError('permission-denied', 'Invalid privileged session timing. Please re-authenticate with MFA.');
      }
      if (createdMs < validAfterMs) {
        invalidation = { status: 'REVOKED', reason: 'FIREBASE_TOKENS_REVOKED' };
        throw new HttpsError('unauthenticated', 'USER_TOKENS_REVOKED: Please sign in again.');
      }
      if (now >= expiresMs || now - createdMs >= PRIVILEGED_SESSION_LIFETIME_MS) {
        invalidation = { status: 'EXPIRED', reason: 'PRIVILEGED_SESSION_EXPIRED' };
        throw new HttpsError('permission-denied', 'PRIVILEGED_SESSION_EXPIRED: Please re-authenticate with MFA.');
      }
      if (now - activityMs >= PRIVILEGED_SESSION_IDLE_TIMEOUT_MS) {
        invalidation = { status: 'IDLE_TIMEOUT', reason: 'PRIVILEGED_SESSION_IDLE_TIMEOUT' };
        throw new HttpsError('permission-denied', 'PRIVILEGED_SESSION_IDLE_TIMEOUT: Please re-authenticate with MFA.');
      }
      // Validate and touch the same snapshot so a concurrent revocation cannot
      // be lost between the active-session read and the activity write.
      transaction.update(sessionRef, { lastActivityAt: Timestamp.fromMillis(now) });
      return { sessionId, role: currentRole };
    });
  } catch (err) {
    if (invalidation) {
      await sessionRef.update(invalidation).catch(() => {});
      await logSecurityEvent({
        eventType: invalidation.reason,
        severity: 'MEDIUM',
        actorUid: userId,
        details: { operation, sessionId },
      });
    }
    throw err;
  }
}
