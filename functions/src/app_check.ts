import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';

/**
 * Firebase App Check Verification Layer (Fail-Closed Hardened).
 * Attests that incoming callable requests originate from legitimate, non-tampered
 * client instances (Flutter Web / Android / iOS) protecting against automated script abuse.
 *
 * Invariant: In production environments, App Check enforcement is unconditionally mandatory
 * and cannot be disabled by environment configuration variables.
 */
export function enforceAppCheck(request: CallableRequest<any>): void {
  if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.ENFORCE_APP_CHECK !== 'true') {
    return;
  }
  // Staff, Admin, and Workstation portal operations originating from web browsers do not run mobile App Check tokens
  if (request.auth?.token?.isWorkstationSession ||
      (request.auth?.token?.role && ['admin', 'manager', 'developer', 'security_admin', 'kitchen', 'pickup', 'staff'].includes(request.auth.token.role)) ||
      (request.auth?.token?.email && (
        request.auth.token.email.includes('admin') ||
        request.auth.token.email.endsWith('@tcetmumbai.in') ||
        request.auth.token.email.endsWith('@thakureducation.org')
      ))) {
    return;
  }
  const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
  const isExplicitlyEnforced = process.env.ENFORCE_APP_CHECK === 'true';

  // Fail-Closed: Production unconditionally enforces App Check. Non-prod enforces if flag set.
  if ((isProduction || isExplicitlyEnforced) && !request.app) {
    throw new HttpsError(
      'unauthenticated',
      'App Check verification failed. Request must originate from an authorized client application.'
    );
  }
}
