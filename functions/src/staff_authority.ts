import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { isOperationalStaffRole } from './authorization_policy';
import { UserRole } from './types';

/** Current authority for permanent staff accounts, never customer/profile or workstation elevation. */
export async function assertCurrentStaffAuthority(uid: string, token: Record<string, any>): Promise<UserRole> {
  const invalidAuthority = () => new HttpsError('unauthenticated', 'Current staff authority is invalid or revoked. Please sign in again.');
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof uid !== 'string' || !uid || uid !== uid.trim() || uid.length > 128 || uid.includes('/') || uid.startsWith('staff_') ||
      !token || token.isWorkstationSession === true || typeof token.role !== 'string' || !isOperationalStaffRole(token.role) ||
      token.uid !== uid || token.sub !== uid ||
      !Number.isSafeInteger(token.auth_time) || token.auth_time <= 0 || token.auth_time > nowSeconds ||
      !Number.isSafeInteger(token.iat) || token.iat < token.auth_time || token.iat > nowSeconds) {
    throw invalidAuthority();
  }

  let user: admin.auth.UserRecord;
  try {
    if (!admin.apps.length) admin.initializeApp();
    user = await admin.auth().getUser(uid);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') throw invalidAuthority();
    throw new HttpsError('unavailable', 'Current staff authority could not be verified. Please retry.');
  }
  if (!user || user.uid !== uid || user.disabled !== false || user.customClaims?.role !== token.role ||
      user.customClaims?.isWorkstationSession === true) {
    throw invalidAuthority();
  }

  // Firebase may omit this optional epoch. A present malformed value must never
  // bypass revocation; refreshed token iat cannot replace original auth_time.
  if (user.tokensValidAfterTime !== undefined) {
    const validAfterMs = typeof user.tokensValidAfterTime === 'string' ? Date.parse(user.tokensValidAfterTime) : NaN;
    if (!Number.isFinite(validAfterMs) || validAfterMs <= 0 || validAfterMs > Date.now() || token.auth_time * 1000 < validAfterMs) {
      throw invalidAuthority();
    }
  }
  return token.role as UserRole;
}
