# Thakur Bites — Firestore Collections Schema Specification 🛡️💳

## 1. Collections Overview

| Collection | Client Access | Write Method | Description |
|---|---|---|---|
| `menuItems` | Read (Public) | Manager/Admin Only | Dish catalog, base pricing, categories, station routing |
| `inventoryLedger` | Staff Read (Restricted) | Append-Only (Backend) | Immutable ledger of stock changes with actor, changeType, deltaUnits |
| `orders` | Student Read (Own), Staff Read (All) | Trusted Backend Transaction | Order records, integer paise totals, SHA-256 PIN hash, QR nonce guards |
| `orderEvents` | Student Read (Own), Staff Read (All) | Append-Only (Backend) | Immutable history of order status transitions |
| `payments` | Student Read (Own), Staff Read (All) | Append-Only (Backend) | Immutable receipts tied to gateway payment IDs |
| `financialTransactions` | Staff Read Only | Append-Only (Backend) | Double-entry financial accounting ledger (`PAYMENT_CAPTURE`, `REFUND_DISBURSEMENT`) |
| `dailyReconciliations` | Staff Read Only | Backend Transaction | Daily settlement balances in Asia/Kolkata timezone |
| `processedGatewayEvents` | No Client Access | Backend Transaction | Webhook idempotency lock table (`PROCESSING`, `PROCESSED`, `FAILED`) |
| `checkoutRequests` | No Client Access | Backend Transaction | Deterministic idempotency lock table (`studentId_idempotencyHash`) |
| `students` | Student Read/Write (Self only via field-level diff) | Client / Backend | Profile, roll number, department (security fields protected) |
| `ratings` | Student Read/Create (Self only), Staff Read | Client / Backend | Post-pickup meal feedback |
| `staffUsers` | Staff Read (Self/Admin) | Admin Backend Only | Staff identity, assigned stations, role, active status |
| `securityEvents` | Security Admin Read Only | Append-Only (Backend) | Deduplicated intrusion/anomaly audit stream |
| `counters` | No Client Access | Backend Transaction | Daily sequence counters for tokens (`TB-001`) |
| `rateLimits` | No Client Access | Backend Transaction | Sliding window rate limits with automated TTL |

---

## 2. Granular Schemas

### `orders/{orderId}`
```typescript
interface OrderRecord {
  id: string;
  idempotencyKey: string;
  tokenNumber: string;               // 'TB-001' (Daily sequential)
  pickupPinHash: string;             // SHA-256 hash of 4-digit CSPRNG PIN
  qrNonce?: string;                  // Nonce for HMAC-SHA256 signed QR token
  qrExpiresAt?: number;              // Unix timestamp expiry (2 hours)
  qrConsumedAt?: Timestamp;          // One-time consumption timestamp
  qrConsumedBy?: string;             // Staff UID who scanned QR
  studentId: string;
  studentName: string;
  studentRoll: string;
  status: 'draft' | 'payment_pending' | 'paid' | 'confirmed' | 'preparing' | 'ready' | 'collected' | 'cancelled';
  paymentStatus: 'unpaid' | 'pending' | 'paid' | 'refunded' | 'partially_refunded';
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
  createdAt: Timestamp;
  readyAt?: Timestamp;
  collectedAt?: Timestamp;
  collectedByStaffId?: string;
}
```

### `financialTransactions/{txnId}` (Immutable Double-Entry Ledger)
```typescript
interface FinancialTransactionRecord {
  transactionId: string;
  orderId: string;
  type: 'PAYMENT_CAPTURE' | 'REFUND_DISBURSEMENT' | 'SETTLEMENT_CREDIT';
  amount: number;
  currency: 'INR';
  gatewayTransactionId: string;      // 'pay_xxx' or 'rfnd_xxx'
  gatewayOrderId: string;            // 'order_xxx'
  actorId: string;                   // Student UID or Staff UID
  timestamp: Timestamp;
  status: 'settled' | 'pending' | 'disputed';
}
```

### `payments/{paymentId}` (Immutable Receipt Record)
```typescript
interface PaymentRecord {
  paymentId: string;
  orderId: string;
  studentId: string;
  gateway: 'razorpay' | 'razorpay_webhook' | 'counter_cash' | 'mock';
  gatewayOrderId: string;
  gatewayPaymentId: string;
  amount: number;
  currency: 'INR';
  status: 'captured' | 'failed' | 'refunded';
  verifiedAt: Timestamp;
  auditSignature: string;
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
