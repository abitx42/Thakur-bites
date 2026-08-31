import { onSchedule } from 'firebase-functions/v2/scheduler';
import { reconcileDailyLedger } from './payments';
import { logSecurityEvent } from './security_logger';

/**
 * Scheduled Cloud Function: Daily End-of-Day Financial Reconciliation
 * Runs automatically every night at 23:59 IST (Asia/Kolkata).
 */
export const scheduledDailyReconciliation = onSchedule(
  {
    schedule: '59 23 * * *',
    timeZone: 'Asia/Kolkata',
    retryCount: 3,
  },
  async (event) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    try {
      const record = await reconcileDailyLedger(today);

      if (record.status === 'DISCREPANCY_FLAGGED') {
        await logSecurityEvent({
          eventType: 'FINANCIAL_RECONCILIATION_DISCREPANCY',
          severity: 'HIGH',
          actorUid: 'system_cron',
          details: {
            date: today,
            discrepanciesCount: record.discrepanciesCount,
            auditNotes: record.auditNotes,
            totalRevenue: record.totalRevenueCalculated,
          },
        });
      }
    } catch (err: any) {
      await logSecurityEvent({
        eventType: 'FINANCIAL_RECONCILIATION_CRON_FAILED',
        severity: 'CRITICAL',
        actorUid: 'system_cron',
        details: { date: today, errorMessage: err.message },
      });
      // Rethrow so Cloud Scheduler triggers configured retry attempts (retryCount: 3)
      throw err;
    }
  }
);
