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
  paymentMethod?: 'online' | 'counter_cash';
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
  pickupPinHash: string; // Zero-knowledge: Stored as SHA-256 hash only
  qrNonce?: string;
  qrExpiresAt?: number;
  pickupPin?: string; // Only populated transiently during student dispatch
  studentId: string;
  studentName: string;
  studentRoll: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalAmount: number;
  currency: 'INR';
  items: OrderItemSnapshot[];
  estimatedMinutes: number;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  createdAt: Timestamp;
  readyAt: Timestamp;
  collectedAt?: Timestamp;
  collectedByStaffId?: string;
  verificationMethod?: 'PIN' | 'QR';
  failedPinAttempts?: number;
  isLockedForInvestigation?: boolean;
}

export interface PaymentSessionRequest {
  orderId: string;
  gateway?: 'razorpay' | 'mock';
}

export interface PaymentSessionResponse {
  orderId: string;
  gatewayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  adapterMode: 'PRODUCTION_GATEWAY' | 'SIMULATION_ADAPTER';
  notes: Record<string, string>;
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
  gateway: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amount: number;
  currency: string;
  status: 'captured' | 'failed' | 'refunded';
  verifiedAt: Timestamp;
  auditSignature: string;
}

export interface FinancialTransactionRecord {
  transactionId: string;
  orderId: string;
  type: 'PAYMENT_CAPTURE' | 'REFUND_DISBURSEMENT' | 'SETTLEMENT_CREDIT';
  amount: number;
  currency: 'INR';
  gatewayTransactionId: string;
  gatewayOrderId: string;
  actorId: string;
  timestamp: Timestamp;
  status: 'settled' | 'pending' | 'disputed';
}

export interface DailyReconciliationRecord {
  date: string;
  totalOrdersCount: number;
  totalRevenueCalculated: number;
  onlinePaymentsCaptured: number;
  counterCashEstimated: number;
  discrepanciesCount: number;
  reconciledAt: Timestamp;
  status: 'BALANCED' | 'DISCREPANCY_FLAGGED';
  auditNotes: string[];
}
