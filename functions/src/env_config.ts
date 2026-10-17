/**
 * Platform 2.0 — Canonical Environment Isolation & Runtime Configuration Guard.
 * 
 * Invariants Enforced:
 * 1. Immutable Environment Classification: Explicit, fail-closed separation between production and non-production.
 * 2. Zero-Simulation Invariant in Production: Payment simulation, mock gateways, or bypasses are strictly forbidden in production.
 * 3. Secret Leak Defense: Rejects development or mock credentials against production project IDs.
 */

export type RuntimeEnvironment = 'production' | 'staging' | 'test' | 'development';

function envValue(name: string): string {
  return (process.env[name] || '').trim();
}

function firebaseProjectId(): string {
  const raw = envValue('FIREBASE_CONFIG');
  if (!raw) return '';
  const invalidConfig = () => new Error('FIREBASE_CONFIG configuration error: expected a JSON object with a string projectId.');
  let config: any;
  try {
    config = JSON.parse(raw);
  } catch (_) {
    throw invalidConfig();
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config.projectId !== undefined && typeof config.projectId !== 'string')) throw invalidConfig();
  return (config.projectId || '').trim();
}

export function getProjectId(): string {
  // Cloud's authoritative project ID wins without parsing an unused JSON value.
  return envValue('GCLOUD_PROJECT') || envValue('GOOGLE_CLOUD_PROJECT') || firebaseProjectId() || envValue('PROJECT_ID');
}

function isProductionProject(projectId: string): boolean {
  const clean = projectId.toLowerCase();
  return clean.includes('prod') || clean.includes('thakurbites-live') || clean === 'adi-thakur-bite';
}

export function detectEnvironment(): RuntimeEnvironment {
  const nodeEnv = envValue('NODE_ENV').toLowerCase();
  // A deployed Cloud Run/Functions service is never a development or test
  // runtime merely because NODE_ENV or a simulation/emulator flag says so.
  if (nodeEnv === 'production' || envValue('K_SERVICE')) return 'production';
  const projectId = getProjectId().toLowerCase();
  const projectIds = [projectId, envValue('GCLOUD_PROJECT'), envValue('GOOGLE_CLOUD_PROJECT'), envValue('PROJECT_ID')];
  if (envValue('GCLOUD_PROJECT') || envValue('GOOGLE_CLOUD_PROJECT')) {
    // Conflicting but valid Firebase configuration must not hide a known live
    // project. Malformed *unused* JSON cannot replace the authoritative ID.
    try { projectIds.push(firebaseProjectId()); } catch (_) {}
  }
  if (projectIds.some(isProductionProject)) return 'production';
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

export function isTrustedEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' && !isProduction();
}

export function isSimulationAllowed(): boolean {
  // STRICT INVARIANT: Payment or auth simulation is NEVER allowed in production
  const environment = detectEnvironment();
  if (environment === 'production') return false;
  const flag = process.env.SIMULATE_PAYMENTS;
  return flag === undefined ? environment === 'test' : flag === 'true';
}

export function assertNotProduction(operation: string): void {
  if (isProduction()) {
    throw new Error(`SECURITY VIOLATION: Operation "${operation}" is strictly forbidden in production environment.`);
  }
}

/**
 * Validates that credentials and simulation flags conform strictly to environment boundaries.
 * Invariant:
 * - Production strictly requires live credentials and prohibits simulation.
 * - Non-production strictly prohibits live credentials.
 */
export function validateEnvironmentCredentials(config: {
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  allowSimulation?: boolean;
}): { valid: boolean; environment: RuntimeEnvironment } {
  const env = detectEnvironment();

  if (env === 'production') {
    if (config.allowSimulation === true) {
      throw new Error('SECURITY VIOLATION: Simulation flags are strictly prohibited in production environment.');
    }
    if (config.razorpayKeyId && !config.razorpayKeyId.startsWith('rzp_live_')) {
      throw new Error('SECURITY VIOLATION: Production must strictly use live Razorpay credentials (rzp_live_*). Test keys rejected.');
    }
  } else {
    // Development, test, staging
    if (config.razorpayKeyId && config.razorpayKeyId.startsWith('rzp_live_')) {
      throw new Error('SECURITY VIOLATION: Live Razorpay credentials (rzp_live_*) are strictly forbidden in non-production environments.');
    }
  }

  return { valid: true, environment: env };
}
