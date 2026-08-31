# Thakur Bites — Enterprise System Architecture & Security Invariants 🛡️💳

## 1. System Topology & Trust Boundaries

```text
┌─────────────────────────┐          ┌─────────────────────────┐
│   Student Flutter App   │          │     Staff Web Portal    │
│  (iOS / Android / Web)  │          │      (Operations Hub)   │
└────────────┬────────────┘          └────────────┬────────────┘
             │                                    │
             ▼                                    ▼
┌───────────────────────────────────────────────────────────────┐
│               Firebase Authentication & App Check             │
│            • TCET Student Email (@tcetmumbai.in)              │
│            • Staff Firebase Auth + Role Custom Claims         │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────┐
│            Trusted Backend (Node.js 20 Cloud Functions)       │
│  • createCheckout: Atomic stock reservation & integer paise   │
│  • updateOrderStatus: Enforced state machine transitions      │
│  • createPaymentSession: Idempotent session provider          │
│  • verifyPayment: HMAC signature verification                 │
│  • handlePaymentWebhook: Server-to-server Razorpay webhooks   │
│  • finalizeSuccessfulPayment: Single atomic capture engine    │
│  • verifyPickup: Zero-knowledge PIN hash & signed QR token    │
│  • unlockOrderPickupVerification: Audited manager override    │
│  • processOrderRefund: Double-entry refund disbursement       │
│  • adjustInventoryStock: Invariant-checked inventory engine   │
│  • assignStaffRole: Cryptographic custom claims manager       │
│  • reconcileDailyLedger: Asia/Kolkata timezone reconciliation │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────┐
│             Firestore Database (Strict Rules Enforced)        │
│  • menuItems (Read: public; Write: Manager/Admin only)        │
│  • orders (Read: Owner/Staff only; Write: Backend only)       │
│  • students (Field-level update validation via diff())        │
│  • payments (Immutable receipt records; Write: Backend only)  │
│  • financialTransactions (Double-entry accounting ledger)     │
│  • dailyReconciliations (Daily revenue audit balances)        │
│  • inventoryLedger (Append-only stock delta audit ledger)     │
│  • orderEvents (Immutable transition audit logs)              │
│  • securityEvents (Deduplicated intrusion detection stream)   │
│  • processedGatewayEvents (Webhook idempotency lock table)    │
│  • checkoutRequests (Transactional idempotency reservation)   │
│  • counters / rateLimits (Internal backend collections)       │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural & Security Invariants

### 1. Integer Paise Financial Representation Everywhere
- All backend calculations, ledgers, and transactions use integer paise (`totalAmountPaise`, `unitPricePaise`, `subtotalPaise`, `amountPaise`) avoiding floating-point currency representation ($12000 = \text{₹}120.00$).

### 2. Single Authoritative Payment Finalizer (`finalizeSuccessfulPayment`)
- Unifies client signature verifications, webhook captures, and counter-cash payments into a single ACID transaction.
- Atomically guarantees:
  - Exactly 1 payment capture record in `payments`.
  - Exactly 1 financial transaction record in `financialTransactions`.
  - Strict validation of amount, currency, and gateway order IDs.
  - Exactly 1 order state transition: `payment_pending` $\rightarrow$ `confirmed`.

### 3. Retry-Safe Webhook Lifecycle
- Uses `PROCESSING` $\rightarrow$ `PROCESSED` $\rightarrow$ `FAILED` state transitions in `processedGatewayEvents`.
- Failed attempts remain retryable so payments are never permanently consumed on temporary downstream network failures.

### 4. Zero-Knowledge CSPRNG PINs & One-Time Signed QR Tokens
- **CSPRNG PIN**: Generated with `crypto.randomInt(1000, 10000)`, returned transiently to the student, and stored exclusively as SHA-256 hashes in Firestore.
- **Signed One-Time QR Tokens**:
  $$\text{Payload} = \text{orderId} \cdot \text{studentId} \cdot \text{nonce} \cdot \text{expiresAt} \cdot \text{HMAC-SHA256}(\dots)$$
  - Validates token expiry (2 hours), student binding (`tStudentId === order.studentId`), and consumes the nonce (`qrConsumedAt`) upon pickup to prevent replays.

### 5. PIN Brute-Force Sentinel & Manager Lockout Overrides
- Per-order failed PIN tracking automatically locks orders after 3 incorrect attempts.
- Provides audited [`unlockOrderPickupVerification`](file:///Users/adi/thakur%20bites/functions/src/pickup_verify.ts) restricted to Managers/Admins with mandatory audit reasons.

### 6. Double-Entry Accounting Ledger
- Distinguishes:
  - **Operational Ledgers**: `inventoryLedger`, `orderEvents`.
  - **Financial Ledgers**: `financialTransactions` (`PAYMENT_CAPTURE`, `REFUND_DISBURSEMENT`, `SETTLEMENT_CREDIT`), `payments`, `dailyReconciliations`.

### 7. Strict Role-Based Access Control (RBAC)
- Custom claims: `student`, `kitchen`, `pickup`, `manager`, `admin`, `security_admin`.
- Separation of duties:
  - `kitchen`: Order status progression only (`confirmed` $\rightarrow$ `preparing` $\rightarrow$ `ready`).
  - `pickup`: Ready order collection verification (`ready` $\rightarrow$ `collected`).
  - `manager`: Menu catalog, stock adjustments, PIN lockout overrides, refunds.
  - `admin` / `security_admin`: Role assignment, security audit stream, and system configuration.

---

## 3. Threat Model Summary

| Asset / Boundary | Threat Vector | Defense Architecture |
|---|---|---|
| **Money / Checkout** | Forged Client Prices | Server-side calculation from database price snapshots in integer paise. |
| **Inventory** | Race Conditions / Overselling | ACID serialized transactions competing over inventory documents. |
| **Orders** | Unauthorized Access / IDOR | Strict Firestore ownership checks (`resource.data.studentId == auth.uid`). |
| **Pickup** | Stolen Token / PIN Brute-Force | CSPRNG Zero-Knowledge PINs + 3-attempt lockout + signed expiring QR tokens. |
| **Payment Gateway** | Signature Replay & Webhook Tampering | Timing-safe HMAC-SHA256 checks, amount cross-matching, and webhook lock tables. |
| **Staff Roles** | Privilege Escalation | Custom claims managed exclusively via backend Admin Cloud Functions. |
