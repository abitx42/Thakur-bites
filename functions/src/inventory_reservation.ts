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
 * 4. STRICT READ-BEFORE-WRITE: All transaction.get() calls execute before any transaction.set/update.
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

  // ═════════════════════════════════════════════════════════════
  // PHASE 1: ALL READS FIRST (Strict Firestore Invariant)
  // ═════════════════════════════════════════════════════════════
  const itemRefs = items.map(item => {
    if (!item.itemId || typeof item.itemId !== 'string' || item.itemId.length > 128) {
      throw new Error('INVALID_ARGUMENT: Invalid itemId.');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`INVALID_ARGUMENT: Invalid quantity ${item.quantity}.`);
    }
    return db.collection('menuItems').doc(item.itemId);
  });

  const snapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));

  interface PendingReserveUpdate {
    itemRef: admin.firestore.DocumentReference;
    stockOnHand: number;
    newReservedStock: number;
    newAvailableStock: number;
    ledgerEntry: any;
  }
  const pendingUpdates: PendingReserveUpdate[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const snap = snapshots[i];

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

      pendingUpdates.push({
        itemRef: itemRefs[i],
        stockOnHand,
        newReservedStock,
        newAvailableStock,
        ledgerEntry: {
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
        },
      });
    }
  }

  // ═════════════════════════════════════════════════════════════
  // PHASE 2: ALL WRITES AFTER READS
  // ═════════════════════════════════════════════════════════════
  for (const upd of pendingUpdates) {
    transaction.update(upd.itemRef, {
      stockOnHand: upd.stockOnHand,
      reservedStock: upd.newReservedStock,
      isOrderable: upd.newAvailableStock > 0,
      available: upd.newAvailableStock > 0,
      updatedAt: now,
    });

    const ledgerRef = db.collection('inventoryLedger').doc();
    transaction.set(ledgerRef, upd.ledgerEntry);
  }

  // Create reservation document
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

  // ═════════════════════════════════════════════════════════════
  // PHASE 1: ALL READS FIRST (Strict Firestore Invariant)
  // ═════════════════════════════════════════════════════════════
  const resSnap = await transaction.get(reservationRef);

  if (!resSnap.exists) {
    return; // Direct counter orders or already finalized
  }

  const resData = resSnap.data() as InventoryReservationDoc;
  if (resData.status !== 'RESERVED') {
    return; // Already committed or released
  }

  const itemRefs = resData.items.map(it => db.collection('menuItems').doc(it.itemId));
  const snapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));

  interface PendingCommitUpdate {
    itemRef: admin.firestore.DocumentReference;
    newStockOnHand: number;
    newReservedStock: number;
    newAvailableStock: number;
    ledgerEntry: any;
  }
  const pendingUpdates: PendingCommitUpdate[] = [];

  for (let i = 0; i < resData.items.length; i++) {
    const item = resData.items[i];
    const snap = snapshots[i];

    if (!snap.exists) {
      throw new Error(`INVENTORY_ITEM_NOT_FOUND: Item ${item.itemId} missing from catalog during inventory commit.`);
    }

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

      pendingUpdates.push({
        itemRef: itemRefs[i],
        newStockOnHand,
        newReservedStock,
        newAvailableStock,
        ledgerEntry: {
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
        },
      });
    }
  }

  // ═════════════════════════════════════════════════════════════
  // PHASE 2: ALL WRITES AFTER READS
  // ═════════════════════════════════════════════════════════════
  for (const upd of pendingUpdates) {
    transaction.update(upd.itemRef, {
      stockOnHand: upd.newStockOnHand,
      reservedStock: upd.newReservedStock,
      isOrderable: upd.newAvailableStock > 0,
      available: upd.newAvailableStock > 0,
      updatedAt: now,
    });

    const ledgerRef = db.collection('inventoryLedger').doc();
    transaction.set(ledgerRef, upd.ledgerEntry);
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

  // ═════════════════════════════════════════════════════════════
  // PHASE 1: ALL READS FIRST (Strict Firestore Invariant)
  // ═════════════════════════════════════════════════════════════
  const resSnap = await transaction.get(reservationRef);

  if (!resSnap.exists) {
    return;
  }

  const resData = resSnap.data() as InventoryReservationDoc;
  if (resData.status !== 'RESERVED') {
    return;
  }

  const itemRefs = resData.items.map(it => db.collection('menuItems').doc(it.itemId));
  const snapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));

  interface PendingReleaseUpdate {
    itemRef: admin.firestore.DocumentReference;
    stockOnHand: number;
    newReservedStock: number;
    newAvailableStock: number;
    ledgerEntry: any;
  }
  const pendingUpdates: PendingReleaseUpdate[] = [];

  for (let i = 0; i < resData.items.length; i++) {
    const item = resData.items[i];
    const snap = snapshots[i];

    if (snap && snap.exists) {
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

        pendingUpdates.push({
          itemRef: itemRefs[i],
          stockOnHand,
          newReservedStock,
          newAvailableStock,
          ledgerEntry: {
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
          },
        });
      }
    }
  }

  // ═════════════════════════════════════════════════════════════
  // PHASE 2: ALL WRITES AFTER READS
  // ═════════════════════════════════════════════════════════════
  for (const upd of pendingUpdates) {
    transaction.update(upd.itemRef, {
      stockOnHand: upd.stockOnHand,
      reservedStock: upd.newReservedStock,
      isOrderable: upd.newAvailableStock > 0,
      available: upd.newAvailableStock > 0,
      updatedAt: now,
    });

    const ledgerRef = db.collection('inventoryLedger').doc();
    transaction.set(ledgerRef, upd.ledgerEntry);
  }

  transaction.update(reservationRef, {
    status: 'RELEASED',
    releasedAt: now,
    releaseReason: String(reason).slice(0, 200),
  });
}
