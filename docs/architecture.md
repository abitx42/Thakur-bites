# Thakur Bites — System Architecture & Trust Boundaries

## 1. System Topology & Trust Boundaries

```text
┌─────────────────────────┐          ┌─────────────────────────┐
│   Student Flutter App   │          │     Staff Web Portal    │
│    (iOS / Android / Web)│          │      (Operations Hub)   │
└────────────┬────────────┘          └────────────┬────────────┘
             │                                    │
             ▼                                    ▼
┌───────────────────────────────────────────────────────────────┐
│               Firebase Authentication & App Check             │
│            • TCET Student Email / Verified Mobile             │
│            • Staff Firebase Auth + Role Custom Claims         │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────┐
│             Trusted Backend (Cloud Functions / API)           │
│  • createCheckout (Idempotent, Atomic Inventory, Pricing)     │
│  • updateOrderStatus (State Machine & Transition Rules)       │
│  • verifyPickupToken (Signed Single-Use Pickup Verification)  │
│  • assignStaffRole (Admin Approval & Audit Trail)             │
│  • reconcileDailyLedger (Financial & Stock Reconciliation)    │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────┐
│             Firestore Database (Strict Rules Enforced)        │
│  • menuItems (Read-only to clients; write via Admin Function) │
│  • orders (Read-only to relevant user/role; write via Backend)│
│  • inventoryLedger (Immutable append-only audit trail)        │
│  • orderEvents (Immutable state transition history)           │
│  • securityEvents (Immutable intrusion/anomaly audit log)     │
└───────────────────────────────────────────────────────────────┘
```

## 2. Core Security Invariants
1. **Client Never Dictates Price or Inventory**:
   - The client never passes price, subtotal, discount, or direct stock decrement writes.
   - The backend looks up authoritative pricing from `menuItems` and executes ACID transactions.
2. **Idempotency by Design**:
   - Every checkout attempt carries a client-generated UUID `idempotencyKey`. Retried requests return the identical logical order without duplicate billing or duplicate inventory deductions.
3. **No Direct Client Database Writes for Sensitive Collections**:
   - Direct client writes to `orders`, `inventoryLedger`, `orderEvents`, `counters`, and `securityEvents` are completely disallowed in `firestore.rules`.
4. **Least-Privilege Role Based Access Control (RBAC)**:
   - Staff credentials are bound to verified Firebase Auth accounts with cryptographically signed Custom Claims: `kitchen`, `pickup`, `manager`, `admin`, `security_admin`.
   - No shared or hardcoded client-side PINs.
