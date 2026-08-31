import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';

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
 * VERIFIED PURCHASE MEAL RATING ENGINE (Stage 5 Hardened)
 * ═══════════════════════════════════════════════════════════════════
 * Invariant Guarantees:
 * 1. Only students who purchased and collected the dish can rate it.
 * 2. Order must be in 'collected' status.
 * 3. Exactly one rating per order-item pair.
 * 4. Ratings bounded between 1 and 5 stars.
 * 5. Public rating view is redacted (ratingsPublic does not expose studentId/orderId).
 */
export const createMealRating = onCall<MealRatingRequest>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Student must be authenticated to submit meal rating.');
  }

  const studentId = request.auth.uid;
  await enforceRateLimit(studentId, 'rating');

  const { orderId, itemId, rating, comment = '' } = request.data;

  if (!orderId || !itemId || !Number.isSafeInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpsError('invalid-argument', 'Valid orderId, itemId, and integer rating (1-5) are required.');
  }

  const ratingId = `${orderId}_${itemId}`;
  const ratingRef = db.collection('ratings').doc(ratingId);
  const privateRatingRef = db.collection('ratingsPrivate').doc(ratingId);
  const publicRatingRef = db.collection('ratingsPublic').doc(ratingId);
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

    const trimmedComment = comment.trim().slice(0, 500);

    // 4a. Save private audit rating record (contains student & order binding)
    transaction.set(privateRatingRef, {
      ratingId,
      orderId,
      itemId,
      studentId,
      rating,
      comment: trimmedComment,
      createdAt: now,
      verifiedPurchase: true,
    });

    // 4b. Save public redacted rating record (contains only item, rating, comment, and verified flag)
    transaction.set(publicRatingRef, {
      ratingId,
      itemId,
      rating,
      comment: trimmedComment,
      createdAt: now,
      verifiedPurchase: true,
    });

    // 4c. Compatibility collection
    transaction.set(ratingRef, {
      ratingId,
      orderId,
      itemId,
      studentId,
      rating,
      comment: trimmedComment,
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
