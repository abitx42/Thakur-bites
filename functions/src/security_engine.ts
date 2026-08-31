import * as crypto from 'crypto';
import { createSecuritySanitizedResponse, SecuritySanitizedResponse } from './security_responses';
import { logSecurityEvent } from './security_logger';

export type ThreatSignalType =
  | 'AUTH_FAILURE'
  | 'IDOR_ATTEMPT'
  | 'VELOCITY_SPIKE'
  | 'STATE_TAMPERING'
  | 'FINANCIAL_TAMPERING'
  | 'REPLAY_ATTACK'
  | 'DEVICE_MISMATCH';

export interface ThreatSignal {
  type: ThreatSignalType;
  details?: string;
  weightOverride?: number;
}

export type ThreatRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type MitigationAction = 'ALLOW' | 'THROTTLE' | 'BLOCK' | 'CONTAIN_AND_ALERT';

export interface ThreatEvaluationResult {
  riskScore: number;               // 0 to 100
  riskLevel: ThreatRiskLevel;      // LOW, MEDIUM, HIGH, CRITICAL
  action: MitigationAction;        // ALLOW, THROTTLE, BLOCK, CONTAIN_AND_ALERT
  incidentId?: string;             // SEC-XXXX
  signalsEvaluated: ThreatSignal[];
  sanitizedResponse?: SecuritySanitizedResponse;
}

export interface ThreatEvaluationContext {
  actorId: string;                 // User UID or anonymous identifier
  deviceId?: string;               // Hardware or browser fingerprint
  clientIp?: string;               // IP address (NAT-aware)
  endpoint: string;                // Target callable or API endpoint
  signals: ThreatSignal[];
}

const SIGNAL_WEIGHTS: Record<ThreatSignalType, number> = {
  AUTH_FAILURE: 20,
  IDOR_ATTEMPT: 25,
  VELOCITY_SPIKE: 15,
  STATE_TAMPERING: 30,
  FINANCIAL_TAMPERING: 40,
  REPLAY_ATTACK: 30,
  DEVICE_MISMATCH: 25,
};

/**
 * Calculates a composite threat risk score (0-100) based on multi-dimensional security signals.
 */
export function calculateThreatScore(signals: ThreatSignal[]): number {
  let score = 0;
  for (const signal of signals) {
    const weight = typeof signal.weightOverride === 'number'
      ? signal.weightOverride
      : (SIGNAL_WEIGHTS[signal.type] || 10);
    score += weight;
  }
  return Math.min(100, Math.max(0, score));
}

/**
 * Evaluates risk level and mitigation policy action from composite risk score.
 */
export function resolveRiskAction(score: number): { riskLevel: ThreatRiskLevel; action: MitigationAction } {
  if (score < 40) {
    return { riskLevel: 'LOW', action: 'ALLOW' };
  } else if (score < 70) {
    return { riskLevel: 'MEDIUM', action: 'THROTTLE' };
  } else if (score < 90) {
    return { riskLevel: 'HIGH', action: 'BLOCK' };
  } else {
    return { riskLevel: 'CRITICAL', action: 'CONTAIN_AND_ALERT' };
  }
}

/**
 * Generates an alphanumeric incident correlation ID (SEC-XXXX).
 */
export function generateIncidentId(): string {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SEC-${suffix}`;
}

/**
 * Evaluates security threats with college NAT-aware multi-dimensional context.
 * Guarantees shared campus IP subnets are never permanently blanket-banned.
 */
export async function evaluateSecurityThreat(
  context: ThreatEvaluationContext
): Promise<ThreatEvaluationResult> {
  const score = calculateThreatScore(context.signals);
  const { riskLevel, action } = resolveRiskAction(score);

  let incidentId: string | undefined;
  let sanitizedResponse: SecuritySanitizedResponse | undefined;

  if (action === 'BLOCK' || action === 'CONTAIN_AND_ALERT') {
    incidentId = generateIncidentId();
    sanitizedResponse = createSecuritySanitizedResponse(incidentId, 'Nice try. Try harder. 😉');

    // Async log security event with high signal deduplication
    try {
      await logSecurityEvent({
        actorUid: context.actorId,
        eventType: riskLevel === 'CRITICAL' ? 'SECURITY_BREACH_ATTEMPT' : 'AUTHORIZATION_DENIED',
        severity: riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        ipAddress: context.clientIp,
        details: {
          incidentId,
          riskScore: score,
          riskLevel,
          action,
          endpoint: context.endpoint,
          deviceId: context.deviceId || 'UNKNOWN_DEVICE',
          signals: context.signals.map(s => s.type),
        },
      });
    } catch {
      // Fire-and-forget telemetry error trap
    }
  }

  return {
    riskScore: score,
    riskLevel,
    action,
    incidentId,
    signalsEvaluated: context.signals,
    sanitizedResponse,
  };
}
