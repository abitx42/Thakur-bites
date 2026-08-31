import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { logSecurityEvent } from './security_logger';
import { enforceRateLimit } from './rate_limiter';

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
 * Manager/Admin Authoritative Unified Inventory Adjustment (Stage 3 Hardened).
 * Operates purely on stockOnHand and strictly maintains availableStock = stockOnHand - reservedStock.
 */
export const adjustInventoryStock = onCall<InventoryAdjustmentRequest>(async (request) => {
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
  if (!itemId || !changeType || !Number.isSafeInteger(deltaUnits) || deltaUnits === 0) {
    throw new HttpsError('invalid-argument', 'Valid itemId, changeType, and non-zero integer deltaUnits are required.');
  }

  if (!reason || reason.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Mandatory audit reason is required for inventory modifications.');
  }

  const itemRef = db.collection('menuItems').doc(itemId);
  const now = admin.firestore.Timestamp.now();

  return await db.runTransaction(async (transaction) => {
    const itemSnap = await transaction.get(itemRef);
    if (!itemSnap.exists) {
      throw new HttpsError('not-found', `Item ${itemId} not found in menu.`);
    }

    const itemData = itemSnap.data()!;
    const previousStockOnHand = Math.max(
      0,
      Number(itemData.stockOnHand !== undefined ? itemData.stockOnHand : (itemData.stockCount || 0))
    );
    const reservedStock = Math.max(0, Number(itemData.reservedStock || 0));
    const previousAvailable = Math.max(0, previousStockOnHand - reservedStock);

    const newStockOnHand = previousStockOnHand + deltaUnits;

    // Invariant 1: Physical Stock on Hand cannot drop below 0
    if (newStockOnHand < 0) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot reduce stock by ${Math.abs(deltaUnits)}. Current physical stock on hand is only ${previousStockOnHand}.`
      );
    }

    const newAvailable = Math.max(0, newStockOnHand - reservedStock);

    // 1. Update MenuItem stock maintaining single source of truth
    transaction.update(itemRef, {
      stockOnHand: newStockOnHand,
      reservedStock,
      availableStock: newAvailable,
      stockCount: newAvailable, // Derived UI view field strictly synchronized
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
      reason,
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
