import { Timestamp } from 'firebase-admin/firestore';

export type UserRole = 'student' | 'kitchen' | 'pickup' | 'manager' | 'admin' | 'security_admin' | 'system';

export type OrderStatus =
  | 'draft'
  | 'payment_pending'
  | 'paid'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'collected'
  | 'cancelled';

export interface CheckoutRequestItem {
  itemId: string;
  quantity: number;
}

export interface CheckoutRequest {
  idempotencyKey: string;
  items: CheckoutRequestItem[];
}

export interface OrderItemSnapshot {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  type: 'cooked' | 'instant';
  station: string;
}

export interface OrderDocument {
  id: string;
  idempotencyKey: string;
  tokenNumber: string;
  pickupPin: string;
  pickupPinHash: string;
  studentId: string;
  studentName: string;
  studentRoll: string;
  status: OrderStatus;
  paymentStatus: 'unpaid' | 'pending' | 'paid';
  totalAmount: number;
  currency: 'INR';
  items: OrderItemSnapshot[];
  estimatedMinutes: number;
  createdAt: Timestamp;
  readyAt: Timestamp;
  collectedAt?: Timestamp;
  collectedByStaffId?: string;
}
