import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { CheckoutRequest, OrderDocument, OrderItemSnapshot, OrderSecretDoc } from './types';
import { enforceRateLimit } from './rate_limiter';
import { getRequiredSecret } from './secrets';
import { reserveInventoryInTransaction, commitInventoryInTransaction } from './inventory_reservation';
import { assertOperationalMode } from './kill_switch';
import { logSecurityEvent } from './security_logger';
import { enforceAppCheck } from './app_check';
import { evaluateOrderPriorityLevel } from './priority_queue';
import { updatePublicLiveQueueProjection } from './tv_projection';

const db = admin.firestore();

/**
 * Creates an authoritative, idempotent checkout order with atomic inventory reservation and integer paise pricing.
 */
export const createCheckout = onCall<CheckoutRequest>(async (request) => {
  enforceAppCheck(request);
  await assertOperationalMode('checkout');

  // 1. Authenticate user with fail-closed identity verification
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to checkout.');
  }

  const studentId = request.auth.uid;
  const tokenEmail = (request.auth.token.email as string | undefined)?.trim().toLowerCase();
  
  if (!tokenEmail || typeof tokenEmail !== 'string') {
    throw new HttpsError('permission-denied', 'Checkout requires an authenticated email account.');
  }

  const isInstitutional = tokenEmail.endsWith('@tcetmumbai.in') || tokenEmail.endsWith('@thakureducation.org');

  // Institutional email verification invariant: If claiming college identity, email must be verified
  if (isInstitutional && request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Institutional email must be verified before placing orders.');
  }

  await enforceRateLimit(studentId, 'checkout');
  const { idempotencyKey, items, paymentMethod = 'online' } = request.data;

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0 || idempotencyKey.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid non-empty idempotencyKey (max 128 characters) is required.');
  }

  if (!items || !Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new HttpsError('invalid-argument', 'Cart items cannot be empty and must not exceed 50 distinct items.');
  }

  // 1b. Strict Quantity & Format Validation (P1: Reject invalid input rather than silent clamping)
  const aggregatedItemsMap = new Map<string, number>();
  for (const item of items) {
    if (!item.itemId || typeof item.itemId !== 'string' || item.itemId.length > 128) {
      throw new HttpsError('invalid-argument', 'Item ID must be a non-empty string <= 128 characters.');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      throw new HttpsError('invalid-argument', `Invalid quantity for item ${item.itemId}. Must be an integer between 1 and 50.`);
    }
    const current = aggregatedItemsMap.get(item.itemId) || 0;
    const nextTotal = current + item.quantity;
    if (nextTotal > 50) {
      throw new HttpsError('invalid-argument', `Total quantity for ${item.itemId} exceeds maximum 50 items.`);
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

  // 2. Fetch user profile details (checks users collection first, fallback to students)
  let studentName = 'Student';
  let studentRoll = 'TCET';
  let userAccountType: any = 'STUDENT';
  let userPriorityLevel: any = 1;

  const userDoc = await db.collection('users').doc(studentId).get();
  if (userDoc.exists) {
    const userData = userDoc.data() || {};
    if (userData.accountDisabled === true) {
      throw new HttpsError('permission-denied', 'Account has been deactivated.');
    }
    studentName = userData.displayName || 'Customer';
    studentRoll = userData.rollNo || (userData.accountType === 'TEACHER' ? 'FACULTY' : 'TCET');
    userAccountType = userData.accountType || 'STUDENT';
    userPriorityLevel = typeof userData.priorityLevel === 'number' ? userData.priorityLevel : 1;
  } else {
    const studentDoc = await db.collection('students').doc(studentId).get();
    const studentData = studentDoc.data() || {};
    if (studentData.accountDisabled === true) {
      throw new HttpsError('permission-denied', 'Account has been deactivated.');
    }
    studentName = studentData.name || 'Student';
    studentRoll = studentData.rollNo || 'TCET';
  }

  // Authoritative Priority Assessment & Fairness Throttling
  const { assignedPriority, priorityReason } = await evaluateOrderPriorityLevel(
    studentId,
    userAccountType,
    userPriorityLevel
  );

  const now = admin.firestore.Timestamp.now();
  const nowDate = new Date();
  const dateStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const counterRef = db.collection('counters').doc(`orders_${dateStr}`);
  const newOrderRef = db.collection('orders').doc();

  // Deduplicated item document references
  const itemRefs = consolidatedItems.map(i => db.collection('menuItems').doc(i.itemId));

  try {
    const checkoutResult = await db.runTransaction(async (transaction) => {
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
      // 2. VALIDATE PRICING & INVENTORY LIMITS (FAIL-CLOSED INVARIANTS)
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
        
        // Strict Fail-Closed Price Calculation (No ₹0 fallback)
        if (typeof menuData.price !== 'number' || !Number.isFinite(menuData.price) || menuData.price <= 0) {
          throw new HttpsError('internal', `MENU_CONFIGURATION_ERROR: Item "${menuData.name}" has an invalid or missing price.`);
        }
        const unitPricePaise = Math.round(menuData.price * 100);
        if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise <= 0 || unitPricePaise > 1000000) {
          throw new HttpsError('internal', `Corrupt price definition for item ${menuData.name}.`);
        }

        const prepMinutes = Number(menuData.prepMinutes || 0);

        if (!isAvail) {
          throw new HttpsError('failed-precondition', `${menuData.name} is currently out of stock.`);
        }

        // Strict Fail-Closed Inventory Calculation (No 50-stock fallback)
        if (type === 'instant') {
          const stockOnHand = menuData.stockOnHand;
          const reservedStock = menuData.reservedStock !== undefined ? menuData.reservedStock : 0;

          if (typeof stockOnHand !== 'number' || !Number.isSafeInteger(stockOnHand) || stockOnHand < 0) {
            throw new HttpsError('internal', `INVENTORY_CONFIGURATION_ERROR: Item "${menuData.name}" is missing valid stockOnHand.`);
          }
          if (typeof reservedStock !== 'number' || !Number.isSafeInteger(reservedStock) || reservedStock < 0 || reservedStock > stockOnHand) {
            throw new HttpsError('internal', `INVENTORY_CORRUPTION: Item "${menuData.name}" has corrupt reservedStock.`);
          }

          const availableStock = stockOnHand - reservedStock;

          if (req.quantity > availableStock) {
            throw new HttpsError(
              'resource-exhausted',
              `Insufficient stock for ${menuData.name}. Only ${availableStock} available.`,
              { itemId: req.itemId, availableStock }
            );
          }
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
        priorityLevel: assignedPriority,
        priorityReason: priorityReason,
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
      };
    });

    // Asynchronously synchronize the single ephemeral publicLiveQueue/current document
    await updatePublicLiveQueueProjection(db);

    return checkoutResult;
  } catch (error: any) {
    if (error.code === 'resource-exhausted') {
      await logSecurityEvent({
        eventType: 'INVENTORY_CONTENTION_SPIKE',
        actorUid: studentId,
        severity: 'LOW',
        details: { message: error.message },
      }).catch(() => {});
    }
    throw error;
  }
});
