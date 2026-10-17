/**
 * PUBLIC build/deploy configuration. Never put server secrets in this file.
 *
 * Required before deploying the staff/enrolment portal:
 * 1. Register this web app with Firebase App Check using reCAPTCHA v3 and
 *    authorize the actual staff/enrolment domains for that reCAPTCHA key.
 * 2. Set appCheckSiteKey below to that PUBLIC site key. The same public key can
 *    be passed to Flutter as --dart-define=FIREBASE_APP_CHECK_WEB_KEY=... .
 * 3. Permit reCAPTCHA's script/frame/connect origins in Hosting's CSP (including
 *    https://www.google.com/recaptcha/ and https://www.gstatic.com/recaptcha/).
 *    The current hosting policy must be aligned before production attestation
 *    can work. Missing configuration blocks startup, not server enforcement.
 *
 * Local Functions emulator routing is OFF by default. To opt in on a loopback
 * browser only, set functionsEmulator to { host: '127.0.0.1', port: 5001 }.
 * The port must serve the actual Functions emulator, not the static web server.
 * A keyless bootstrap is permitted only with that explicit local destination;
 * the backend still requires attestation for any production runtime/project.
 * No App Check debug token is enabled or supplied by this configuration.
 */
export const publicConfig = Object.freeze({
  appCheckSiteKey: '',
  functionsEmulator: null,
});
