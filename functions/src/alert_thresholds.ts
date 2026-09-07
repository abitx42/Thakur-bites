/**
 * Phase 9 — Production Operational SLI/SLO Alerting Thresholds
 * Formalizes quantifiable Service Level Indicators (SLIs) and Service Level Objectives (SLOs)
 * that dynamically govern circuit-breaker state transitions.
 */

export interface SystemMetrics {
  checkoutAttempts: number;
  checkoutSuccesses: number;
  paymentReconciliationDelaySeconds: number;
  stockContentionEvents: number;
  unbalancedLedgersDetected: number;
  webhookSignatureAttacks: number;
  negativeStockDetected: number;
  unauthorizedAdminEscalations: number;
  breakGlassTokensUsed: number;
  averageQueueWaitMinutes: number;
}

export type AlertThresholdLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';

export interface AlertThresholdEvaluation {
  level: AlertThresholdLevel;
  recommendedAction: 'NONE' | 'NOTIFY_MANAGER' | 'SWITCH_TO_DEGRADED' | 'SWITCH_TO_FINANCIAL_FROZEN';
  reasons: string[];
  metricsSnapshot: {
    checkoutSuccessRate: number;
    paymentReconciliationDelaySeconds: number;
    averageQueueWaitMinutes: number;
  };
}

/**
 * Evaluates current system metrics against authoritative operational SLOs.
 */
export function evaluateOperationalSLOs(metrics: SystemMetrics): AlertThresholdEvaluation {
  const reasons: string[] = [];

  const successRate = metrics.checkoutAttempts > 0
    ? metrics.checkoutSuccesses / metrics.checkoutAttempts
    : 1.0;

  // 1. EMERGENCY THRESHOLDS (Immediate Financial Freeze)
  if (metrics.unbalancedLedgersDetected > 0) {
    reasons.push(`CRITICAL INTEGRITY BREACH: ${metrics.unbalancedLedgersDetected} unbalanced double-entry ledger(s) detected.`);
  }
  if (metrics.unauthorizedAdminEscalations > 0) {
    reasons.push(`SECURITY VIOLATION: ${metrics.unauthorizedAdminEscalations} unauthorized admin privilege escalation attempt(s).`);
  }
  if (metrics.breakGlassTokensUsed > 0) {
    reasons.push(`FORENSIC ESCALATION: Emergency break-glass override token was consumed.`);
  }

  if (reasons.length > 0) {
    return {
      level: 'EMERGENCY',
      recommendedAction: 'SWITCH_TO_FINANCIAL_FROZEN',
      reasons,
      metricsSnapshot: {
        checkoutSuccessRate: successRate,
        paymentReconciliationDelaySeconds: metrics.paymentReconciliationDelaySeconds,
        averageQueueWaitMinutes: metrics.averageQueueWaitMinutes,
      },
    };
  }

  // 2. CRITICAL THRESHOLDS (Switch to Degraded / Counter-Only)
  if (metrics.webhookSignatureAttacks > 0) {
    reasons.push(`GATEWAY TAMPER: ${metrics.webhookSignatureAttacks} forged webhook signature attack(s) intercepted.`);
  }
  if (metrics.negativeStockDetected > 0) {
    reasons.push(`INVENTORY OVERSELL: ${metrics.negativeStockDetected} item(s) dropped into negative inventory stock.`);
  }
  if (successRate < 0.90 && metrics.checkoutAttempts >= 10) {
    reasons.push(`CHECKOUT COLLAPSE: Checkout success rate dropped to ${(successRate * 100).toFixed(1)}% (Target >= 98%).`);
  }

  if (reasons.length > 0) {
    return {
      level: 'CRITICAL',
      recommendedAction: 'SWITCH_TO_DEGRADED',
      reasons,
      metricsSnapshot: {
        checkoutSuccessRate: successRate,
        paymentReconciliationDelaySeconds: metrics.paymentReconciliationDelaySeconds,
        averageQueueWaitMinutes: metrics.averageQueueWaitMinutes,
      },
    };
  }

  // 3. WARNING THRESHOLDS (Notify Staff / Shift Managers)
  if (successRate < 0.98 && metrics.checkoutAttempts >= 5) {
    reasons.push(`DEGRADED CHECKOUT: Checkout success rate is ${(successRate * 100).toFixed(1)}% (Below 98% SLO).`);
  }
  if (metrics.paymentReconciliationDelaySeconds > 120) {
    reasons.push(`PAYMENT SLOWDOWN: Gateway reconciliation delay is ${metrics.paymentReconciliationDelaySeconds}s (Target < 120s).`);
  }
  if (metrics.averageQueueWaitMinutes > 20) {
    reasons.push(`KITCHEN CONGESTION: Average kitchen queue wait time exceeded ${metrics.averageQueueWaitMinutes} mins.`);
  }
  if (metrics.stockContentionEvents > 5) {
    reasons.push(`STOCK CONTENTION: ${metrics.stockContentionEvents} simultaneous reservation contention conflicts detected.`);
  }

  if (reasons.length > 0) {
    return {
      level: 'WARNING',
      recommendedAction: 'NOTIFY_MANAGER',
      reasons,
      metricsSnapshot: {
        checkoutSuccessRate: successRate,
        paymentReconciliationDelaySeconds: metrics.paymentReconciliationDelaySeconds,
        averageQueueWaitMinutes: metrics.averageQueueWaitMinutes,
      },
    };
  }

  // 4. HEALTHY
  return {
    level: 'HEALTHY',
    recommendedAction: 'NONE',
    reasons: ['All operational counters within nominal SLO parameters.'],
    metricsSnapshot: {
      checkoutSuccessRate: successRate,
      paymentReconciliationDelaySeconds: metrics.paymentReconciliationDelaySeconds,
      averageQueueWaitMinutes: metrics.averageQueueWaitMinutes,
    },
  };
}
