import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { isAdministrativeRole, isDeveloperRole } from './authorization_policy';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ─── Pure Node RFC 6238 TOTP Engine (Zero external dependencies, 100% Free) ───

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_ALPHABET.indexOf(clean[i]);
    if (val === -1) {
      throw new Error(`Invalid base32 character: ${clean[i]}`);
    }
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function base32Encode(buffer: Buffer): string {
  let bits = '';
  for (let i = 0; i < buffer.length; i++) {
    bits += buffer[i].toString(2).padStart(8, '0');
  }
  let base32 = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    base32 += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return base32;
}

/**
 * Computes a 6-digit TOTP code for a given 30-second timeStep using HMAC-SHA1.
 */
export function generateTotp(secret: string | Buffer, timeStep: number): string {
  const secretBuffer = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
  buf.writeUInt32BE(timeStep & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', secretBuffer).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 1000000).toString().padStart(6, '0');
}

/**
 * Validates a 6-digit TOTP code within a window of clock drift steps (+/- window).
 * Returns { valid: boolean, matchedStep?: number }
 */
export function verifyTotpToken(
  secretBase32: string,
  token: string,
  window = 1
): { valid: boolean; matchedStep?: number } {
  try {
    const secretBuffer = base32Decode(secretBase32);
    const currentTimeStep = Math.floor(Date.now() / 1000 / 30);
    const cleanToken = String(token || '').trim();

    if (!/^\d{6}$/.test(cleanToken)) {
      return { valid: false };
    }

    for (let step = -window; step <= window; step++) {
      const targetStep = currentTimeStep + step;
      const expected = generateTotp(secretBuffer, targetStep);
      if (crypto.timingSafeEqual(Buffer.from(cleanToken), Buffer.from(expected))) {
        return { valid: true, matchedStep: targetStep };
      }
    }
  } catch (_) {}
  return { valid: false };
}

/**
 * Generates 8 cryptographically secure single-use recovery codes.
 */
export function generateRecoveryCodes(): { plaintextCodes: string[]; hashedCodes: string[] } {
  const plaintextCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < 8; i++) {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `${part1}-${part2}`;
    plaintextCodes.push(code);

    const hash = crypto.createHash('sha256').update(code).digest('hex');
    hashedCodes.push(hash);
  }

  return { plaintextCodes, hashedCodes };
}

// ─── 6-Hour Privileged Session Constants ───
export const PRIVILEGED_SESSION_LIFETIME_MS = 6 * 60 * 60 * 1000; // 6 Hours Maximum
export const PRIVILEGED_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 Minutes Idle Timeout

// ─── Callable Cloud Functions for MFA & Privileged Sessions ───

/**
 * Enroll in TOTP MFA
 * Generates a fresh Base32 secret, otpauth:// URL, and 8 backup recovery codes.
 */
export const enrollMfaTotp = onCall(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required for MFA enrollment.');
  }

  const userId = request.auth.uid;
  const userEmail = (request.auth.token.email as string | undefined)?.toLowerCase().trim() || 'user';
  const callerRole = (request.auth.token.role as string | undefined) || '';

  if (!isAdministrativeRole(callerRole) && !isDeveloperRole(callerRole)) {
    throw new HttpsError('permission-denied', 'MFA enrollment is currently restricted to Administrative & Developer accounts.');
  }

  await enforceRateLimit(userId, 'mfa_enrollment');

  const secretBuffer = crypto.randomBytes(20);
  const secretBase32 = base32Encode(secretBuffer);
  const { plaintextCodes, hashedCodes } = generateRecoveryCodes();

  const otpauthUrl = `otpauth://totp/ThakurBites:${encodeURIComponent(userEmail)}?secret=${secretBase32}&issuer=ThakurBites&algorithm=SHA1&digits=6&period=30`;

  // Store provisional enrollment until verified
  await db.collection('mfaEnrollments').doc(userId).set({
    userId,
    userEmail,
    secretBase32,
    recoveryCodeHashes: hashedCodes,
    mfaEnabled: false,
    updatedAt: admin.firestore.Timestamp.now(),
  }, { merge: true });

  await logSecurityEvent({
    eventType: 'MFA_ENROLLMENT_INITIATED',
    severity: 'INFO',
    actorUid: userId,
    details: { userEmail, role: callerRole },
  });

  return {
    success: true,
    secret: secretBase32,
    otpauthUrl,
    recoveryCodes: plaintextCodes,
  };
});

/**
 * Verify and Enable TOTP MFA
 * Requires caller to provide the 6-digit code currently shown on their Authenticator App.
 */
