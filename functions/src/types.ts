import { Timestamp } from 'firebase-admin/firestore';

export type UserRole = 'student' | 'kitchen' | 'pickup' | 'cashier' | 'manager' | 'admin' | 'security_admin' | 'system';

export type OrderStatus =
  | 'draft'
  | 'payment_pending'
  | 'paid'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'collected'
  | 'cancelled';

export type PaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'captured'
  | 'settled'
  | 'refunded'
  | 'partially_refunded';

export type PaymentMethod = 'online' | 'counter_cash';

export interface CheckoutRequestItem {
  itemId: string;
  quantity: number;
}

export interface CheckoutRequest {
  idempotencyKey: string;
  items: CheckoutRequestItem[];
  paymentMethod?: PaymentMethod;
}

export interface OrderItemSnapshot {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitPricePaise: number; // Integer paise representation
  subtotal: number;
  subtotalPaise: number; // Integer paise representation
  type: 'cooked' | 'instant';
  station: string;
}

export interface OrderDocument {
  id: string;
  idempotencyKey: string;
  tokenNumber: string;
  studentId: string;
  studentName: string;
  studentRoll: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  totalAmountPaise: number; // Integer paise representation (e.g. 12000 = ₹120.00)
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
  unlockedByStaffId?: string;
  unlockedAt?: Timestamp;
  unlockReason?: string;
  refundId?: string;
  refundedAt?: Timestamp;
  refundedAmountPaise?: number;
  refundReason?: string;
  refundedByStaffId?: string;
  paidAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface OrderSecretDoc {
  orderId: string;
  studentId: string;
  pickupPinHash: string;
  qrNonce: string;
  qrExpiresAt: number;
  failedPinAttempts: number;
  isLockedForInvestigation: boolean;
  qrConsumedAt?: Timestamp;
  qrConsumedBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CheckoutResponse {
  orderId: string;
  order: OrderDocument;
  rawPin: string; // Delivered transiently in memory to student only
  signedQrPayload: string;
  isReplay: boolean;
}

export interface PaymentSessionRequest {
  orderId: string;
  gateway?: 'razorpay' | 'mock';
}

export interface PaymentSessionResponse {
  orderId: string;
  gatewayOrderId: string;
  amount: number;
  amountPaise: number;
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
  status: 'captured' | 'settled' | 'failed' | 'refunded' | 'partially_refunded';
  verifiedAt: Timestamp;
  auditSignature: string;
}

export type LedgerAccount =
  | 'GATEWAY_RECEIVABLE'
  | 'SALES_REVENUE'
  | 'CASH_ON_HAND'
  | 'GATEWAY_FEES'
  | 'CUSTOMER_REFUNDS';

export interface LedgerPosting {
  account: LedgerAccount;
  debitPaise: number;
  creditPaise: number;
}

export interface FinancialTransactionRecord {
  transactionId: string;
  orderId: string;
  type: 'PAYMENT_CAPTURE' | 'REFUND_DISBURSEMENT' | 'SETTLEMENT_CREDIT';
  amount: number;
  amountPaise: number;
  currency: 'INR';
  postings: LedgerPosting[];
  gatewayTransactionId: string;
  gatewayOrderId: string;
  actorId: string;
  timestamp: Timestamp;
  status: 'CAPTURED' | 'SETTLED' | 'REFUNDED';
}

export interface DailyReconciliationRecord {
  date: string;
  totalOrdersCount: number;
  totalRevenueCalculated: number;
  totalRevenuePaise: number;
  onlinePaymentsCaptured: number;
  counterCashEstimated: number;
  discrepanciesCount: number;
  reconciledAt: Timestamp;
  status: 'BALANCED' | 'DISCREPANCY_FLAGGED';
  auditNotes: string[];
}

export interface MenuItemDoc {
  itemId: string;
  name: string;
  price: number;
  description?: string;
  category: string;
  image?: string;
  type: 'cooked' | 'instant';
  isPublished: boolean;
  isOrderable: boolean;
  prepMinutes?: number;
  stockOnHand?: number;
  reservedStock?: number;
  reorderLevel?: number;
  lastRestockedAt?: Timestamp;
  available?: boolean;
  updatedAt?: Timestamp;
}

// ─── Platform 2.0: Universal Identity & Account System ───────────────

export type AccountType = 'VISITOR' | 'STUDENT' | 'TEACHER' | 'COLLEGE_STAFF';

export type VerificationStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export type PriorityLevel = 0 | 1 | 2 | 3;
// 0 = Visitor, 1 = Student, 2 = Teacher, 3 = Authorized Staff

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  accountType: AccountType;
  verificationStatus: VerificationStatus;
  priorityLevel: PriorityLevel;
  department?: string;
  designation?: string;
  year?: string;
  rollNo?: string;
  phone?: string;
  isVerified: boolean;
  accountDisabled: boolean;
  totalOrders: number;
  totalSpentPaise: number;
  averageOrderPaise: number;
  favouriteItemId?: string;
  firstOrderAt?: Timestamp;
  lastOrderAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface VerificationApplication {
  applicationId: string;
  userId: string;
  applicationType: 'TEACHER' | 'COLLEGE_STAFF';
  employeeId: string;
  department: string;
  designation: string;
  idProofStoragePath?: string;
  officialEmail?: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  submittedAt: Timestamp;
  reviewedAt?: Timestamp;
  reviewerId?: string;
  reviewNotes?: string;
}

export interface PriorityConfig {
  enabled: boolean;
  levels: Record<AccountType, PriorityLevel>;
  maxActivePriorityOrders: number;
  priorityCooldownMinutes: number;
  maxPriorityQueueSize: number;
}
