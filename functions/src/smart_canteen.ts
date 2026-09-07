import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { enforceAppCheck } from './app_check';
import { assertCapability } from './authorization_policy';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface SmartCanteenForecast {
  generatedAt: string;
  currentCampusPeriod: 'MORNING_PREP' | 'TEA_BREAK' | 'MID_DAY_LECTURES' | 'PEAK_LUNCH_RUSH' | 'AFTERNOON_SESSION' | 'EVENING_SNACKS' | 'CLOSING';
  nextMajorRecess: {
    name: string;
    startTime: string;
    minutesUntilRecess: number;
    historicalDemandMultiplier: number;
  };
  predictedKitchenLoad: {
    activeQueueOrders: number;
    projectedOrdersNextHour: number;
    projectedRushVolume: number;
    kitchenStressLevel: 'OPTIMAL' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  };
  stockoutRiskPredictions: Array<{
    itemId: string;
    name: string;
    category: string;
    currentAvailable: number;
    projectedDemandNextHour: number;
    projectedDeficit: number;
    predictedStockoutTime: string | null;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMINENT_DEPLETION';
    recommendation: string;
  }>;
  proactivePrepRecommendations: Array<{
    category: string;
    title: string;
    action: string;
    deadline: string;
    priority: 'HIGH' | 'MEDIUM';
  }>;
}

/**
 * Evaluates current campus schedule period and returns the next peak lunch or tea recess.
 */
export function evaluateCampusSchedule(nowDate: Date = new Date()): {
  period: SmartCanteenForecast['currentCampusPeriod'];
  nextRecess: SmartCanteenForecast['nextMajorRecess'];
} {
  const hours = nowDate.getHours();
  const minutes = nowDate.getMinutes();
  const currentTimeMinutes = hours * 60 + minutes;

  // TCET Bell Schedule in Minutes from midnight:
  // 10:15 = 615 min (Morning Tea Break)
  // 12:30 = 750 min (Primary Lunch Rush)
  // 15:30 = 930 min (Evening Break)
  // 18:00 = 1080 min (Closing)

  if (currentTimeMinutes < 615) {
    return {
      period: 'MORNING_PREP',
      nextRecess: {
        name: 'Morning Tea Break (10:15 AM)',
        startTime: '10:15 AM',
        minutesUntilRecess: Math.max(0, 615 - currentTimeMinutes),
        historicalDemandMultiplier: 1.8,
      },
    };
  } else if (currentTimeMinutes >= 615 && currentTimeMinutes < 645) {
    return {
      period: 'TEA_BREAK',
      nextRecess: {
        name: 'Primary Lunch Rush (12:30 PM)',
        startTime: '12:30 PM',
        minutesUntilRecess: Math.max(0, 750 - currentTimeMinutes),
        historicalDemandMultiplier: 3.5,
      },
    };
  } else if (currentTimeMinutes >= 645 && currentTimeMinutes < 750) {
    return {
      period: 'MID_DAY_LECTURES',
      nextRecess: {
        name: 'Primary Lunch Rush (12:30 PM)',
        startTime: '12:30 PM',
        minutesUntilRecess: Math.max(0, 750 - currentTimeMinutes),
        historicalDemandMultiplier: 3.5,
      },
    };
  } else if (currentTimeMinutes >= 750 && currentTimeMinutes < 810) {
    return {
      period: 'PEAK_LUNCH_RUSH',
      nextRecess: {
        name: 'Evening Snacks (03:30 PM)',
        startTime: '03:30 PM',
        minutesUntilRecess: Math.max(0, 930 - currentTimeMinutes),
        historicalDemandMultiplier: 1.5,
      },
    };
  } else if (currentTimeMinutes >= 810 && currentTimeMinutes < 930) {
    return {
      period: 'AFTERNOON_SESSION',
      nextRecess: {
        name: 'Evening Snacks (03:30 PM)',
        startTime: '03:30 PM',
        minutesUntilRecess: Math.max(0, 930 - currentTimeMinutes),
        historicalDemandMultiplier: 1.5,
      },
    };
  } else if (currentTimeMinutes >= 930 && currentTimeMinutes < 960) {
    return {
      period: 'EVENING_SNACKS',
      nextRecess: {
        name: 'Canteen Close (06:00 PM)',
        startTime: '06:00 PM',
        minutesUntilRecess: Math.max(0, 1080 - currentTimeMinutes),
        historicalDemandMultiplier: 1.0,
      },
    };
  } else {
    return {
      period: 'CLOSING',
      nextRecess: {
        name: 'Next Day Morning Prep (07:30 AM)',
        startTime: '07:30 AM',
        minutesUntilRecess: 720,
        historicalDemandMultiplier: 1.0,
      },
    };
  }
}

