# Thakur Bites — Firestore Collections Canonical Schema Specification 🛡️💳

## 1. Collections Overview

| Collection | Client Access | Write Method | Description |
|---|---|---|---|
| `menuItems` | Read (Public) | Manager/Admin Only | Dish catalog, base pricing, categories, station routing |
| `inventoryReservations` | Staff Read, Student Read (Own) | Backend Transaction | Two-phase stock reservation lifecycle (`RESERVED`, `COMMITTED`, `RELEASED`) |
| `inventoryLedger` | Staff Read (Restricted) | Append-Only (Backend) | Immutable ledger of stock changes with actor, changeType, deltaUnits |
| `orders` | Student Read (Own), Staff Read (All) | Trusted Backend Transaction | Order records, integer paise totals, SHA-256 PIN hash, QR nonce guards |
| `orderEvents` | Student Read (Own), Staff Read (All) | Append-Only (Backend) | Immutable history of order status transitions |
| `payments` | Student Read (Own), Staff Read (All) | Append-Only (Backend) | Immutable receipts tied to gateway payment IDs |
| `financialTransactions` | Staff Read Only | Append-Only (Backend) | Double-entry balanced financial accounting ledger (`postings: LedgerPosting[]`) |
| `dailyReconciliations` | Staff Read Only | Backend Transaction | Daily settlement balances in Asia/Kolkata timezone |
| `processedGatewayEvents` | No Client Access | Backend Transaction | Webhook idempotency lock table (`PROCESSING`, `PROCESSED`, `FAILED`) |
| `checkoutRequests` | No Client Access | Backend Transaction | Deterministic idempotency lock table (`studentId_idempotencyHash`) |
| `students` | Student Read/Write (Self only via field-level diff) | Client / Backend | Profile, roll number, department (security fields protected) |
| `ratings` | Public Read | Cloud Function (`createMealRating`) | Verified purchase post-pickup meal feedback |
| `staffUsers` | Staff Read (Self/Admin) | Admin Backend Only | Staff identity, assigned stations, role, active status |
| `securityEvents` | Security Admin Read Only | Append-Only (Backend) | Deduplicated intrusion/anomaly audit stream |
| `counters` | No Client Access | Backend Transaction | Daily sequence counters for tokens (`TB-001`) |
| `rateLimits` | No Client Access | Backend Transaction | Sliding window rate limits with automated TTL |

---

## 2. Granular Schemas (Synchronized with `functions/src/types.ts`)

### `orders/{orderId}`
```typescript
interface OrderRecord {
  id: string;
  idempotencyKey: string;
  tokenNumber: string;               // 'TB-001' (Daily sequential)
  pickupPinHash: string;             // SHA-256 hash of 4-digit CSPRNG PIN (No plaintext stored)
  qrNonce?: string;                  // Nonce for HMAC-SHA256 signed QR token
  qrExpiresAt?: number;              // Unix timestamp expiry (2 hours)
  qrConsumedAt?: Timestamp;          // One-time consumption timestamp
  qrConsumedBy?: string;             // Staff UID who scanned QR
  studentId: string;
  studentName: string;
  studentRoll: string;
  status: 'draft' | 'payment_pending' | 'paid' | 'confirmed' | 'preparing' | 'ready' | 'collected' | 'cancelled';
  paymentStatus: 'unpaid' | 'pending' | 'captured' | 'settled' | 'refunded' | 'partially_refunded';
  paymentMethod: 'online' | 'counter_cash';
  totalAmount: number;               // ₹120.00
  totalAmountPaise: number;          // 12000 (Authoritative integer representation)
  currency: 'INR';
  items: Array<{
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    unitPricePaise: number;
    subtotal: number;
    subtotalPaise: number;
    type: 'cooked' | 'instant';
    station: string;                 // 'dosa' | 'counter' | 'chinese' | 'beverage'
  }>;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  estimatedMinutes: number;
  failedPinAttempts?: number;
  isLockedForInvestigation?: boolean;
  unlockedByStaffId?: string;
  unlockedAt?: Timestamp;
  unlockReason?: string;
  refundId?: string;
  refundedAt?: Timestamp;
  refundedAmountPaise?: number;
  refundReason?: string;
  refundedByStaffId?: string;
  createdAt: Timestamp;
  readyAt: Timestamp;
  collectedAt?: Timestamp;
  collectedByStaffId?: string;
}
```

### `inventoryReservations/{reservationId}` (Two-Phase Stock Engine)
```typescript
interface InventoryReservationDoc {
  reservationId: string;             // Equal to orderId
  orderId: string;
  studentId: string;
  items: Array<{
    itemId: string;
    quantity: number;
  }>;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
  expiresAt: Timestamp;              // 15-minute reservation TTL
  createdAt: Timestamp;
  committedAt?: Timestamp;
  releasedAt?: Timestamp;
  releaseReason?: string;
}
```

### `financialTransactions/{txnId}` (Balanced Double-Entry Ledger)
```typescript
type LedgerAccount =
  | 'GATEWAY_RECEIVABLE'
  | 'SALES_REVENUE'
  | 'CASH_ON_HAND'
  | 'GATEWAY_FEES'
  | 'CUSTOMER_REFUNDS';

interface LedgerPosting {
  account: LedgerAccount;
  debitPaise: number;
  creditPaise: number;
}

interface FinancialTransactionRecord {
  transactionId: string;
  orderId: string;
  type: 'PAYMENT_CAPTURE' | 'REFUND_DISBURSEMENT' | 'SETTLEMENT_CREDIT';
  amount: number;
  amountPaise: number;
  currency: 'INR';
  postings: LedgerPosting[];         // Invariant: sum(debits) == sum(credits) == amountPaise
  gatewayTransactionId: string;      // 'pay_xxx' or 'rfnd_xxx'
  gatewayOrderId: string;            // 'order_xxx'
  actorId: string;                   // Student UID or Staff UID
  timestamp: Timestamp;
  status: 'CAPTURED' | 'SETTLED' | 'REFUNDED';
}
```

### `payments/{paymentId}` (Immutable Receipt Record)
```typescript
interface PaymentRecord {
  paymentId: string;
  orderId: string;
  studentId: string;
  gateway: 'razorpay_direct' | 'razorpay_webhook' | 'counter_cash' | 'mock';
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amount: number;
  currency: 'INR';
  status: 'captured' | 'settled' | 'failed' | 'refunded' | 'partially_refunded';
  verifiedAt: Timestamp;
  auditSignature: string;
}
```

### `ratings/{ratingId}` (Verified Purchase Feedback)
```typescript
interface MealRatingRecord {
  ratingId: string;                  // `${orderId}_${itemId}`
  orderId: string;
  itemId: string;
  studentId: string;
  rating: number;                    // Integer 1 - 5
  comment: string;
  verifiedPurchase: true;
  createdAt: Timestamp;
}
```

### `dailyReconciliations/{dateStr}`
```typescript
interface DailyReconciliationRecord {
  date: string;                      // '2026-08-31'
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
```

### `securityEvents/{eventId}` (Deduplicated Audit Stream)
```typescript
interface SecurityEventRecord {
  eventId: string;
  eventType: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actorUid: string;
  orderId?: string;
  requestId: string;
  timestamp: Timestamp;
  suppressedOccurrences: number;     // Aggregated count in 30-sec window
  details: Record<string, any>;
}
```
