import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export interface MealRatingRequest {
  orderId: string;
  itemId: string;
  rating: number;
  comment?: string;
}

export interface MealRatingResponse {
  success: boolean;
  ratingId: string;
  orderId: string;
  itemId: string;
  rating: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * VERIFIED PURCHASE MEAL RATING ENGINE (Phase 4 Hardened)
 * ═══════════════════════════════════════════════════════════════════
 * Invariant Guarantees:
 * 1. Only students who purchased and collected the dish can rate it.
 * 2. Order must be in 'collected' status.
 * 3. Exactly one rating per order-item pair.
 * 4. Ratings bounded between 1 and 5 stars.
 */
export const createMealRating = onCall<MealRatingRequest>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Student must be authenticated to submit meal rating.');
  }

  const studentId = request.auth.uid;
  const { orderId, itemId, rating, comment = '' } = request.data;

  if (!orderId || !itemId || !Number.isSafeInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpsError('invalid-argument', 'Valid orderId, itemId, and integer rating (1-5) are required.');
  }

  const ratingId = `${orderId}_${itemId}`;
  const ratingRef = db.collection('ratings').doc(ratingId);
  const orderRef = db.collection('orders').doc(orderId);
  const itemRef = db.collection('menuItems').doc(itemId);
  const now = admin.firestore.Timestamp.now();

  return await db.runTransaction(async (transaction) => {
    // 1. Read rating document
    const ratingSnap = await transaction.get(ratingRef);
    if (ratingSnap.exists) {
      throw new HttpsError('already-exists', 'Rating has already been submitted for this item in this order.');
    }

    // 2. Read and verify order document
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found.`);
    }

    const orderData = orderSnap.data()!;

    // Proof of Ownership
    if (orderData.studentId !== studentId) {
      throw new HttpsError('permission-denied', 'Cannot rate an order placed by another student.');
    }

    // Proof of Collection (Must have actually received and eaten the food)
    if (orderData.status !== 'collected') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot rate meal before collection. Order is currently in '${orderData.status}' status.`
      );
    }

    // Proof of Item Purchase
    const orderItems = (orderData.items || []) as Array<{ itemId: string }>;
    const hasPurchasedItem = orderItems.some((it) => it.itemId === itemId);
    if (!hasPurchasedItem) {
      throw new HttpsError('failed-precondition', `Dish ${itemId} was not part of order ${orderId}.`);
    }

    // 3. Read menu item for aggregate score update
    const itemSnap = await transaction.get(itemRef);
    if (itemSnap.exists) {
      const itemData = itemSnap.data()!;
      const currentCount = Number(itemData.ratingCount || 0);
      const currentTotal = Number(itemData.ratingTotal || 0);

      const newCount = currentCount + 1;
      const newTotal = currentTotal + rating;
      const newAverage = Number((newTotal / newCount).toFixed(2));

      transaction.update(itemRef, {
        ratingCount: newCount,
        ratingTotal: newTotal,
        averageRating: newAverage,
        updatedAt: now,
      });
    }

    // 4. Save verified rating record
    transaction.set(ratingRef, {
      ratingId,
      orderId,
      itemId,
      studentId,
      rating,
      comment: comment.trim().slice(0, 500),
      createdAt: now,
      verifiedPurchase: true,
    });

    return {
      success: true,
      ratingId,
      orderId,
      itemId,
      rating,
    };
  });
});