export const verifyAndEnableMfaTotp = onCall(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const userId = request.auth.uid;
  const { code } = request.data || {};

  if (!code || typeof code !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid 6-digit TOTP verification code is required.');
  }

  const mfaDoc = await db.collection('mfaEnrollments').doc(userId).get();
  if (!mfaDoc.exists || !mfaDoc.data()?.secretBase32) {
    throw new HttpsError('failed-precondition', 'MFA enrollment must be initiated first.');
  }

  const { secretBase32 } = mfaDoc.data()!;
  const result = verifyTotpToken(secretBase32, code, 1);

  if (!result.valid) {
    throw new HttpsError('invalid-argument', 'Invalid verification code. Please check your authenticator clock and try again.');
  }

  await db.collection('mfaEnrollments').doc(userId).update({
    mfaEnabled: true,
    activatedAt: admin.firestore.Timestamp.now(),
    lastUsedStep: result.matchedStep || Math.floor(Date.now() / 1000 / 30),
  });

  await logSecurityEvent({
    eventType: 'MFA_TOTP_ACTIVATED',
    severity: 'MEDIUM',
    actorUid: userId,
    details: { activatedAt: new Date().toISOString() },
  });

  return {
    success: true,
    message: 'Authenticator MFA successfully activated for your account.',
  };
});

/**
 * Create a 6-Hour Privileged Session
 * Authenticates user credentials with mandatory TOTP MFA (or recovery code),
 * issuing a time-bounded privileged session for Admin or Developer tasks.
 */
export const createPrivilegedSession = onCall(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication required.');
  }

  const userId = request.auth.uid;
  const callerRole = (request.auth.token.role as string | undefined) || '';

  if (!isAdministrativeRole(callerRole) && !isDeveloperRole(callerRole)) {
    throw new HttpsError('permission-denied', 'Privileged sessions are only available to administrative and engineering roles.');
  }

  await enforceRateLimit(userId, 'privileged_session_auth');

  const { totpCode, recoveryCode } = request.data || {};
  const mfaDoc = await db.collection('mfaEnrollments').doc(userId).get();

  if (!mfaDoc.exists || !mfaDoc.data()?.mfaEnabled) {
    throw new HttpsError('failed-precondition', 'MFA_ENROLLMENT_REQUIRED: You must configure an Authenticator App to access privileged portals.');
  }

  const mfaData = mfaDoc.data()!;
  let mfaMethod: 'TOTP' | 'RECOVERY_CODE' = 'TOTP';

  if (totpCode) {
    const verification = verifyTotpToken(mfaData.secretBase32, String(totpCode), 1);
    if (!verification.valid) {
      await logSecurityEvent({
        eventType: 'PRIVILEGED_AUTH_FAILED_BAD_TOTP',
        severity: 'MEDIUM',
        actorUid: userId,
        details: { role: callerRole },
      });
      throw new HttpsError('unauthenticated', 'Incorrect authenticator code. Please enter the current 6-digit code.');
    }

    // Replay defense
    if (mfaData.lastUsedStep && verification.matchedStep && verification.matchedStep <= mfaData.lastUsedStep) {
      throw new HttpsError('invalid-argument', 'Authenticator code already consumed. Please wait for the next 30-second token.');
    }

    await db.collection('mfaEnrollments').doc(userId).update({
      lastUsedStep: verification.matchedStep,
    });
  } else if (recoveryCode) {
    // Check single-use recovery code
    const cleanRecovery = String(recoveryCode).trim().toUpperCase();
    const codeHash = crypto.createHash('sha256').update(cleanRecovery).digest('hex');
    const existingHashes: string[] = Array.isArray(mfaData.recoveryCodeHashes) ? mfaData.recoveryCodeHashes : [];

    const matchedIndex = existingHashes.indexOf(codeHash);
    if (matchedIndex === -1) {
      throw new HttpsError('unauthenticated', 'Invalid backup recovery code.');
    }

    // Consume single-use code immediately
    existingHashes.splice(matchedIndex, 1);
    await db.collection('mfaEnrollments').doc(userId).update({
      recoveryCodeHashes: existingHashes,
    });
    mfaMethod = 'RECOVERY_CODE';

    await logSecurityEvent({
      eventType: 'MFA_RECOVERY_CODE_CONSUMED',
      severity: 'HIGH',
      actorUid: userId,
      details: { remainingCodes: existingHashes.length },
    });
  } else {
    throw new HttpsError('invalid-argument', 'Either 6-digit totpCode or emergency recoveryCode must be provided.');
  }

  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + PRIVILEGED_SESSION_LIFETIME_MS);
  const sessionId = `psess_${crypto.randomBytes(18).toString('hex')}`;

  const sessionData = {
    sessionId,
    userId,
    userEmail: (request.auth.token.email as string | undefined) || '',
    role: callerRole,
    createdAt: now,
    expiresAt,
    lastActivityAt: now,
    mfaVerified: true,
    mfaMethod,
    status: 'ACTIVE',
  };

  await db.collection('privilegedSessions').doc(sessionId).set(sessionData);

  await logSecurityEvent({
    eventType: 'PRIVILEGED_SESSION_CREATED',
    severity: 'INFO',
    actorUid: userId,
    details: {
      sessionId,
      role: callerRole,
      mfaMethod,
      lifetimeHours: 6,
    },
  });

  return {
    success: true,
    sessionId,
    expiresAt: expiresAt.toDate().toISOString(),
    lifetimeHours: 6,
    role: callerRole,
  };
});
