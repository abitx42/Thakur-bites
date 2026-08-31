import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { enforceAppCheck } from './app_check';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface OwnerFeatureFlags {
  onlineOrderingEnabled: boolean;
  priorityQueueEnabled: boolean;
  rushMultiplier: number;
  cashCounterEnabled: boolean;
  maxActivePriorityOrdersPerFaculty: number;
}

export interface ItemVelocityMetric {
  itemId: string;
  name: string;
  category: string;
  unitsSoldToday: number;
  currentStockOnHand: number;
  currentReserved: number;
  availableStock: number;
  burnRatePerHour: number;
  estimatedHoursRemaining: number | null; // null if no sales or infinite stock
  isStockoutWarning: boolean;
}

export interface OwnerBusinessMetricsResponse {
  summaryDate: string;
  totalOrders: number;
  grossRevenuePaise: number;
  digitalRevenuePaise: number;
  cashRevenuePaise: number;
  refundedPaise: number;
  averageOrderPaise: number;
  stationDistribution: {
    confirmed: number;
    preparing: number;
    ready: number;
    collected: number;
    cancelled: number;
  };
  itemVelocities: ItemVelocityMetric[];
  featureFlags: OwnerFeatureFlags;
}

function getTodayStartTimestamp(): admin.firestore.Timestamp {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return admin.firestore.Timestamp.fromDate(d);
}

/**
 * Platform 2.0 — Get Owner Executive Business Metrics & Predictive Inventory
 * 
 * Restricted to manager, admin, or security_admin.
 * Computes financial ledger totals, active token queue breakdown, and item run-rate forecasts.
 */
export const getOwnerBusinessMetrics = onCall(async (request): Promise<OwnerBusinessMetricsResponse> => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!['manager', 'admin', 'security_admin'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only managers or administrators can access owner analytics.');
  }

  const todayStart = getTodayStartTimestamp();
  const now = new Date();
  const hoursElapsedToday = Math.max(0.5, (now.getHours() - 7) + (now.getMinutes() / 60)); // Operational day starts ~7 AM

  // 1. Fetch Today's Orders
  const ordersSnap = await db
    .collection('orders')
    .where('createdAt', '>=', todayStart)
    .get();

  let totalOrders = 0;
  let grossRevenuePaise = 0;
  let digitalRevenuePaise = 0;
  let cashRevenuePaise = 0;
  let refundedPaise = 0;

  const stationDistribution = {
    confirmed: 0,
    preparing: 0,
    ready: 0,
    collected: 0,
    cancelled: 0,
  };

  const itemSalesCount: Record<string, number> = {};

  ordersSnap.forEach((doc) => {
    const data = doc.data();
    totalOrders++;

    // Station Distribution
    const status = data.status as keyof typeof stationDistribution;
    if (stationDistribution[status] !== undefined) {
      stationDistribution[status]++;
    }

    // Financial Metrics
    const amount = Number(data.totalAmountPaise || (data.totalAmount ? data.totalAmount * 100 : 0));
    if (data.status !== 'cancelled') {
      grossRevenuePaise += amount;
      if (data.paymentMethod === 'cash') {
        cashRevenuePaise += amount;
      } else {
        digitalRevenuePaise += amount;
      }
    } else {
      refundedPaise += amount;
    }

    // Item sales tracking
    if (Array.isArray(data.items)) {
      data.items.forEach((item: any) => {
        const itemId = item.id || item.itemId || item.name;
        if (itemId) {
          itemSalesCount[itemId] = (itemSalesCount[itemId] || 0) + Number(item.quantity || 1);
        }
      });
    }
  });

  const averageOrderPaise = totalOrders > 0 ? Math.round(grossRevenuePaise / totalOrders) : 0;

  // 2. Fetch Catalog Inventory & Compute Predictive Depletion Velocity
  const menuSnap = await db.collection('menuItems').get();
  const itemVelocities: ItemVelocityMetric[] = [];

  menuSnap.forEach((doc) => {
    const item = doc.data();
    const itemId = doc.id;
    const unitsSoldToday = itemSalesCount[itemId] || itemSalesCount[item.name] || 0;
    const stockOnHand = Number(item.stockOnHand || item.stockCount || 0);
    const reserved = Number(item.reservedStock || 0);
    const available = Math.max(0, stockOnHand - reserved);

    const burnRatePerHour = Number((unitsSoldToday / hoursElapsedToday).toFixed(2));
    let estimatedHoursRemaining: number | null = null;
    let isStockoutWarning = false;

    if (burnRatePerHour > 0 && item.type === 'instant') {
      estimatedHoursRemaining = Number((available / burnRatePerHour).toFixed(1));
      if (estimatedHoursRemaining < 1.5 && available > 0) {
        isStockoutWarning = true;
      }
    }

    itemVelocities.push({
      itemId,
      name: item.name || 'Unknown Item',
      category: item.category || 'general',
      unitsSoldToday,
      currentStockOnHand: stockOnHand,
      currentReserved: reserved,
      availableStock: available,
      burnRatePerHour,
      estimatedHoursRemaining,
      isStockoutWarning,
    });
  });

  // Sort: High velocity & stockout warnings first
  itemVelocities.sort((a, b) => {
    if (a.isStockoutWarning && !b.isStockoutWarning) return -1;
    if (!a.isStockoutWarning && b.isStockoutWarning) return 1;
    return b.unitsSoldToday - a.unitsSoldToday;
  });

  // 3. Fetch Feature Flags
  const flagsDoc = await db.collection('featureFlags').doc('global').get();
  const flagsData = flagsDoc.data() || {};
  const featureFlags: OwnerFeatureFlags = {
    onlineOrderingEnabled: flagsData.onlineOrderingEnabled !== false,
    priorityQueueEnabled: flagsData.priorityQueueEnabled !== false,
    rushMultiplier: Number(flagsData.rushMultiplier || 1.0),
    cashCounterEnabled: flagsData.cashCounterEnabled !== false,
    maxActivePriorityOrdersPerFaculty: Number(flagsData.maxActivePriorityOrdersPerFaculty || 1),
  };

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return {
    summaryDate: todayStr,
    totalOrders,
    grossRevenuePaise,
    digitalRevenuePaise,
    cashRevenuePaise,
    refundedPaise,
    averageOrderPaise,
    stationDistribution,
    itemVelocities,
    featureFlags,
  };
});

