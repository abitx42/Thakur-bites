import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface ReorderRequest {
  orderId: string;
}

export interface ReorderItemResult {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitPricePaise: number;
  originalPricePaise: number;
  priceChanged: boolean;
  available: boolean;
  reason?: string;
}

export interface ReorderResponse {
  success: boolean;
  orderId: string;
  items: ReorderItemResult[];
  totalPaise: number;
  totalAmount: number;
  hasUnavailableItems: boolean;
  hasPriceChanges: boolean;
}

/**
 * Authoritative Reorder Engine (Platform 2.0).
 * 
 * Takes an existing order ID and recalculates today's live menu prices,
 * item availability, and current stockOnHand - reservedStock.
 * 
 * NEVER blindly duplicates historical prices or out-of-stock items.
 */
export const reorderPreviousOrder = onCall<ReorderRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to reorder.');
  }

  const userId = request.auth.uid;
  const { orderId } = request.data || {};

  if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0 || orderId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid orderId (max 128 chars) is required.');
  }

  await enforceRateLimit(userId, 'checkout');

  // 1. Fetch historical order document
  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new HttpsError('not-found', `Order ${orderId} does not exist.`);
  }

  const orderData = orderDoc.data()!;

  // 2. IDOR Protection: User must be the owner of the historical order
  if (orderData.studentId !== userId) {
    await logSecurityEvent({
      eventType: 'IDOR_REORDER_ATTEMPT',
      severity: 'HIGH',
      actorUid: userId,
      orderId,
      details: { targetOrderOwner: orderData.studentId },
    });
    throw new HttpsError('permission-denied', 'You are not authorized to reorder this ticket.');
  }

  const historicalItems = orderData.items || [];
  if (!Array.isArray(historicalItems) || historicalItems.length === 0) {
    throw new HttpsError('failed-precondition', 'Historical order contains no items to reorder.');
  }

  // 3. Fetch live menu item documents
  const itemIds = historicalItems.map((i: any) => String(i.itemId));
  const uniqueItemIds = Array.from(new Set(itemIds));
  const itemSnaps = await Promise.all(
    uniqueItemIds.map((id) => db.collection('menuItems').doc(id).get())
  );

  const liveItemMap = new Map<string, admin.firestore.DocumentData>();
  for (const snap of itemSnaps) {
    if (snap.exists && snap.data()) {
      liveItemMap.set(snap.id, snap.data()!);
    }
  }

  // 4. Validate each item against live pricing and inventory
  const resultItems: ReorderItemResult[] = [];
  let calculatedTotalPaise = 0;
  let hasUnavailableItems = false;
  let hasPriceChanges = false;

  for (const histItem of historicalItems) {
    const itemId = String(histItem.itemId);
    const requestedQty = Math.max(1, Math.min(50, Number(histItem.quantity || 1)));
    const originalPricePaise = Number(histItem.unitPricePaise || Math.round(Number(histItem.unitPrice || 0) * 100));

    const liveData = liveItemMap.get(itemId);

    if (!liveData) {
      hasUnavailableItems = true;
      resultItems.push({
        itemId,
        name: histItem.name || 'Discontinued Item',
        quantity: requestedQty,
        unitPrice: 0,
        unitPricePaise: 0,
        originalPricePaise,
        priceChanged: false,
        available: false,
        reason: 'Item no longer exists on today\'s menu.',
      });
      continue;
    }

    const isPublished = liveData.isPublished !== false;
    const isAvailable = liveData.available !== false;
    const livePriceRupees = typeof liveData.price === 'number' ? liveData.price : 0;
    const livePricePaise = Math.round(livePriceRupees * 100);
    const itemType = liveData.type || 'instant';

    if (!isPublished || !isAvailable || livePricePaise <= 0) {
      hasUnavailableItems = true;
      resultItems.push({
        itemId,
        name: liveData.name || histItem.name,
        quantity: requestedQty,
        unitPrice: livePriceRupees,
        unitPricePaise: livePricePaise,
        originalPricePaise,
        priceChanged: livePricePaise !== originalPricePaise,
        available: false,
        reason: 'Item is currently marked out of stock or unpublished.',
      });
      continue;
    }

    // Check instant stock limits
    let finalQty = requestedQty;
    let stockReason: string | undefined;

    if (itemType === 'instant') {
      const stockOnHand = Number(liveData.stockOnHand ?? liveData.stockCount ?? 0);
      const reservedStock = Number(liveData.reservedStock ?? 0);
      const availableStock = Math.max(0, stockOnHand - reservedStock);

      if (availableStock <= 0) {
        hasUnavailableItems = true;
        resultItems.push({
          itemId,
          name: liveData.name,
          quantity: requestedQty,
          unitPrice: livePriceRupees,
          unitPricePaise: livePricePaise,
          originalPricePaise,
          priceChanged: livePricePaise !== originalPricePaise,
          available: false,
          reason: 'Sold out — 0 units available in canteen stock.',
        });
        continue;
      }

      if (availableStock < requestedQty) {
        finalQty = availableStock;
        stockReason = `Quantity adjusted to available stock (${availableStock} remaining).`;
        hasUnavailableItems = true;
      }
    }

    const isPriceDiff = livePricePaise !== originalPricePaise;
    if (isPriceDiff) {
      hasPriceChanges = true;
    }

    const itemSubtotalPaise = livePricePaise * finalQty;
    calculatedTotalPaise += itemSubtotalPaise;

    resultItems.push({
      itemId,
      name: liveData.name,
      quantity: finalQty,
      unitPrice: livePriceRupees,
      unitPricePaise: livePricePaise,
      originalPricePaise,
      priceChanged: isPriceDiff,
      available: true,
      reason: stockReason,
    });
  }

  return {
    success: true,
    orderId,
    items: resultItems,
    totalPaise: calculatedTotalPaise,
    totalAmount: calculatedTotalPaise / 100,
    hasUnavailableItems,
    hasPriceChanges,
  };
});
