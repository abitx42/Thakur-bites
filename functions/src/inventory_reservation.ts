import * as admin from 'firebase-admin';

export interface ReservationItem {
  itemId: string;
  quantity: number;
}

export interface InventoryReservationDoc {
  reservationId: string;
  orderId: string;
  studentId: string;
  items: ReservationItem[];
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  expiresAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
  committedAt?: admin.firestore.Timestamp;
  releasedAt?: admin.firestore.Timestamp;
  releaseReason?: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * TWO-PHASE INVENTORY RESERVATION ENGINE (Fail-Closed Hardened)
 * ═══════════════════════════════════════════════════════════════════
 * Authoritative Single Source of Truth Invariant Guarantees:
 * 1. Available Stock = stockOnHand - reservedStock. (stockCount purged)
 * 2. Strict non-negative integer bounds; corruption throws immediately without clamping.
 * 3. Two-phase lifecycle: Checkout RESERVES -> Payment COMMITS -> Failure RELEASES.
 */

export async function reserveInventoryInTransaction(
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  orderId: string,
  studentId: string,
  items: ReservationItem[],
  ttlMinutes: number = 15
): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + ttlMinutes * 60000));
  const reservationRef = db.collection('inventoryReservations').doc(orderId);

  // 1. Process each instant item reservation
  for (const item of items) {
    if (!item.itemId || typeof item.itemId !== 'string' || item.itemId.length > 128) {
      throw new Error('INVALID_ARGUMENT: Invalid itemId.');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`INVALID_ARGUMENT: Invalid quantity ${item.quantity}.`);
    }

    const itemRef = db.collection('menuItems').doc(item.itemId);
    const snap = await transaction.get(itemRef);
    if (!snap.exists) {
      throw new Error(`NOT_FOUND: Item ${item.itemId} not found for reservation.`);
    }

    const data = snap.data()!;
    if (data.type === 'instant') {
      const stockOnHand = data.stockOnHand;
      const reservedStock = data.reservedStock !== undefined ? data.reservedStock : 0;

      // Fail-Closed Invariant Check (No Math.max silent clamping)
      if (typeof stockOnHand !== 'number' || !Number.isSafeInteger(stockOnHand) || stockOnHand < 0) {
        throw new Error(`INVENTORY_CORRUPTION: Item "${data.name}" (${item.itemId}) has invalid stockOnHand (${stockOnHand}).`);
      }
      if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < 0 || reservedStock > stockOnHand) {
        throw new Error(`INVENTORY_CORRUPTION: Item "${data.name}" (${item.itemId}) has invalid reservedStock (${reservedStock}) exceeding stockOnHand (${stockOnHand}).`);
      }

      const availableStock = stockOnHand - reservedStock;

      if (item.quantity > availableStock) {
        throw new Error(`INSUFFICIENT_AVAILABLE_STOCK: Insufficient stock for ${data.name}. Available: ${availableStock}, requested: ${item.quantity}.`);
      }

      const newReservedStock = reservedStock + item.quantity;
      const newAvailableStock = stockOnHand - newReservedStock;

      transaction.update(itemRef, {
        stockOnHand,
        reservedStock: newReservedStock,
        isOrderable: newAvailableStock > 0,
        available: newAvailableStock > 0,
        updatedAt: now,
      });

      // Append to immutable inventoryLedger
      const ledgerRef = db.collection('inventoryLedger').doc();
      transaction.set(ledgerRef, {
        itemId: item.itemId,
        orderId,
        changeType: 'STOCK_RESERVED',
        deltaUnits: -item.quantity,
        previousAvailable: availableStock,
        newAvailable: newAvailableStock,
        stockOnHand,
        reservedStock: newReservedStock,
        actorId: studentId,
        timestamp: now,
      });
    }
  }

  // 2. Create reservation document
  const reservationDoc: InventoryReservationDoc = {
    reservationId: orderId,
    orderId,
    studentId,
    items,
    status: 'RESERVED',
    expiresAt,
    createdAt: now,
  };
  transaction.set(reservationRef, reservationDoc);
}

