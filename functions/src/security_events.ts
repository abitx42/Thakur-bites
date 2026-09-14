import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';

export type SecurityViolationType =
  | 'DEV_OPTIONS_ACTIVE'
  | 'ADB_ACTIVE'
  | 'ROOT_DETECTED'
  | 'TAMPERED_APK_SIGNATURE'
  | 'CLIENT_DOM_TAMPERING';

const CRITICAL_VIOLATIONS: Set<SecurityViolationType> = new Set([
  'ROOT_DETECTED',
  'TAMPERED_APK_SIGNATURE',
  'CLIENT_DOM_TAMPERING',
]);

export const reportSecurityViolation = onCall(
  {
    region: 'asia-south1',
    maxInstances: 20,
  },
  async (request: CallableRequest<any>) => {
    enforceAppCheck(request);

    const actorUid = request.auth?.uid || 'anonymous';
    await enforceRateLimit(actorUid, 'security_report');

    const { violationType, deviceId, details = {} } = request.data || {};

    const validTypes: SecurityViolationType[] = [
      'DEV_OPTIONS_ACTIVE',
      'ADB_ACTIVE',
      'ROOT_DETECTED',
      'TAMPERED_APK_SIGNATURE',
      'CLIENT_DOM_TAMPERING',
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

      // Blacklist physical device hash
      if (sanitizedDeviceId) {
        const deviceRef = db.collection('bannedDevices').doc(sanitizedDeviceId);
        batch.set(
          deviceRef,
          {
            deviceId: sanitizedDeviceId,
            bannedAt: now,
            reason: type,
            incidentId,
            associatedUid: request.auth?.uid || null,
            details,
          },
          { merge: true }
        );
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