/**
 * Platform 2.0 — Update Owner Feature Flags & Campus Controls
 */
export const updateOwnerFeatureFlags = onCall<Partial<OwnerFeatureFlags>>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  if (!['manager', 'admin', 'security_admin'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only managers or administrators can modify campus feature flags.');
  }

  const {
    onlineOrderingEnabled,
    priorityQueueEnabled,
    rushMultiplier,
    cashCounterEnabled,
    maxActivePriorityOrdersPerFaculty,
  } = request.data || {};

  const updates: Record<string, any> = {
    updatedAt: admin.firestore.Timestamp.now(),
    updatedBy: request.auth.uid,
  };

  if (onlineOrderingEnabled !== undefined) updates.onlineOrderingEnabled = Boolean(onlineOrderingEnabled);
  if (priorityQueueEnabled !== undefined) updates.priorityQueueEnabled = Boolean(priorityQueueEnabled);
  if (rushMultiplier !== undefined) updates.rushMultiplier = Math.max(1.0, Math.min(2.5, Number(rushMultiplier)));
  if (cashCounterEnabled !== undefined) updates.cashCounterEnabled = Boolean(cashCounterEnabled);
  if (maxActivePriorityOrdersPerFaculty !== undefined) {
    updates.maxActivePriorityOrdersPerFaculty = Math.max(1, Math.min(5, Math.floor(Number(maxActivePriorityOrdersPerFaculty))));
  }

  await db.collection('featureFlags').doc('global').set(updates, { merge: true });

  await logSecurityEvent({
    eventType: 'CAMPUS_FEATURE_FLAGS_UPDATED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: updates,
  });

  return {
    success: true,
    message: 'Campus feature flags updated successfully.',
    updatedFlags: updates,
  };
});
