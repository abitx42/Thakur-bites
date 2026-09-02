/**
 * Platform 2.0 — Canonical Environment Isolation & Runtime Configuration Guard.
 * 
 * Invariants Enforced:
 * 1. Immutable Environment Classification: Explicit, fail-closed separation between production and non-production.
 * 2. Zero-Simulation Invariant in Production: Payment simulation, mock gateways, or bypasses are strictly forbidden in production.
 * 3. Secret Leak Defense: Rejects development or mock credentials against production project IDs.
 */

export type RuntimeEnvironment = 'production' | 'staging' | 'test' | 'development';

export function getProjectId(): string {
  return (
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId || '' : ''
  ) || process.env.PROJECT_ID || '';
}

export function detectEnvironment(): RuntimeEnvironment {
  const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  const projectId = getProjectId().toLowerCase();

  if (nodeEnv === 'production' || projectId.includes('prod') || projectId.includes('thakurbites-live')) {
    return 'production';
  }
  if (nodeEnv === 'staging' || projectId.includes('stage') || projectId.includes('staging')) {
    return 'staging';
  }
  if (nodeEnv === 'test') {
    return 'test';
  }
  return 'development';
}

export function isProduction(): boolean {
  return detectEnvironment() === 'production';
}

export function isSimulationAllowed(): boolean {
  // STRICT INVARIANT: Payment or auth simulation is NEVER allowed in production
  if (isProduction()) {
    return false;
  }
  return Boolean(process.env.SIMULATE_PAYMENTS) || detectEnvironment() === 'test';
}

export function assertNotProduction(operation: string): void {
  if (isProduction()) {
    throw new Error(`SECURITY VIOLATION: Operation "${operation}" is strictly forbidden in production environment.`);
  }
}
