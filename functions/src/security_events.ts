import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { assertNoHoneytokens } from './honeypot_defense';

export type SecurityViolationType =
  | 'DEV_OPTIONS_ACTIVE'
  | 'ADB_ACTIVE'
  | 'ROOT_DETECTED'
  | 'TAMPERED_APK_SIGNATURE'
  | 'CLIENT_DOM_TAMPERING'
  | 'FRIDA_HOOK_DETECTED'
  | 'DEBUGGER_ATTACHED'
  | 'CANARY_TRIPWIRE_TRIGGERED'
  | 'CLIENT_CODE_TAMPERED'
  | 'CLONED_APP_DETECTED'
  | 'PROTOTYPE_POLLUTION_ATTACK'
  | 'CLIENT_STORAGE_TAMPERING'
  | 'KEYBOARD_ESCAPE_ATTEMPT'
  | 'AUTOMATED_BOT_PROBE'
  | 'MEMORY_CHEAT_ENGINE';

const CRITICAL_VIOLATIONS: Set<SecurityViolationType> = new Set([
  'ROOT_DETECTED',
  'TAMPERED_APK_SIGNATURE',
  'CLIENT_DOM_TAMPERING',
  'FRIDA_HOOK_DETECTED',
  'DEBUGGER_ATTACHED',
  'CANARY_TRIPWIRE_TRIGGERED',
  'CLIENT_CODE_TAMPERED',
  'CLONED_APP_DETECTED',
  'PROTOTYPE_POLLUTION_ATTACK',
  'CLIENT_STORAGE_TAMPERING',
  'KEYBOARD_ESCAPE_ATTEMPT',
  'AUTOMATED_BOT_PROBE',
  'MEMORY_CHEAT_ENGINE',
]);

export const reportSecurityViolation = onCall(
  {
    region: 'us-central1',
    maxInstances: 20,
  },
  async (request: CallableRequest<any>) => {
    // VULN-17: Record App Check attestation as telemetry rather than hard-blocking,
    // allowing rooted/compromised devices where Play Integrity fails to deliver security telemetry.
    const appCheckAttested = Boolean(request.app);

    await assertNoHoneytokens(request.data, request.auth?.uid, 'reportSecurityViolation');

    const actorUid = request.auth?.uid || 'anonymous';
    const rawDevId = typeof request.data?.deviceId === 'string' ? request.data.deviceId.trim().slice(0, 128) : '';
    const clientIp = request.rawRequest?.ip || '0.0.0.0';
    const anonHash = crypto.createHash('sha256').update(`${clientIp}_${rawDevId || 'anon'}`).digest('hex').slice(0, 16);
    const actorKey = request.auth?.uid || `anon_${anonHash}`;
    await enforceRateLimit(actorKey, 'security_report');

    const { violationType, deviceId, details = {} } = request.data || {};

    const validTypes: SecurityViolationType[] = [
      'DEV_OPTIONS_ACTIVE',
      'ADB_ACTIVE',
      'ROOT_DETECTED',
      'TAMPERED_APK_SIGNATURE',
      'CLIENT_DOM_TAMPERING',
      'FRIDA_HOOK_DETECTED',
      'DEBUGGER_ATTACHED',
      'CANARY_TRIPWIRE_TRIGGERED',
      'CLIENT_CODE_TAMPERED',
      'CLONED_APP_DETECTED',
      'PROTOTYPE_POLLUTION_ATTACK',
      'CLIENT_STORAGE_TAMPERING',
      'KEYBOARD_ESCAPE_ATTEMPT',
      'AUTOMATED_BOT_PROBE',
      'MEMORY_CHEAT_ENGINE',
    ];

    if (!violationType || typeof violationType !== 'string' || !validTypes.includes(violationType as SecurityViolationType)) {
      throw new HttpsError('invalid-argument', 'Invalid or unsupported security violation type.');
    }

    const type = violationType as SecurityViolationType;
    const sanitizedDeviceId = typeof deviceId === 'string' && deviceId.trim().length > 0
      ? deviceId.trim().slice(0, 128)
      : undefined;

    const db = admin.firestore();
    const isCritical = CRITICAL_VIOLATIONS.has(type);

    // 1. Structured Immutable Security Audit Event
    const incidentId = await logSecurityEvent({
      actorUid,
      eventType: `VIOLATION_${type}`,
      severity: isCritical ? 'CRITICAL' : 'MEDIUM',
      details: {
        violationType: type,
        deviceId: sanitizedDeviceId || 'UNKNOWN',
        clientIp: request.rawRequest.ip || 'UNKNOWN',
        appCheckAttested,
        ...details,
      },
    });

    // 2. Automated Account & Device Ban Pipeline for Critical Violations
    if (isCritical) {
      const batch = db.batch();
      const now = Timestamp.now();

      // Deactivate user profile and invalidate auth session
      if (request.auth?.uid) {
        const userRef = db.collection('users').doc(request.auth.uid);
        batch.set(
          userRef,
          {
            accountDisabled: true,
            disabledReason: `Security policy violation: ${type}`,
            disabledAt: now,
            incidentId,
            updatedAt: now,
          },
          { merge: true }
        );

        try {
          await admin.auth().revokeRefreshTokens(request.auth.uid);
        } catch (revokeErr) {
          console.error(`[SECURITY_BAN] Failed to revoke tokens for ${request.auth.uid}:`, revokeErr);
        }
      }

      // Blacklist physical device hash for authenticated sessions, or quarantine for admin triage (TB-BUG-11)
      if (sanitizedDeviceId) {
        if (request.auth?.uid) {
          const deviceRef = db.collection('bannedDevices').doc(sanitizedDeviceId);
          batch.set(
            deviceRef,
            {
              deviceId: sanitizedDeviceId,
              bannedAt: now,
              reason: type,
              incidentId,
              associatedUid: request.auth.uid,
              details,
            },
            { merge: true }
          );
        } else {
          // Unauthenticated reports are quarantined for admin triage rather than executing an instant DoS
          const triageRef = db.collection('suspiciousDeviceReports').doc(`${sanitizedDeviceId}_${now.toMillis()}`);
          batch.set(
            triageRef,
            {
              deviceId: sanitizedDeviceId,
              reportedAt: now,
              reason: type,
              incidentId,
              details,
              status: 'PENDING_ADMIN_TRIAGE',
            },
            { merge: true }
          );
        }
      }

      await batch.commit();
      console.warn(`[SECURITY_BAN_ENFORCED] Incident ${incidentId}: User=${actorUid}, Device=${sanitizedDeviceId || 'N/A'}, Type=${type}`);
    }

    return {
      success: true,
      incidentId,
      actionTaken: isCritical ? 'ACCOUNT_AND_DEVICE_RESTRICTED' : 'LOGGED_AND_MONITORED',
    };
  }
);
