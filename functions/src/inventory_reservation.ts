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
 * TWO-PHASE INVENTORY RESERVATION ENGINE (Phase 2 Hardened)
 * ═══════════════════════════════════════════════════════════════════
 * Invariant Guarantees:
 * 1. Available Stock = stockOnHand - reservedStock.
 * 2. Checkout reserves stock without permanently consuming it.
 * 3. Payment confirmation COMMITS stock (stockOnHand decreases).
 * 4. Payment failure/expiry RELEASES stock (reservedStock decreases).
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
    const itemRef = db.collection('menuItems').doc(item.itemId);
    const snap = await transaction.get(itemRef);
    if (!snap.exists) {
      throw new Error(`Item ${item.itemId} not found for reservation.`);
    }

    const data = snap.data()!;
    if (data.type === 'instant') {
      const stockOnHand = Math.max(0, Number(data.stockOnHand !== undefined ? data.stockOnHand : (data.stockCount || 0)));
      const reservedStock = Math.max(0, Number(data.reservedStock || 0));
      const availableStock = Math.max(0, stockOnHand - reservedStock);

      if (item.quantity > availableStock) {
        throw new Error(`Insufficient available stock for ${data.name}. Available: ${availableStock}, requested: ${item.quantity}.`);
      }

      const newReservedStock = reservedStock + item.quantity;
      const newAvailableStock = stockOnHand - newReservedStock;

      transaction.update(itemRef, {
        stockOnHand,
        reservedStock: newReservedStock,
        stockCount: newAvailableStock, // Maintain compatibility
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
    // If no reservation exists (e.g. legacy/counter cash direct), return safely
    return;
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
        const stockOnHand = Math.max(0, Number(data.stockOnHand !== undefined ? data.stockOnHand : (data.stockCount || 0)));
        const reservedStock = Math.max(0, Number(data.reservedStock || 0));

        const newReservedStock = Math.max(0, reservedStock - item.quantity);
        const newStockOnHand = Math.max(0, stockOnHand - item.quantity);
        const newAvailableStock = Math.max(0, newStockOnHand - newReservedStock);

        transaction.update(itemRef, {
          stockOnHand: newStockOnHand,
          reservedStock: newReservedStock,
          stockCount: newAvailableStock,
          available: newAvailableStock > 0,
          updatedAt: now,
        });

        // Append to inventoryLedger
        const ledgerRef = db.collection('inventoryLedger').doc();
        transaction.set(ledgerRef, {
          itemId: item.itemId,
          orderId,
          changeType: 'STOCK_COMMITTED',
          deltaUnits: 0, // Already reserved
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
        const stockOnHand = Math.max(0, Number(data.stockOnHand !== undefined ? data.stockOnHand : (data.stockCount || 0)));
        const reservedStock = Math.max(0, Number(data.reservedStock || 0));

        const newReservedStock = Math.max(0, reservedStock - item.quantity);
        const newAvailableStock = Math.max(0, stockOnHand - newReservedStock);

        transaction.update(itemRef, {
          stockOnHand,
          reservedStock: newReservedStock,
          stockCount: newAvailableStock,
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
          reason,
          timestamp: now,
        });
      }
    }
  }

  transaction.update(reservationRef, {
    status: 'RELEASED',
    releasedAt: now,
    releaseReason: reason,
  });
}
