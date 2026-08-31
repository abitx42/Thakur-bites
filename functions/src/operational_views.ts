import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserRole } from './types';

const db = admin.firestore();

export interface KitchenOrderView {
  orderId: string;
  tokenNumber: string;
  status: string;
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    station: string;
  }>;
  estimatedPrepTimeMinutes: number;
  createdAt: string;
}

export interface PickupOrderView {
  orderId: string;
  tokenNumber: string;
  studentName: string;
  studentRoll: string;
  status: string;
  paymentStatus: string;
  items: Array<{
    name: string;
    quantity: number;
  }>;
}

export interface CashierOrderView {
  orderId: string;
  tokenNumber: string;
  totalAmountPaise: number;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: string;
}

/**
 * 1. Kitchen KDS Least-Privilege Operational View.
 * Returns only station-specific items, token, and prep estimates.
 * Strips all student PII (email, phone, studentId) and financial gateway secrets.
 */
export const getKitchenOrders = onCall<void, Promise<KitchenOrderView[]>>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = (request.auth.token.role as UserRole) || 'student';
  if (role !== 'kitchen' && role !== 'manager' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Permission denied: Kitchen role required.');
  }

  const snap = await db.collection('orders')
    .where('status', 'in', ['confirmed', 'preparing'])
    .orderBy('createdAt', 'asc')
    .limit(100)
    .get();

  return snap.docs.map(doc => {
    const data = doc.data();
    return {
      orderId: doc.id,
      tokenNumber: data.tokenNumber || 'TB-???',
      status: data.status,
      items: (data.items || []).map((it: any) => ({
        itemId: it.itemId,
        name: it.name,
        quantity: it.quantity,
        station: it.station || 'general',
      })),
      estimatedPrepTimeMinutes: data.estimatedPrepTimeMinutes || 0,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    };
  });
});

/**
 * 2. Pickup Counter Least-Privilege Operational View.
 * Returns student verification name/roll, token, items, and ready status.
 */
export const getPickupOrders = onCall<void, Promise<PickupOrderView[]>>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = (request.auth.token.role as UserRole) || 'student';
  if (role !== 'pickup' && role !== 'manager' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Permission denied: Pickup role required.');
  }

  const snap = await db.collection('orders')
    .where('status', 'in', ['ready', 'preparing'])
    .orderBy('createdAt', 'asc')
    .limit(100)
    .get();

  return snap.docs.map(doc => {
    const data = doc.data();
    return {
      orderId: doc.id,
      tokenNumber: data.tokenNumber || 'TB-???',
      studentName: data.studentName || 'Student',
      studentRoll: data.studentRoll || 'TCET',
      status: data.status,
      paymentStatus: data.paymentStatus || 'unpaid',
      items: (data.items || []).map((it: any) => ({
        name: it.name,
        quantity: it.quantity,
      })),
    };
  });
});

/**
 * 3. Cashier Counter Least-Privilege Operational View.
 * Returns only token, amount in paise, and payment status for settlement.
 */
export const getCashierOrders = onCall<void, Promise<CashierOrderView[]>>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const role = (request.auth.token.role as UserRole) || 'student';
  if (role !== 'cashier' && role !== 'manager' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Permission denied: Cashier role required.');
  }

  const snap = await db.collection('orders')
    .where('paymentMethod', '==', 'counter_cash')
    .where('paymentStatus', '==', 'unpaid')
    .orderBy('createdAt', 'asc')
    .limit(100)
    .get();

  return snap.docs.map(doc => {
    const data = doc.data();
    return {
      orderId: doc.id,
      tokenNumber: data.tokenNumber || 'TB-???',
      totalAmountPaise: data.totalAmountPaise || Math.round(Number(data.totalAmount || 0) * 100),
      paymentStatus: data.paymentStatus,
      paymentMethod: data.paymentMethod,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
    };
  });
});
