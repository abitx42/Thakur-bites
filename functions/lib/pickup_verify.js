"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPickup = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const db = admin.firestore();
/**
 * Validates 4-digit PIN / QR hash and marks the order collected idempotently.
 */
exports.verifyPickup = (0, https_1.onCall)(async (request) => {
    if (!request.auth || !request.auth.uid) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    const actorRole = request.auth.token.role || 'student';
    if (actorRole !== 'pickup' && actorRole !== 'manager' && actorRole !== 'admin' && actorRole !== 'security_admin') {
        throw new https_1.HttpsError('permission-denied', 'Only pickup counter staff can verify and collect orders.');
    }
    const { orderId, pinCode } = request.data;
    if (!orderId || !pinCode) {
        throw new https_1.HttpsError('invalid-argument', 'orderId and pinCode are required.');
    }
    const orderRef = db.collection('orders').doc(orderId);
    const now = admin.firestore.Timestamp.now();
    return await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(orderRef);
        if (!snap.exists) {
            throw new https_1.HttpsError('not-found', 'Order not found.');
        }
        const orderData = snap.data();
        if (orderData.status === 'collected') {
            return { success: true, alreadyCollected: true, message: 'Order has already been collected.' };
        }
        if (orderData.status !== 'ready' && orderData.status !== 'confirmed' && orderData.status !== 'preparing') {
            throw new https_1.HttpsError('failed-precondition', `Order is currently in status: ${orderData.status}.`);
        }
        // Verify PIN or hash match
        const inputHash = crypto.createHash('sha256').update(pinCode.trim()).digest('hex');
        const isPinMatch = orderData.pickupPin === pinCode.trim() || orderData.pickupPinHash === inputHash;
        if (!isPinMatch) {
            // Record failed attempt
            const secRef = db.collection('securityEvents').doc();
            transaction.set(secRef, {
                eventType: 'FAILED_PICKUP_VERIFICATION',
                orderId,
                actorUid: request.auth.uid,
                timestamp: now,
            });
            throw new https_1.HttpsError('permission-denied', 'Incorrect pickup PIN/QR code.');
        }
        transaction.update(orderRef, {
            status: 'collected',
            collectedAt: now,
            collectedByStaffId: request.auth.uid,
            verificationMethod: 'PIN',
            updatedAt: now,
        });
        // Record immutable orderEvent
        const eventRef = db.collection('orderEvents').doc();
        transaction.set(eventRef, {
            orderId,
            fromStatus: orderData.status,
            toStatus: 'collected',
            actorId: request.auth.uid,
            actorRole,
            timestamp: now,
            metadata: { verificationMethod: 'PIN' },
        });
        return { success: true, alreadyCollected: false, orderId, tokenNumber: orderData.tokenNumber };
    });
});
//# sourceMappingURL=pickup_verify.js.map