/**
 * Computes Smart Canteen Predictive Intelligence based on live catalog, orders, and historical recess weights.
 */
export function calculateSmartCanteenForecast(
  menuItems: Array<{
    id: string;
    name: string;
    category?: string;
    stockOnHand?: number;
    reservedStock?: number;
    type?: string;
  }>,
  ordersToday: Array<{
    status: string;
    items?: Array<{ id?: string; itemId?: string; name?: string; quantity?: number }>;
    createdAt?: any;
  }>,
  nowDate: Date = new Date()
): SmartCanteenForecast {
  const { period, nextRecess } = evaluateCampusSchedule(nowDate);

  // 1. Calculate active kitchen backlog
  const activeQueueOrders = ordersToday.filter(
    (o) => o.status === 'confirmed' || o.status === 'preparing'
  ).length;

  // 2. Compute item sales velocity today
  const hoursElapsed = Math.max(0.5, (nowDate.getHours() - 7) + nowDate.getMinutes() / 60);
  const itemSales: Record<string, number> = {};

  ordersToday.forEach((order) => {
    if (order.status !== 'cancelled' && Array.isArray(order.items)) {
      order.items.forEach((it) => {
        const key = it.id || it.itemId || it.name || 'unknown';
        itemSales[key] = (itemSales[key] || 0) + Number(it.quantity || 1);
      });
    }
  });

  // 3. Project orders for next hour based on schedule multiplier
  const baseOrderVelocity = ordersToday.length / hoursElapsed;
  const projectedOrdersNextHour = Math.round(baseOrderVelocity * nextRecess.historicalDemandMultiplier);
  const projectedRushVolume = Math.round(projectedOrdersNextHour * 2.2); // ~2.2 items per order

  let kitchenStressLevel: SmartCanteenForecast['predictedKitchenLoad']['kitchenStressLevel'] = 'OPTIMAL';
  if (activeQueueOrders > 35 || projectedOrdersNextHour > 120) {
    kitchenStressLevel = 'CRITICAL';
  } else if (activeQueueOrders > 20 || projectedOrdersNextHour > 70) {
    kitchenStressLevel = 'HIGH';
  } else if (activeQueueOrders > 10 || projectedOrdersNextHour > 35) {
    kitchenStressLevel = 'MODERATE';
  }

  // 4. Compute stockout risk per item
  const stockoutRiskPredictions: SmartCanteenForecast['stockoutRiskPredictions'] = [];
  const proactivePrepRecommendations: SmartCanteenForecast['proactivePrepRecommendations'] = [];

  menuItems.forEach((item) => {
    const soldCount = itemSales[item.id] || itemSales[item.name] || 0;
    const stockOnHand = Number(item.stockOnHand || 0);
    const reserved = Number(item.reservedStock || 0);
    const available = Math.max(0, stockOnHand - reserved);

    const baseBurnPerHour = soldCount / hoursElapsed;
    const projectedDemandNextHour = Math.round(baseBurnPerHour * nextRecess.historicalDemandMultiplier);

    if (item.type === 'instant' || stockOnHand > 0) {
      const projectedDeficit = Math.max(0, projectedDemandNextHour - available);
      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMINENT_DEPLETION' = 'LOW';
      let predictedStockoutTime: string | null = null;
      let recommendation = 'Stock levels adequate for upcoming flow.';

      if (available <= 0 && projectedDemandNextHour > 0) {
        riskLevel = 'IMMINENT_DEPLETION';
        predictedStockoutTime = 'Now';
        recommendation = `Restock immediately. Expected ${projectedDemandNextHour} orders during ${nextRecess.name}.`;
      } else if (projectedDeficit > 0) {
        riskLevel = 'HIGH';
        const minutesLeft = Math.round((available / (projectedDemandNextHour / 60)));
        const stockoutDate = new Date(nowDate.getTime() + minutesLeft * 60000);
        predictedStockoutTime = `${stockoutDate.getHours().toString().padStart(2, '0')}:${stockoutDate.getMinutes().toString().padStart(2, '0')}`;
        recommendation = `Prepare/restock ${projectedDeficit} additional units before ${nextRecess.startTime}.`;

        if (proactivePrepRecommendations.length < 5) {
          proactivePrepRecommendations.push({
            category: item.category || 'General',
            title: `Restock / Prep Alert: ${item.name}`,
            action: `Prepare ${projectedDeficit + 10} units. Expected deficit of ${projectedDeficit} during ${nextRecess.name}.`,
            deadline: nextRecess.startTime,
            priority: 'HIGH',
          });
        }
      } else if (available <= projectedDemandNextHour * 1.3 && available > 0) {
        riskLevel = 'MEDIUM';
        recommendation = `Approaching safe threshold. Monitor stock before ${nextRecess.name}.`;
      }

      stockoutRiskPredictions.push({
        itemId: item.id,
        name: item.name,
        category: item.category || 'General',
        currentAvailable: available,
        projectedDemandNextHour,
        projectedDeficit,
        predictedStockoutTime,
        riskLevel,
        recommendation,
      });
    }
  });

  // Sort stockout risks: IMMINENT_DEPLETION > HIGH > MEDIUM > LOW
  const riskRank = { IMMINENT_DEPLETION: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  stockoutRiskPredictions.sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel]);

  // Fallback recommendation if kitchen is running smooth
  if (proactivePrepRecommendations.length === 0) {
    proactivePrepRecommendations.push({
      category: 'Hot Snacks & Grills',
      title: 'Routine Prep: Lunch Buffer Stocks',
      action: `Maintain 30-portion prep buffer across Samosas, Vada Pav, and Dosas ahead of ${nextRecess.name}.`,
      deadline: nextRecess.startTime,
      priority: 'MEDIUM',
    });
  }

  return {
    generatedAt: nowDate.toISOString(),
    currentCampusPeriod: period,
    nextMajorRecess: nextRecess,
    predictedKitchenLoad: {
      activeQueueOrders,
      projectedOrdersNextHour,
      projectedRushVolume,
      kitchenStressLevel,
    },
    stockoutRiskPredictions: stockoutRiskPredictions.slice(0, 15),
    proactivePrepRecommendations,
  };
}

/**
 * Cloud Function: getSmartCanteenIntelligence
 * Restricted to staff, managers, and admins.
 */
export const getSmartCanteenIntelligence = onCall(async (request): Promise<SmartCanteenForecast> => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication required.');
  }

  const callerRole = (request.auth.token.role as string | undefined) || '';
  assertCapability(callerRole, 'view_business_analytics', 'Insufficient permissions for smart canteen intelligence.');

  // Fetch today's orders and active menu
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [menuSnap, ordersSnap] = await Promise.all([
    db.collection('menuItems').get(),
    db.collection('orders').where('createdAt', '>=', Timestamp.fromDate(todayStart)).get(),
  ]);

  const menuItems = menuSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];
  const ordersToday = ordersSnap.docs.map((doc) => doc.data()) as any[];

  return calculateSmartCanteenForecast(menuItems, ordersToday, new Date());
});
