import * as admin from 'firebase-admin';
import { PriorityLevel, AccountType } from './types';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const PRIORITY_WEIGHTS: Record<number, number> = {
  0: 0,   // Visitor
  1: 100, // Student
  2: 200, // Faculty / Teacher / College Staff
  3: 300, // VIP / Emergency
};

export const AGING_POINTS_PER_MINUTE = 5;

/**
 * Calculates dynamic Effective Priority Score.
 * 
 * Score = BasePriorityScore + (WaitMinutes * 5)
 * 
 * Anti-starvation property: A student waiting 20 minutes earns 100 + 100 = 200 points,
 * matching a newly arrived faculty order, ensuring fair queue progression.
 */
export function calculateEffectivePriority(
  priorityLevel: number,
  createdAt: Date,
  now: Date = new Date()
): number {
  const baseWeight = PRIORITY_WEIGHTS[priorityLevel] ?? 100;
  const waitMs = Math.max(0, now.getTime() - createdAt.getTime());
  const waitMinutes = waitMs / (1000 * 60);
  const agingBonus = Math.floor(waitMinutes * AGING_POINTS_PER_MINUTE);
  return baseWeight + agingBonus;
}

/**
 * Checks fairness limit: Maximum 1 active priority order per faculty/teacher.
 * If user already has an order in CONFIRMED or PREPARING state, returns fallback Level 1.
 */
export async function evaluateOrderPriorityLevel(
  userId: string,
  userAccountType: AccountType,
  userPriorityLevel: PriorityLevel
): Promise<{ assignedPriority: PriorityLevel; priorityReason: string }> {
  // Only Level 2+ requires active fairness throttling
  if (userPriorityLevel < 2) {
    return {
      assignedPriority: userPriorityLevel,
      priorityReason: 'STANDARD_QUEUE',
    };
  }

  try {
    const activeOrdersSnap = await db
      .collection('orders')
      .where('studentId', '==', userId)
      .where('status', 'in', ['confirmed', 'preparing'])
      .get();

    const hasActivePriority = activeOrdersSnap.docs.some(
      (doc) => (doc.data().priorityLevel || 0) >= 2
    );

    if (hasActivePriority) {
      return {
        assignedPriority: 1 as PriorityLevel,
        priorityReason: 'FAIRNESS_MAX_ACTIVE_PRIORITY_REACHED',
      };
    }

    return {
      assignedPriority: userPriorityLevel,
      priorityReason: 'FACULTY_PRIORITY_APPLIED',
    };
  } catch (error) {
    console.warn('Error checking active priority count, failing closed to standard queue:', error);
    // Invariant: Fail-closed security posture (TB-005) - never grant unverified elevated priority
    return {
      assignedPriority: 1 as PriorityLevel,
      priorityReason: 'FAIL_CLOSED_STANDARD_QUEUE',
    };
  }
}
