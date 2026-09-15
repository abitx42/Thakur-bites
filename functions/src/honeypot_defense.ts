import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * List of known AI-agent / adversarial scanner honeytoken keys.
 * These are parameters that legitimate Thakur Bites client apps NEVER send,
 * but that automated AI prompts, fuzzer tools, and testing scripts commonly inject.
 */
export const HONEYTOKEN_KEYS = new Set([
  'debug',
  'debugmode',
  'adminoverride',
  'bypassauth',
  'bypasspayment',
  'testmode',
  'forcerole',
  'simulatesuccess',
  'freemeal',
  'overrideprice',
  'overridepaise',
  'mockpayment',
  'isadmin',
  'disable_security',
  'skip_verification',
  'developer_key',
  'master_token',
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Patterns in text strings indicating prompt injection, NoSQL injection, or AI exploit probes.
 */
export const SUSPICIOUS_PAYLOAD_PATTERNS = [
  /\$(where|gt|gte|lt|lte|ne|regex|in|nin)["']?\s*:/i,
  /ignore\s+previous\s+instructions/i,
  /system\s*prompt\s*override/i,
  /<script\b/i,
  /\bjavascript\s*:/i,
];

export interface HoneytokenInspectionResult {
  hasHoneytoken: boolean;
  detectedTokens: string[];
}

/**
 * Recursively inspects any request payload (JSON object, array, or primitives)
 * for adversarial AI probe honeytokens, prototype pollution, or injection strings.
 */
export function inspectPayloadForHoneytokens(payload: any, depth = 0): HoneytokenInspectionResult {
  if (depth > 6 || payload === null || payload === undefined) {
    return { hasHoneytoken: false, detectedTokens: [] };
  }

  const detectedTokens: string[] = [];

  if (typeof payload === 'string') {
    for (const pattern of SUSPICIOUS_PAYLOAD_PATTERNS) {
      if (pattern.test(payload)) {
        detectedTokens.push(`STRING_PATTERN_${pattern.source}`);
      }
    }
  } else if (Array.isArray(payload)) {
    for (const item of payload) {
      const res = inspectPayloadForHoneytokens(item, depth + 1);
      if (res.hasHoneytoken) {
        detectedTokens.push(...res.detectedTokens);
      }
    }
  } else if (typeof payload === 'object') {
    // Check for prototype pollution attempt
    const rawKeys = Object.getOwnPropertyNames(payload);
    for (const key of rawKeys) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (HONEYTOKEN_KEYS.has(normalizedKey)) {
        detectedTokens.push(`KEY_${key}`);
      }

      // Recursively inspect child value
      try {
        const val = payload[key];
        const res = inspectPayloadForHoneytokens(val, depth + 1);
        if (res.hasHoneytoken) {
          detectedTokens.push(...res.detectedTokens);
        }
      } catch (_) {}
    }
  }

  return {
    hasHoneytoken: detectedTokens.length > 0,
    detectedTokens,
  };
}

/**
 * Executes an active containment tripwire when an adversarial AI probe or honeytoken is triggered.
 * 1. Logs a CRITICAL incident to securityEvents.
 * 2. Silently flags actor user profile for security investigation (accountDisabled = true).
 * 3. Throws a standardized, non-revealing error to prevent information leakage.
 */
export async function handleHoneypotTripwire(
  actorUid: string,
  endpoint: string,
  detectedTokens: string[],
  clientIp?: string
): Promise<never> {
  const incidentDigest = crypto.randomBytes(4).toString('hex').toUpperCase();
  const correlationId = `SEC-DECOY-${incidentDigest}`;

  console.warn(`[HONEYPOT_TRIPPED] Adversarial probe detected from actor ${actorUid} at ${endpoint}:`, detectedTokens);

  try {
    await logSecurityEvent({
      eventType: 'ADVERSARIAL_AI_PROBE_TRIPPED',
      severity: 'CRITICAL',
      actorUid,
      ipAddress: clientIp,
      details: {
        endpoint,
        detectedTokens,
        correlationId,
        timestamp: new Date().toISOString(),
      },
    });

    // Automatically quarantine user profile if authenticated
    if (actorUid && actorUid !== 'anonymous' && !actorUid.startsWith('unknown')) {
      const userRef = db.collection('users').doc(actorUid);
      await userRef.set({
        accountDisabled: true,
        accountQuarantined: true,
        quarantineReason: 'ADVERSARIAL_PROBE_TRIPWIRE',
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  } catch (err) {
    console.error('[HONEYPOT_TRIPWIRE_ERROR] Non-blocking telemetry notice:', err);
  }

  // Artificial non-oracle delay (150ms) to defeat automated high-concurrency fuzzers
  await new Promise((resolve) => setTimeout(resolve, 150));

  throw new HttpsError(
    'permission-denied',
    `Request rejected by security policy. Reference: ${correlationId}`
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * Enticing Decoy Callable Endpoint: simulateDeveloperBypass
 * ═══════════════════════════════════════════════════════════════════
 * This endpoint is intentionally named to appear like a testing or debug backdoor
 * to automated vulnerability scanners and AI coding agents.
 *
 * Any invocation unconditionally triggers the honeypot containment tripwire.
 */
export const simulateDeveloperBypass = onCall(async (request) => {
  const actorUid = request.auth?.uid || 'anonymous';
  const forwardedFor = request.rawRequest.headers['x-forwarded-for'];
  const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0].trim() || request.rawRequest.ip || 'unknown';

  await enforceRateLimit(actorUid, 'shift_pin_verification');

  await handleHoneypotTripwire(
    actorUid,
    'simulateDeveloperBypass',
    ['DECOY_ENDPOINT_INVOCATION'],
    clientIp
  );
});
