import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { CheckoutRequest, OrderDocument, OrderItemSnapshot } from './types';
import { enforceRateLimit } from './rate_limiter';

const db = admin.firestore();

/**
 * Creates an authoritative, idempotent checkout order with atomic inventory reservation.
 */
export const createCheckout = onCall<CheckoutRequest>(async (request) => {
  // 1. Authenticate student
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to checkout.');
  }

  const studentId = request.auth.uid;
  await enforceRateLimit(studentId, 'checkout');
  const { idempotencyKey, items } = request.data;

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid idempotencyKey is required.');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'Cart items cannot be empty.');
  }

  // 1b. Fix 1: Deduplicate & Aggregate item quantities by itemId to prevent transaction overwrite bug
  const aggregatedItemsMap = new Map<string, number>();
  for (const item of items) {
    if (!item.itemId || typeof item.quantity !== 'number' || item.quantity <= 0) {
      throw new HttpsError('invalid-argument', 'Invalid item format or quantity.');
    }
    const current = aggregatedItemsMap.get(item.itemId) || 0;
    aggregatedItemsMap.set(item.itemId, current + Math.min(99, item.quantity));
  }
  const consolidatedItems = Array.from(aggregatedItemsMap.entries()).map(([itemId, quantity]) => ({
    itemId,
    quantity,
  }));

  // 2. Check for existing order with same idempotencyKey (True Idempotency)
  const existingOrders = await db.collection('orders')
    .where('idempotencyKey', '==', idempotencyKey)
    .where('studentId', '==', studentId)
    .limit(1)
    .get();

  if (!existingOrders.empty) {
    const existingDoc = existingOrders.docs[0];
    return {
      orderId: existingDoc.id,
      order: existingDoc.data(),
      isReplay: true,
    };
  }

  // 3. Fetch student profile details
  const studentDoc = await db.collection('students').doc(studentId).get();
  const studentData = studentDoc.data() || {};
  const studentName = studentData.name || 'Student';
  const studentRoll = studentData.rollNo || 'TCET';

  const now = admin.firestore.Timestamp.now();
  const nowDate = new Date();
  const dateStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const counterRef = db.collection('counters').doc(`orders_${dateStr}`);
  const newOrderRef = db.collection('orders').doc();

  // Deduplicated item document references
  const itemRefs = consolidatedItems.map(i => db.collection('menuItems').doc(i.itemId));

  try {
    return await db.runTransaction(async (transaction) => {
      // ═════════════════════════════════════════════════════════════
      // ALL READS FIRST (Strict Transaction Invariant)
      // ═════════════════════════════════════════════════════════════
      const itemSnapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));
      const counterSnap = await transaction.get(counterRef);

      // ═════════════════════════════════════════════════════════════
      // VALIDATE PRICING & INVENTORY LIMITS
      // ═════════════════════════════════════════════════════════════
      let calculatedTotal = 0;
      let maxPrepMinutes = 0;
      const orderItemSnapshots: OrderItemSnapshot[] = [];

      for (let i = 0; i < consolidatedItems.length; i++) {
        const req = consolidatedItems[i];
        const snap = itemSnapshots[i];

        if (!snap.exists) {
          throw new HttpsError('not-found', `Item ${req.itemId} not found in menu.`);
        }

        const menuData = snap.data()!;
        const isAvail = menuData.available !== false;
        const type = menuData.type || 'instant';
        const stockCount = Math.max(0, Number(menuData.stockCount !== undefined ? menuData.stockCount : (isAvail ? 50 : 0)));
        const unitPrice = Number(menuData.price || 0);
        const prepMinutes = Number(menuData.prepMinutes || 0);

        if (!isAvail) {
          throw new HttpsError('failed-precondition', `${menuData.name} is currently out of stock.`);
        }

        if (type === 'instant' && req.quantity > stockCount) {
          throw new HttpsError(
            'resource-exhausted',
            `Insufficient stock for ${menuData.name}. Only ${stockCount} available.`,
            { itemId: req.itemId, availableStock: stockCount }
          );
        }

        const subtotal = unitPrice * req.quantity;
        calculatedTotal += subtotal;
        if (prepMinutes > maxPrepMinutes) {
          maxPrepMinutes = prepMinutes;
        }

        orderItemSnapshots.push({
          itemId: req.itemId,
          name: menuData.name,
          quantity: req.quantity,
          unitPrice,
          subtotal,
          type,
          station: menuData.category || 'general',
        });
      }

      // ═════════════════════════════════════════════════════════════
      // GENERATE DAILY SEQUENTIAL TOKEN (TB-001, TB-002, ...)
      // ═════════════════════════════════════════════════════════════
      let nextSeq = 1;
      if (counterSnap.exists) {
        nextSeq = (counterSnap.data()?.count || 0) + 1;
      }
      const tokenNumber = `TB-${String(nextSeq).padStart(3, '0')}`;

      // Generate secure 4-digit PIN and SHA-256 hash
      const rawPin = String(Math.floor(1000 + Math.random() * 9000));
      const pinHash = crypto.createHash('sha256').update(rawPin).digest('hex');

      const readyAtDate = new Date(nowDate.getTime() + maxPrepMinutes * 60000);

      const orderDoc: OrderDocument = {
        id: newOrderRef.id,
        idempotencyKey,
        tokenNumber,
        pickupPin: rawPin,
        pickupPinHash: pinHash,
        studentId,
        studentName,
        studentRoll,
        status: 'confirmed',
        paymentStatus: 'paid',
        totalAmount: calculatedTotal,
        currency: 'INR',
        items: orderItemSnapshots,
        estimatedMinutes: maxPrepMinutes,
        createdAt: now,
        readyAt: admin.firestore.Timestamp.fromDate(readyAtDate),
      };

      // ═════════════════════════════════════════════════════════════
      // ALL WRITES AFTER READS
      // ═════════════════════════════════════════════════════════════

      // a. Decrement instant store items
      for (let i = 0; i < consolidatedItems.length; i++) {
        const req = consolidatedItems[i];
        const snap = itemSnapshots[i];
        const menuData = snap.data()!;
        if (menuData.type === 'instant') {
          const currentStock = Math.max(0, Number(menuData.stockCount || 0));
          const newStock = Math.max(0, currentStock - req.quantity);
          transaction.update(itemRefs[i], {
            stockCount: newStock,
            available: newStock > 0,
          });

          // Write to append-only inventoryLedger
          const ledgerRef = db.collection('inventoryLedger').doc();
          transaction.set(ledgerRef, {
            itemId: req.itemId,
            orderId: newOrderRef.id,
            changeType: 'CHECKOUT_RESERVE',
            deltaUnits: -req.quantity,
            previousAvailable: currentStock,
            newAvailable: newStock,
            actorId: studentId,
            timestamp: now,
          });
        }
      }

      // b. Update sequence counter
      transaction.set(counterRef, {
        date: dateStr,
        count: nextSeq,
        lastUpdatedAt: now,
      }, { merge: true });

      // c. Create Order Document
      transaction.set(newOrderRef, orderDoc);

      // d. Create immutable Order Event
      const eventRef = db.collection('orderEvents').doc();
      transaction.set(eventRef, {
        orderId: newOrderRef.id,
        fromStatus: 'draft',
        toStatus: 'confirmed',
        actorId: studentId,
        actorRole: 'student',
        timestamp: now,
        reason: 'CHECKOUT_CREATED',
      });

      return {
        orderId: newOrderRef.id,
        order: orderDoc,
        isReplay: false,
      };
    });
  } catch (error: any) {
    // Fix 20: Log inventory contention alerts
    if (error.code === 'resource-exhausted') {
      await db.collection('securityEvents').doc().set({
        eventType: 'INVENTORY_CONTENTION_SPIKE',
        actorUid: studentId,
        severity: 'warn',
        timestamp: now,
        details: { message: error.message },
      }).catch(() => {});
    }
    throw error;
  }
});
