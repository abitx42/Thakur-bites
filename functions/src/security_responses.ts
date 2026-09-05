import { HttpsError } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';
import { logSecurityEvent } from './security_logger';

export interface SecuritySanitizedResponse {
  success: boolean;
  error: string;
  message: string;
  incidentId: string;
}

/**
 * Standardized Non-Oracle Defense Response Generator.
 * Returns a uniform, non-revealing error payload with a correlation incidentId.
 * Never leaks internal WAF rules, SQL/NoSQL schema names, regex patterns, or rate-limit thresholds.
 */
export function createSecuritySanitizedResponse(incidentId: string, customMessage?: string): SecuritySanitizedResponse {
  return {
    success: false,
    error: 'REQUEST_REJECTED',
    message: customMessage || 'Request denied. Security policy violation.',
    incidentId: incidentId.replace('INCIDENT-', ''),
  };
}

/**
 * Authoritative Central Error Sanitizer.
 * Intercepts internal exceptions, gateway failures, and database errors.
 * Logs full diagnostic trace internally while returning an opaque HttpsError to the caller.
 */
export function createSanitizedHttpsError(
  category: 'PAYMENT' | 'REFUND' | 'CHECKOUT' | 'DATABASE' | 'SYSTEM',
  error: unknown,
  context: { orderId?: string; actorUid?: string; details?: Record<string, any> } = {}
): HttpsError {
  const correlationId = `SEC-${category.slice(0, 3)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const rawStack = error instanceof Error ? error.stack : undefined;

  logSecurityEvent({
    eventType: `${category}_INTERNAL_ERROR_INTERCEPTED`,
    severity: 'HIGH',
    orderId: context.orderId,
    actorUid: context.actorUid || 'system',
    details: {
      correlationId,
      internalError: rawMessage,
      stackTrace: rawStack,
      ...context.details,
    },
  }).catch(() => {});

  return new HttpsError(
    'internal',
    `Unable to process ${category.toLowerCase()} request. Please try again later or contact support with reference ${correlationId}.`
  );
}
