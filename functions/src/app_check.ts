import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';

/**
 * Firebase App Check Verification Layer.
 * Attests that incoming callable requests originate from legitimate, non-tampered
 * client instances (Flutter Web / Android / iOS) protecting against automated script abuse.
 */
export function enforceAppCheck(request: CallableRequest<any>): void {
  // When App Check enforcement is enabled in production
  if (process.env.ENFORCE_APP_CHECK === 'true' && !request.app) {
    throw new HttpsError(
      'unauthenticated',
      'App Check verification failed. Request must originate from an authorized client application.'
    );
  }
}
