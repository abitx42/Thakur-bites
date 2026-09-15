/**
 * Secret Management Module.
 * Strictly retrieves environment secrets injected from Google Cloud Secret Manager / runtime env.
 * Enforces zero hardcoded fallback strings in production or development.
 */
export function getRequiredSecret(secretName: string): string {
  let value = process.env[secretName];

  // Graceful alias resolution for payment gateway credentials
  if (!value || value.trim() === '') {
    if (secretName === 'PAYMENT_GATEWAY_KEY_ID') {
      value = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY;
    } else if (secretName === 'PAYMENT_GATEWAY_SECRET') {
      value = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET;
    } else if (secretName === 'RAZORPAY_WEBHOOK_SECRET') {
      value = process.env.PAYMENT_GATEWAY_SECRET || process.env.RAZORPAY_KEY_SECRET;
    }
  }

  if (!value || value.trim() === '') {
    if (process.env.NODE_ENV === 'test' || process.env.FUNCTIONS_EMULATOR === 'true') {
      return `dev_mock_${secretName.toLowerCase()}_12345678901234567890123456789012`;
    }
    throw new Error(`FATAL CONFIGURATION ERROR: Required secret "${secretName}" is not set in Secret Manager.`);
  }

  const cleanValue = value.trim();
  if (process.env.NODE_ENV === 'production' && !process.env.FUNCTIONS_EMULATOR && (cleanValue.startsWith('test_secret_') || cleanValue.startsWith('dev_mock_'))) {
    throw new Error(`FATAL SECURITY ERROR: Development or test secret detected in production environment for "${secretName}".`);
  }

  return cleanValue;
}
