/**
 * Secret Management Module.
 * Strictly retrieves environment secrets injected from Google Cloud Secret Manager / runtime env.
 * Enforces zero hardcoded fallback strings in production or development.
 */
export function getRequiredSecret(secretName: string): string {
  const value = process.env[secretName];
  if (!value || value.trim() === '') {
    if (process.env.NODE_ENV === 'test') {
      return `test_secret_${secretName.toLowerCase()}`;
    }
    throw new Error(`FATAL CONFIGURATION ERROR: Required secret "${secretName}" is not set in Secret Manager.`);
  }

  const cleanValue = value.trim();
  if (process.env.NODE_ENV === 'production' && (cleanValue.startsWith('test_secret_') || cleanValue.startsWith('dev_mock_'))) {
    throw new Error(`FATAL SECURITY ERROR: Development or test secret detected in production environment for "${secretName}".`);
  }

  return cleanValue;
}
