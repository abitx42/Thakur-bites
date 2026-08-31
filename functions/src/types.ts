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

export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'refunded';

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
  paymentStatus: PaymentStatus;
  totalAmount: number;
  currency: 'INR';
  items: OrderItemSnapshot[];
  estimatedMinutes: number;
  createdAt: Timestamp;
  readyAt: Timestamp;
  collectedAt?: Timestamp;
  collectedByStaffId?: string;
}

export interface PaymentSessionRequest {
  orderId: string;
  gateway?: 'razorpay' | 'campus_upi' | 'mock';
}

export interface PaymentSessionResponse {
  orderId: string;
  gatewayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface PaymentVerificationRequest {
  orderId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
}

export interface PaymentRecord {
  paymentId: string;
  orderId: string;
  studentId: string;
  amount: number;
  currency: string;
  gateway: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  signatureVerified: boolean;
  status: 'captured' | 'refunded' | 'failed';
  createdAt: Timestamp;
}

export interface DailyReconciliationRecord {
  date: string;
  totalOrders: number;
  totalRevenue: number;
  onlineCollected: number;
  cashCollected: number;
  totalItemsSold: number;
  discrepanciesCount: number;
  reconciledAt: Timestamp;
  status: 'balanced' | 'investigation_required';
}
