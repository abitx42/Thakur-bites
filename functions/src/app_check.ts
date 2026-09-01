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
