import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { isProduction } from './env_config';

/**
 * Firebase App Check Verification Layer (Fail-Closed Hardened).
 * Attests that incoming callable requests originate from legitimate, non-tampered
 * client instances (Flutter Web / Android / iOS) protecting against automated script abuse.
 *
 * Invariant: In production environments, App Check enforcement is unconditionally mandatory
 * and cannot be disabled by environment configuration variables.
 */
export function enforceAppCheck(request: CallableRequest<any>): void {
  // request.app is installed by Firebase's callable verifier, never by request
  // data. Authentication, email, role and workstation claims are not attestation.
  // A production signal also overrides emulator/disable flags.
  const required = isProduction() || process.env.ENFORCE_APP_CHECK === 'true';
  if (required && (!request?.app || typeof request.app.appId !== 'string' || !request.app.appId.trim())) {
    throw new HttpsError(
      'unauthenticated',
      'App Check verification failed. Request must originate from an authorized client application.'
    );
  }
}
