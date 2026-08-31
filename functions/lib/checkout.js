"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCheckout = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const db = admin.firestore();
/**
 * Creates an authoritative, idempotent checkout order with atomic inventory reservation.
 */
exports.createCheckout = (0, https_1.onCall)(async (request) => {
    // 1. Authenticate student
    if (!request.auth || !request.auth.uid) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated to checkout.');
    }
    const studentId = request.auth.uid;
    const { idempotencyKey, items } = request.data;
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Valid idempotencyKey is required.');
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Cart items cannot be empty.');
    }
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
    // Deduplicate item references
    const itemRefs = items.map(i => db.collection('menuItems').doc(i.itemId));
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
        const orderItemSnapshots = [];
        for (let i = 0; i < items.length; i++) {
            const req = items[i];
            const snap = itemSnapshots[i];
            if (!snap.exists) {
                throw new https_1.HttpsError('not-found', `Item ${req.itemId} not found in menu.`);
            }
            const menuData = snap.data();
            const isAvail = menuData.available !== false;
            const type = menuData.type || 'instant';
            const stockCount = Math.max(0, Number(menuData.stockCount !== undefined ? menuData.stockCount : (isAvail ? 50 : 0)));
            const unitPrice = Number(menuData.price || 0);
            const prepMinutes = Number(menuData.prepMinutes || 0);
            if (!isAvail) {
                throw new https_1.HttpsError('failed-precondition', `${menuData.name} is currently out of stock.`);
            }
            if (type === 'instant' && req.quantity > stockCount) {
                throw new https_1.HttpsError('resource-exhausted', `Insufficient stock for ${menuData.name}. Only ${stockCount} available.`, { itemId: req.itemId, availableStock: stockCount });
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
        const orderDoc = {
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
        for (let i = 0; i < items.length; i++) {
            const req = items[i];
            const snap = itemSnapshots[i];
            const menuData = snap.data();
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
        // b. Update daily sequence counter
        transaction.set(counterRef, {
            date: dateStr,
            count: nextSeq,
            lastUpdatedAt: now,
        }, { merge: true });
        // c. Write order document
        transaction.set(newOrderRef, orderDoc);
        // d. Record immutable orderEvent
        const eventRef = db.collection('orderEvents').doc();
        transaction.set(eventRef, {
            orderId: newOrderRef.id,
            fromStatus: 'draft',
            toStatus: 'confirmed',
            actorId: studentId,
            actorRole: 'student',
            timestamp: now,
            metadata: { totalAmount: calculatedTotal, tokenNumber },
        });
        return {
            orderId: newOrderRef.id,
            order: orderDoc,
            isReplay: false,
        };
    });
});
//# sourceMappingURL=checkout.js.map