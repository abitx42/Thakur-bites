/**
 * Thakur Bites Platform 2.0 — Read-Only AI Business Copilot Cloud Functions
 * 
 * Provides:
 * 1. buildSafeBusinessSnapshot: Authoritative, zero-PII aggregation of sales, inventory, and refunds.
 * 2. getAiBusinessSnapshot: Callable endpoint for current factual business state.
 * 3. aiBusinessChat: Callable endpoint for natural language query execution via swappable AI providers.
 * 
 * Protected by App Check, Role Capabilities (view_ai_business_insights), Honeypot checks, and Rate Limits.
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { enforceAppCheck } from './app_check';
import { assertCapability } from './authorization_policy';
import { enforceRateLimit } from './rate_limiter';
import { assertNoHoneytokens } from './honeypot_defense';
import { logSecurityEvent } from './security_logger';
import {
  AnalyticsPeriod,
  BusinessContext,
  AIAnswer,
  HourlySalesBucket,
  InventoryDepletionAlert,
  TopProductMetric,
} from './ai/ai_types';
import { sanitizeQuestion } from './ai/prompt_builder';
import { getAIRouter } from './ai/ai_router';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function getMumbaiNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

/**
 * Computes exact start and end Timestamps for the requested analytics window in Asia/Kolkata time.
 */
export function getPeriodTimestamps(period: AnalyticsPeriod): {
  start: Timestamp;
  end: Timestamp;
  label: string;
} {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  if (period === 'yesterday') {
    const yestDate = new Date(new Date(`${todayStr}T00:00:00+05:30`).getTime() - 86400000);
    const yestStr = yestDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const start = Timestamp.fromDate(new Date(`${yestStr}T00:00:00+05:30`));
    const end = Timestamp.fromDate(new Date(`${yestStr}T23:59:59.999+05:30`));
    return { start, end, label: `Yesterday (${yestStr})` };
  }

  if (period === 'last_7_days') {
    const start = Timestamp.fromDate(new Date(Date.now() - 7 * 86400000));
    const end = Timestamp.now();
    return { start, end, label: 'Last 7 Days' };
  }

  if (period === 'last_30_days') {
    const start = Timestamp.fromDate(new Date(Date.now() - 30 * 86400000));
    const end = Timestamp.now();
    return { start, end, label: 'Last 30 Days' };
  }

  // Default: 'today'
  const start = Timestamp.fromDate(new Date(`${todayStr}T00:00:00+05:30`));
  const end = Timestamp.now();
  return { start, end, label: `Today (${todayStr})` };
}

/**
 * Builds safe, factual snapshot aggregating orders, inventory velocity, and refunds.
 * Strictly guarantees ZERO PII is included in the output.
 */