export async function commitInventoryInTransaction(
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  orderId: string,
  actorId: string
): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const reservationRef = db.collection('inventoryReservations').doc(orderId);
  const resSnap = await transaction.get(reservationRef);

  if (!resSnap.exists) {
    return; // Direct counter orders or already finalized
  }

  const resData = resSnap.data() as InventoryReservationDoc;
  if (resData.status !== 'RESERVED') {
    return; // Already committed or released
  }

  for (const item of resData.items) {
    const itemRef = db.collection('menuItems').doc(item.itemId);
    const snap = await transaction.get(itemRef);
    if (snap.exists) {
      const data = snap.data()!;
      if (data.type === 'instant') {
        const stockOnHand = data.stockOnHand;
        const reservedStock = data.reservedStock !== undefined ? data.reservedStock : 0;

        if (typeof stockOnHand !== 'number' || !Number.isSafeInteger(stockOnHand) || stockOnHand < item.quantity) {
          throw new Error(`INVENTORY_CORRUPTION: stockOnHand (${stockOnHand}) insufficient to commit ${item.quantity} units for ${item.itemId}.`);
        }
        if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < item.quantity) {
          throw new Error(`INVENTORY_CORRUPTION: reservedStock (${reservedStock}) insufficient to commit ${item.quantity} units for ${item.itemId}.`);
        }

        const newReservedStock = reservedStock - item.quantity;
        const newStockOnHand = stockOnHand - item.quantity;
        const newAvailableStock = newStockOnHand - newReservedStock;

        transaction.update(itemRef, {
          stockOnHand: newStockOnHand,
          reservedStock: newReservedStock,
          isOrderable: newAvailableStock > 0,
          available: newAvailableStock > 0,
          updatedAt: now,
        });

        // Append to inventoryLedger
        const ledgerRef = db.collection('inventoryLedger').doc();
        transaction.set(ledgerRef, {
          itemId: item.itemId,
          orderId,
          changeType: 'STOCK_COMMITTED',
          deltaUnits: 0, // Decrement was reserved at checkout
          previousAvailable: newAvailableStock,
          newAvailable: newAvailableStock,
          stockOnHand: newStockOnHand,
          reservedStock: newReservedStock,
          actorId,
          timestamp: now,
        });
      }
    }
  }

  transaction.update(reservationRef, {
    status: 'COMMITTED',
    committedAt: now,
  });
}

export async function releaseInventoryInTransaction(
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  orderId: string,
  reason: string,
  actorId: string
): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const reservationRef = db.collection('inventoryReservations').doc(orderId);
  const resSnap = await transaction.get(reservationRef);

  if (!resSnap.exists) {
    return;
  }

  const resData = resSnap.data() as InventoryReservationDoc;
  if (resData.status !== 'RESERVED') {
    return;
  }

  for (const item of resData.items) {
    const itemRef = db.collection('menuItems').doc(item.itemId);
    const snap = await transaction.get(itemRef);
    if (snap.exists) {
      const data = snap.data()!;
      if (data.type === 'instant') {
        const stockOnHand = data.stockOnHand;
        const reservedStock = data.reservedStock !== undefined ? data.reservedStock : 0;

        if (typeof stockOnHand !== 'number' || !Number.isSafeInteger(stockOnHand) || stockOnHand < 0) {
          throw new Error(`INVENTORY_CORRUPTION: Invalid stockOnHand (${stockOnHand}) on item ${item.itemId}.`);
        }
        if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < item.quantity) {
          throw new Error(`INVENTORY_CORRUPTION: reservedStock (${reservedStock}) less than releasing quantity ${item.quantity} for ${item.itemId}.`);
        }

        const newReservedStock = reservedStock - item.quantity;
        const newAvailableStock = stockOnHand - newReservedStock;

        transaction.update(itemRef, {
          stockOnHand,
          reservedStock: newReservedStock,
          isOrderable: newAvailableStock > 0,
          available: newAvailableStock > 0,
          updatedAt: now,
        });

        // Append to inventoryLedger
        const ledgerRef = db.collection('inventoryLedger').doc();
        transaction.set(ledgerRef, {
          itemId: item.itemId,
          orderId,
          changeType: 'STOCK_RELEASED',
          deltaUnits: item.quantity,
          previousAvailable: stockOnHand - reservedStock,
          newAvailable: newAvailableStock,
          stockOnHand,
          reservedStock: newReservedStock,
          actorId,
          reason: String(reason).slice(0, 200),
          timestamp: now,
        });
      }
    }
  }

  transaction.update(reservationRef, {
    status: 'RELEASED',
    releasedAt: now,
    releaseReason: String(reason).slice(0, 200),
  });
}
