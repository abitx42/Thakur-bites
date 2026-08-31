import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { CheckoutRequest, OrderDocument, OrderItemSnapshot, OrderSecretDoc } from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';
import { reserveInventoryInTransaction, commitInventoryInTransaction } from './inventory_reservation';
import { assertOperationalMode } from './kill_switch';

const db = admin.firestore();

/**
 * Creates an authoritative, idempotent checkout order with atomic inventory reservation and integer paise pricing.
 */
export const createCheckout = onCall<CheckoutRequest>(async (request) => {
  await assertOperationalMode('checkout');

  // 1. Authenticate student
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to checkout.');
  }

  const studentId = request.auth.uid;
  const tokenEmail = (request.auth.token.email as string | undefined)?.toLowerCase();
  if (tokenEmail) {
    const isCollegeDomain = tokenEmail.endsWith('@tcetmumbai.in') || tokenEmail.endsWith('@thakureducation.org');
    if (!isCollegeDomain) {
      throw new HttpsError(
        'permission-denied',
        'Checkout is restricted to authorized college domain accounts (@tcetmumbai.in or @thakureducation.org).'
      );
    }
  }

  // Backend Security Invariant: Require verified institutional email
  if (request.auth.token.email_verified !== true && process.env.NODE_ENV !== 'test') {
    throw new HttpsError('permission-denied', 'Institutional email must be verified before placing orders.');
  }

  await enforceRateLimit(studentId, 'checkout');
  const { idempotencyKey, items, paymentMethod = 'online' } = request.data;

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Valid non-empty idempotencyKey is required.');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'Cart items cannot be empty.');
  }

  // 1b. Strict Quantity & Format Validation (P1: Reject invalid input rather than silent clamping)
  const aggregatedItemsMap = new Map<string, number>();
  for (const item of items) {
    if (!item.itemId || typeof item.itemId !== 'string') {
      throw new HttpsError('invalid-argument', 'Item ID must be a non-empty string.');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new HttpsError('invalid-argument', `Invalid quantity for item ${item.itemId}. Must be an integer between 1 and 99.`);
    }
    const current = aggregatedItemsMap.get(item.itemId) || 0;
    const nextTotal = current + item.quantity;
    if (nextTotal > 99) {
      throw new HttpsError('invalid-argument', `Total quantity for ${item.itemId} exceeds maximum 99 items.`);
    }
    aggregatedItemsMap.set(item.itemId, nextTotal);
  }

  const consolidatedItems = Array.from(aggregatedItemsMap.entries()).map(([itemId, quantity]) => ({
    itemId,
    quantity,
  }));

  // Deterministic Idempotency Key Lock Document
  const idempotencyHash = crypto.createHash('sha256').update(`${studentId}_${idempotencyKey.trim()}`).digest('hex');
  const idempotencyLockRef = db.collection('checkoutRequests').doc(idempotencyHash);

  // 2. Fetch student profile details
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
      // 1. ALL READS FIRST (Strict Transaction Invariant)
      // ═════════════════════════════════════════════════════════════
      const idempotencySnap = await transaction.get(idempotencyLockRef);
      if (idempotencySnap.exists) {
        const existingOrderId = idempotencySnap.data()?.orderId;
        if (existingOrderId) {
          const existingOrderDoc = await transaction.get(db.collection('orders').doc(existingOrderId));
          if (existingOrderDoc.exists) {
            return {
              orderId: existingOrderId,
              order: existingOrderDoc.data(),
              isReplay: true,
            };
          }
        }
      }

      const itemSnapshots = await Promise.all(itemRefs.map(ref => transaction.get(ref)));
      const counterSnap = await transaction.get(counterRef);

      // ═════════════════════════════════════════════════════════════
      // 2. VALIDATE PRICING & INVENTORY LIMITS (IN INTEGER PAISE)
      // ═════════════════════════════════════════════════════════════
      let calculatedTotalPaise = 0;
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
        
        // Strict Integer Paise Calculation (P0: 4)
        const unitPricePaise = Math.round(Number(menuData.price || 0) * 100);
        if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise < 0 || unitPricePaise > 1000000) {
          throw new HttpsError('internal', `Corrupt price definition for item ${menuData.name}.`);
        }

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

        const subtotalPaise = unitPricePaise * req.quantity;
        calculatedTotalPaise += subtotalPaise;
        if (prepMinutes > maxPrepMinutes) {
          maxPrepMinutes = prepMinutes;
        }

        orderItemSnapshots.push({
          itemId: req.itemId,
          name: menuData.name,
          quantity: req.quantity,
          unitPrice: unitPricePaise / 100,
          unitPricePaise,
          subtotal: subtotalPaise / 100,
          subtotalPaise,
          type,
          station: menuData.category || 'general',
        });
      }

      // ═════════════════════════════════════════════════════════════
      // 3. GENERATE DAILY SEQUENTIAL TOKEN (TB-001, TB-002, ...)
      // ═════════════════════════════════════════════════════════════
      let nextSeq = 1;
      if (counterSnap.exists) {
        nextSeq = (counterSnap.data()?.count || 0) + 1;
      }
      const tokenNumber = `TB-${String(nextSeq).padStart(3, '0')}`;

      // Cryptographically secure CSPRNG 6-digit PIN (P0: 14)
      const rawPin = String(crypto.randomInt(100000, 1000000));
      const pinHash = crypto.createHash('sha256').update(rawPin).digest('hex');

      // Signed QR Token (valid for 2 hours)
      const qrNonce = crypto.randomBytes(8).toString('hex');
      const qrExpiresAt = Math.floor(Date.now() / 1000) + 7200;
      const qrSigningSecret = getRequiredSecret('QR_SIGNING_SECRET');
      const qrSignature = crypto.createHmac('sha256', qrSigningSecret)
        .update(`${newOrderRef.id}:${studentId}:${qrNonce}:${qrExpiresAt}`)
        .digest('hex');
      const signedQrPayload = `${newOrderRef.id}.${studentId}.${qrNonce}.${qrExpiresAt}.${qrSignature}`;

      const readyAtDate = new Date(nowDate.getTime() + maxPrepMinutes * 60000);
      const isCounterCash = paymentMethod === 'counter_cash';

      // Zero-Knowledge Clean Order Document: Zero secrets in readable orders document
      const orderDoc: OrderDocument = {
        id: newOrderRef.id,
        idempotencyKey,
        tokenNumber,
        studentId,
        studentName,
        studentRoll,
        status: isCounterCash ? 'confirmed' : 'payment_pending',
        paymentStatus: isCounterCash ? 'unpaid' : 'pending',
        paymentMethod: isCounterCash ? 'counter_cash' : 'online',
        totalAmount: calculatedTotalPaise / 100,
        totalAmountPaise: calculatedTotalPaise,
        currency: 'INR',
        items: orderItemSnapshots,
        estimatedMinutes: maxPrepMinutes,
        createdAt: now,
        readyAt: admin.firestore.Timestamp.fromDate(readyAtDate),
      };

      // ═════════════════════════════════════════════════════════════
      // 4. ALL WRITES AFTER READS
      // ═════════════════════════════════════════════════════════════

      // a. Reserve instant store items (Phase 2 Two-Phase Inventory Lifecycle)
      await reserveInventoryInTransaction(
        transaction,
        db,
        newOrderRef.id,
        studentId,
        consolidatedItems,
        15 // 15-minute reservation TTL
      );

      if (isCounterCash) {
        await commitInventoryInTransaction(transaction, db, newOrderRef.id, studentId);
      }

      // b. Update sequence counter
      transaction.set(counterRef, {
        date: dateStr,
        count: nextSeq,
        lastUpdatedAt: now,
      }, { merge: true });

      // c. Reserve Idempotency Lock
      transaction.set(idempotencyLockRef, {
        orderId: newOrderRef.id,
        studentId,
        idempotencyKey,
        createdAt: now,
      });

      // d. Create Order Document
      transaction.set(newOrderRef, orderDoc);

      // d2. Create Isolated Order Secret Document (Stage 4 Hardened)
      const secretRef = db.collection('orderSecrets').doc(newOrderRef.id);
      const secretDoc: OrderSecretDoc = {
        orderId: newOrderRef.id,
        studentId,
        pickupPinHash: pinHash,
        qrNonce,
        qrExpiresAt,
        failedPinAttempts: 0,
        isLockedForInvestigation: false,
        createdAt: now,
        updatedAt: now,
      };
      transaction.set(secretRef, secretDoc);

      // e. Create immutable Order Event
      const eventRef = db.collection('orderEvents').doc();
      transaction.set(eventRef, {
        orderId: newOrderRef.id,
        fromStatus: 'draft',
        toStatus: orderDoc.status,
        actorId: studentId,
        actorRole: 'student',
        timestamp: now,
        reason: isCounterCash ? 'CHECKOUT_COUNTER_CASH' : 'CHECKOUT_PAYMENT_PENDING',
      });

      return {
        orderId: newOrderRef.id,
        order: {
          ...orderDoc,
          pickupPin: rawPin, // Delivered transiently in memory to student only
          signedQrPayload,
        },
        rawPin,
        signedQrPayload,
        isReplay: false,
      };
    });
  } catch (error: any) {
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
