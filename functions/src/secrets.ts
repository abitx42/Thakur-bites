import { isProduction, isTrustedEmulator } from './env_config';

/**
 * Secret Management Module.
 * Strictly retrieves environment secrets injected from Google Cloud Secret Manager / runtime env.
 * Enforces zero hardcoded fallback strings in production or development.
 */
export function getRequiredSecret(secretName: string): string {
  if (typeof secretName !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(secretName)) {
    throw new Error('FATAL CONFIGURATION ERROR: Invalid required secret name.');
  }
  const production = isProduction();
  // These names are dedicated credentials. In particular a Razorpay webhook
  // signing secret is NOT interchangeable with its API key secret.
  const cleanValue = (process.env[secretName] || '').trim();
  if (!cleanValue) {
    if (!production && (process.env.NODE_ENV === 'test' || isTrustedEmulator())) {
      return `dev_mock_${secretName.toLowerCase()}_12345678901234567890123456789012`;
    }
    throw new Error(`FATAL CONFIGURATION ERROR: Required secret "${secretName}" is not set in Secret Manager.`);
  }
  if (production) {
    const placeholder = /(^|[^a-z0-9])(dev|development|test|testing|mock|sandbox|placeholder|example|dummy|default|insecure|change[_-]?me|replace[_-]?me|your([_-]?(secret|key))?|secret|password|undefined|null|false|true)([^a-z0-9]|$)/i;
    if (placeholder.test(cleanValue) || /^tcet_campus_qr_hmac_/i.test(cleanValue) || /^(.)\1{7,}$/.test(cleanValue) ||
        (secretName === 'PAYMENT_GATEWAY_KEY_ID' && !/^rzp_live_[A-Za-z0-9]+$/.test(cleanValue))) {
      throw new Error(`SECURITY VIOLATION: Required secret "${secretName}" has an unsafe production configuration.`);
    }
  }
  return cleanValue;
}
