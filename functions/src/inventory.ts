import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';

const db = admin.firestore();

export type InventoryChangeType = 'RESTOCK' | 'WASTE' | 'MANUAL_CORRECTION' | 'EXPIRY_DISPOSAL';

export interface InventoryAdjustmentRequest {
  itemId: string;
  changeType: InventoryChangeType;
  deltaUnits: number;
  reason: string;
}

export interface InventoryAdjustmentResponse {
  success: boolean;
  itemId: string;
  previousStockOnHand: number;
  newStockOnHand: number;
  reservedStock: number;
  previousAvailable: number;
  newAvailable: number;
  deltaUnits: number;
  changeType: InventoryChangeType;
}

/**
 * Manager/Admin Authoritative Unified Inventory Adjustment (Fail-Closed Hardened).
 * Operates purely on stockOnHand and strictly maintains availableStock = stockOnHand - reservedStock.
 */
export const adjustInventoryStock = onCall<InventoryAdjustmentRequest>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  if (actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_INVENTORY_ADJUSTMENT',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators can perform manual inventory adjustments.');
  }

  await enforceRateLimit(request.auth.uid, 'inventory_adjustment');

  const { itemId, changeType, deltaUnits, reason } = request.data;
  if (!itemId || typeof itemId !== 'string' || itemId.length > 128 || !changeType || !Number.isSafeInteger(deltaUnits) || deltaUnits === 0) {
    throw new HttpsError('invalid-argument', 'Valid itemId (max 128 chars), changeType, and non-zero integer deltaUnits are required.');
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200) {
    throw new HttpsError('invalid-argument', 'Mandatory audit reason (1-200 characters) is required for inventory modifications.');
  }

  const itemRef = db.collection('menuItems').doc(itemId);
  const now = admin.firestore.Timestamp.now();

  return await db.runTransaction(async (transaction) => {
    const itemSnap = await transaction.get(itemRef);
    if (!itemSnap.exists) {
      throw new HttpsError('not-found', `Item ${itemId} not found in menu.`);
    }

    const itemData = itemSnap.data()!;
    const previousStockOnHand = itemData.stockOnHand;
    const reservedStock = itemData.reservedStock !== undefined ? itemData.reservedStock : 0;

    // Fail-closed invariant validation
    if (typeof previousStockOnHand !== 'number' || !Number.isSafeInteger(previousStockOnHand) || previousStockOnHand < 0) {
      throw new HttpsError('internal', `INVENTORY_CORRUPTION: Item ${itemId} has invalid physical stock on hand.`);
    }
    if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < 0 || reservedStock > previousStockOnHand) {
      throw new HttpsError('internal', `INVENTORY_CORRUPTION: Item ${itemId} has invalid reserved stock.`);
    }

    const previousAvailable = previousStockOnHand - reservedStock;
    const newStockOnHand = previousStockOnHand + deltaUnits;

    // Invariant 1: Physical Stock on Hand cannot drop below 0
    if (newStockOnHand < 0) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot reduce stock by ${Math.abs(deltaUnits)}. Current physical stock on hand is only ${previousStockOnHand}.`
      );
    }

    // Invariant 2: Stock on hand cannot drop below actively reserved stock
    if (newStockOnHand < reservedStock) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot reduce stock to ${newStockOnHand} because ${reservedStock} units are currently reserved by active student checkouts.`
      );
    }

    const newAvailable = newStockOnHand - reservedStock;

    // 1. Update MenuItem stock maintaining single source of truth (stockCount purged)
    transaction.update(itemRef, {
      stockOnHand: newStockOnHand,
      reservedStock,
      isOrderable: newAvailable > 0,
      available: newAvailable > 0,
      lastRestockedAt: deltaUnits > 0 ? now : itemData.lastRestockedAt || now,
      updatedAt: now,
    });

    // 2. Append to immutable inventoryLedger
    const ledgerRef = db.collection('inventoryLedger').doc();
    transaction.set(ledgerRef, {
      ledgerId: ledgerRef.id,
      itemId,
      changeType,
      deltaUnits,
      previousStockOnHand,
      newStockOnHand,
      reservedStock,
      previousAvailable,
      newAvailable,
      actorId: request.auth!.uid,
      actorRole,
      reason: String(reason).trim(),
      timestamp: now,
    });

    return {
      success: true,
      itemId,
      previousStockOnHand,
      newStockOnHand,
      reservedStock,
      previousAvailable,
      newAvailable,
      deltaUnits,
      changeType,
    };
  });
});
