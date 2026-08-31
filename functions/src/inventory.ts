import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';
import { logSecurityEvent } from './security_logger';

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
  previousStock: number;
  newStock: number;
  deltaUnits: number;
  changeType: InventoryChangeType;
}

/**
 * Manager/Admin Authoritative Inventory Adjustment (Phase 3 & P2: 27).
 * Strictly maintains inventory ledger accounting invariants.
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
    const previousStock = Math.max(0, Number(itemData.stockCount || 0));
    const newStock = previousStock + deltaUnits;

    // Invariant 1: Stock cannot drop below 0
    if (newStock < 0) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot reduce stock by ${Math.abs(deltaUnits)}. Current stock is only ${previousStock}.`
      );
    }

    // Invariant 2: newStock === previousStock + deltaUnits
    if (newStock !== previousStock + deltaUnits) {
      throw new HttpsError('internal', 'Inventory calculation integrity violation.');
    }

    // 1. Update MenuItem stock
    transaction.update(itemRef, {
      stockCount: newStock,
      available: newStock > 0,
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
      previousAvailable: previousStock,
      newAvailable: newStock,
      actorId: request.auth!.uid,
      actorRole,
      reason,
      timestamp: now,
    });

    // 3. Log security event for auditability
    const secRef = db.collection('securityEvents').doc();
    transaction.set(secRef, {
      eventType: 'INVENTORY_MANUALLY_ADJUSTED',
      itemId,
      changeType,
      deltaUnits,
      previousStock,
      newStock,
      reason,
      actorUid: request.auth!.uid,
      severity: 'INFO',
      timestamp: now,
    });

    return {
      success: true,
      itemId,
      previousStock,
      newStock,
      deltaUnits,
      changeType,
    };
  });
});