export async function buildSafeBusinessSnapshot(period: AnalyticsPeriod = 'today'): Promise<BusinessContext> {
  const { start, end, label } = getPeriodTimestamps(period);
  const mumbaiNow = getMumbaiNow();
  const hoursElapsed = Math.max(0.5, (mumbaiNow.getHours() - 7) + (mumbaiNow.getMinutes() / 60));

  // 1. Fetch Orders within target period
  const ordersSnap = await db
    .collection('orders')
    .where('createdAt', '>=', start)
    .where('createdAt', '<=', end)
    .get();

  let totalOrdersCount = 0;
  let paidOrdersCount = 0;
  let cancelledOrdersCount = 0;
  let grossRevenuePaise = 0;
  let cashRevenuePaise = 0;
  let digitalRevenuePaise = 0;
  let refundsPaise = 0;

  const itemSalesAgg: Record<string, { name: string; category: string; unitsSold: number; revenuePaise: number }> = {};
  const hourlyCount: Record<number, { orders: number; revenuePaise: number }> = {};

  // Initialize hourly slots (7 AM - 9 PM)
  for (let h = 7; h <= 21; h++) {
    hourlyCount[h] = { orders: 0, revenuePaise: 0 };
  }

  ordersSnap.forEach((doc) => {
    const data = doc.data();
    totalOrdersCount++;

    const isPaid = data.paymentStatus === 'paid' || data.paymentStatus === 'captured' || data.paymentStatus === 'settled';
    const amount = Number(data.totalAmountPaise || (data.totalAmount ? Math.round(data.totalAmount * 100) : 0));

    if (data.status === 'cancelled') {
      cancelledOrdersCount++;
      if (data.refundedAmountPaise || isPaid) {
        refundsPaise += Number(data.refundedAmountPaise || amount);
      }
    } else if (isPaid) {
      paidOrdersCount++;
      grossRevenuePaise += amount;
      if (data.paymentMethod === 'counter_cash' || data.paymentMethod === 'cash') {
        cashRevenuePaise += amount;
      } else {
        digitalRevenuePaise += amount;
      }

      // Check partial or full refunds on completed orders
      if (data.refundedAmountPaise) {
        refundsPaise += Number(data.refundedAmountPaise);
      }

      // Hourly bucketing (evaluated in Mumbai timezone)
      if (data.createdAt && typeof data.createdAt.toDate === 'function') {
        const orderDate = new Date(data.createdAt.toDate().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const h = orderDate.getHours();
        if (hourlyCount[h]) {
          hourlyCount[h].orders++;
          hourlyCount[h].revenuePaise += amount;
        }
      }

      // Aggregate item sales
      if (Array.isArray(data.items)) {
        data.items.forEach((it: any) => {
          const key = it.id || it.itemId || it.name;
          const name = it.name || 'Unknown Item';
          const qty = Number(it.quantity || 1);
          const pricePaise = Number(it.pricePaise || (it.price ? Math.round(it.price * 100) : 0));
          const lineTotal = pricePaise * qty;

          if (key) {
            if (!itemSalesAgg[key]) {
              itemSalesAgg[key] = {
                name,
                category: it.category || 'General',
                unitsSold: 0,
                revenuePaise: 0,
              };
            }
            itemSalesAgg[key].unitsSold += qty;
            itemSalesAgg[key].revenuePaise += lineTotal;
          }
        });
      }
    }
  });

  const netRevenuePaise = Math.max(0, grossRevenuePaise - refundsPaise);
  const averagePaidOrderPaise = paidOrdersCount > 0 ? Math.round(grossRevenuePaise / paidOrdersCount) : 0;

  // 2. Fetch Catalog Inventory & Calculate Velocities
  const menuSnap = await db.collection('menuItems').get();
  const catalogItems: Array<{ id: string; name: string; category: string; available: number; reserved: number; sold: number; type: string }> = [];
  const inventoryAlerts: InventoryDepletionAlert[] = [];

  menuSnap.forEach((doc) => {
    const item = doc.data();
    const itemId = doc.id;
    const sold = itemSalesAgg[itemId]?.unitsSold || itemSalesAgg[item.name]?.unitsSold || 0;
    const stockOnHand = Number(item.stockOnHand || item.stockCount || 0);
    const reserved = Number(item.reservedStock || 0);
    const available = Math.max(0, stockOnHand - reserved);
    const burnRatePerHour = Number((sold / hoursElapsed).toFixed(2));

    catalogItems.push({
      id: itemId,
      name: item.name || 'Unknown Item',
      category: item.category || 'General',
      available,
      reserved,
      sold,
      type: item.type || 'instant',
    });

    let estimatedHoursRemaining: number | null = null;
    let isStockoutWarning = false;
    let suggestedAction = 'Stock levels nominal.';

    if (burnRatePerHour > 0 && item.type === 'instant') {
      estimatedHoursRemaining = Number((available / burnRatePerHour).toFixed(1));
      if (estimatedHoursRemaining < 1.5 && available > 0) {
        isStockoutWarning = true;
        suggestedAction = `Restock ${item.name} promptly; projected stockout in ~${estimatedHoursRemaining} hrs.`;
      } else if (available === 0) {
        isStockoutWarning = true;
        suggestedAction = `${item.name} is depleted. Prepare fresh batch immediately.`;
      }
    } else if (available <= 5 && item.type === 'instant') {
      isStockoutWarning = true;
      suggestedAction = `Buffer is low (${available} left). Restock before next recess.`;
    }

    if (isStockoutWarning || (burnRatePerHour > 0 && available < 30)) {
      inventoryAlerts.push({
        itemId,
        name: item.name || 'Unknown Item',
        category: item.category || 'General',
        availableStock: available,
        reservedStock: reserved,
        burnRatePerHour,
        estimatedHoursRemaining,
        isStockoutWarning,
        suggestedAction,
      });
    }
  });

  // Sort inventory alerts: stockouts first, then lowest hours remaining
  inventoryAlerts.sort((a, b) => {
    if (a.isStockoutWarning && !b.isStockoutWarning) return -1;
    if (!a.isStockoutWarning && b.isStockoutWarning) return 1;
    return (a.estimatedHoursRemaining || 999) - (b.estimatedHoursRemaining || 999);
  });

  // 3. Compute Top Sellers & Least Ordered Dishes
  const totalUnitsSold = Object.values(itemSalesAgg).reduce((sum, it) => sum + it.unitsSold, 0);

  const topSellers: TopProductMetric[] = Object.values(itemSalesAgg)
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, 5)
    .map((it) => ({
      name: it.name,
      category: it.category,
      unitsSold: it.unitsSold,
      revenuePaise: it.revenuePaise,
      shareOfUnitsPercent: totalUnitsSold > 0 ? Number(((it.unitsSold / totalUnitsSold) * 100).toFixed(1)) : 0,
    }));

  // Least ordered: identify active catalog items with low or zero sales
  const leastOrderedItems: TopProductMetric[] = catalogItems
    .map((catItem) => ({
      name: catItem.name,
      category: catItem.category,
      unitsSold: catItem.sold,
      revenuePaise: itemSalesAgg[catItem.id]?.revenuePaise || itemSalesAgg[catItem.name]?.revenuePaise || 0,
      shareOfUnitsPercent: totalUnitsSold > 0 ? Number(((catItem.sold / totalUnitsSold) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => a.unitsSold - b.unitsSold)
    .slice(0, 5);

  // 4. Format Hourly Demand
  const hourlyDemand: HourlySalesBucket[] = Object.entries(hourlyCount).map(([hourStr, val]) => {
    const h = Number(hourStr);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return {
      hourFormatted: `${displayHour}:00 ${suffix}`,
      orderCount: val.orders,
      revenuePaise: val.revenuePaise,
    };
  });

  return {
    period,
    periodLabel: label,
    startDateIso: start.toDate().toISOString(),
    endDateIso: end.toDate().toISOString(),
    timezone: 'Asia/Kolkata',
    totalOrdersCount,
    paidOrdersCount,
    cancelledOrdersCount,
    grossRevenuePaise,
    netRevenuePaise,
    refundsPaise,
    cashRevenuePaise,
    digitalRevenuePaise,
    averagePaidOrderPaise,
    topSellers,
    leastOrderedItems,
    inventoryAlerts,
    hourlyDemand,
    costsAvailable: false,
    costDataNotice: 'Profit/loss cannot currently be calculated because ingredient, procurement, and packaging costs are not recorded in the database.',
    dataQuality: paidOrdersCount > 0 ? 'ACTUAL' : 'INSUFFICIENT_DATA',
    zeroPiiEnforced: true,
    generatedAtIso: new Date().toISOString(),
  };
}

/**
 * Platform 2.0 — Get AI Safe Business Snapshot (Callable)
 * 
 * Returns canonical, sanitized facts without executing LLM generation.
 */
export const getAiBusinessSnapshot = onCall<{ period?: AnalyticsPeriod }>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'view_ai_business_insights', 'Only authorized managers or administrators can access business analytics.');

  await enforceRateLimit(request.auth.uid, 'ai_business_snapshot');

  const period = request.data?.period || 'today';
  return await buildSafeBusinessSnapshot(period);
});

/**
 * Platform 2.0 — AI Business Chat (Callable)
 * 
 * Accepts a natural language query, compiles authoritative business facts,
 * runs the request through the swappable AIProvider (Gemini/OpenRouter/Fallback),
 * and returns the answer with verified evidence metadata.
 */
export const aiBusinessChat = onCall<{ question: string; period?: AnalyticsPeriod }, Promise<AIAnswer>>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'view_ai_business_insights', 'Only authorized managers or administrators can query the AI Business Copilot.');

  // Honeytoken & injection check on input payload
  await assertNoHoneytokens(request.data, request.auth.uid, 'aiBusinessChat');

  await enforceRateLimit(request.auth.uid, 'ai_business_chat');

  const rawQuestion = (request.data?.question || '').trim();
  if (!rawQuestion) {
    throw new HttpsError('invalid-argument', 'Question cannot be empty.');
  }
  if (rawQuestion.length > 500) {
    throw new HttpsError('invalid-argument', 'Question is too long (maximum 500 characters).');
  }

  const sanitizedQ = sanitizeQuestion(rawQuestion);
  const period = request.data?.period || 'today';

  // 1. Build authoritatively verified, zero-PII facts
  const context = await buildSafeBusinessSnapshot(period);

  // 2. Route query through swappable AI provider
  const router = getAIRouter();
  const answer = await router.generateAnswer(context, sanitizedQ);

  // 3. Audit log security event (Zero PII, records query length & provider used)
  await logSecurityEvent({
    eventType: 'AI_BUSINESS_QUERY_EXECUTED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: {
      period,
      providerUsed: answer.evidence.providerUsed,
      latencyMs: answer.evidence.executionLatencyMs,
      dataQuality: context.dataQuality,
      ordersAnalyzed: context.paidOrdersCount,
      questionLength: sanitizedQ.length,
    },
  });

  return answer;
});
