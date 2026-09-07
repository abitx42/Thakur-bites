# 🛡️ THAKUR BITES — CANONICAL SECURITY INVARIANTS

> **Authoritative Architectural Specification**  
> Every feature, endpoint, schema modification, or client integration in Thakur Bites must strictly satisfy these canonical invariants. No pull request or deployment may bypass, weaken, or violate these rules.

---

## 🏛️ Section I: Pricing, Roles & Identity Authority

### `INV-001`: Server-Authoritative Integer Paise Pricing
- **Rule**: Clients NEVER determine prices, discounts, taxes, or total payable amounts.
- **Enforcement**: Backend `checkout.ts` snapshots `menuItems` directly inside the primary transaction, calculates item subtotals in integer paise (`Math.round(price * 100)`), and discards any client-supplied prices.
- **Verification**: Tests 236, 273, 280.

### `INV-002`: Server-Authoritative Identity & Role Governance
- **Rule**: Clients NEVER assign or elevate user roles, account types, priority levels, or verification statuses.
- **Enforcement**: Client account creation is blocked in `firestore.rules` (`allow create: if false;`). User profiles are provisioned server-side via `provisionUserProfile` enforcing Google Sign-In and institutional domain checks. Claims are written to isolated `authoritativeClaims/{uid}` reachable only by Admin SDK.
- **Verification**: Tests 221, 222, 223, 262, 263.

### `INV-003`: Stock-Reservation Floor Integrity
- **Rule**: Physical stock on hand can NEVER drop below actively reserved student checkout units (`stockOnHand >= reservedStock`).
- **Enforcement**: `adjustInventoryStock` and `reserveInventoryInTransaction` assert `newStockOnHand >= reservedStock` inside `db.runTransaction`. Any reduction violating this boundary fails closed with `failed-precondition`.
- **Verification**: Tests 258, 267, 268, 273.

---

## 💰 Section II: Financial & Inventory Ledgers

### `INV-004`: Deterministic Single Financial Ledger Capture
- **Rule**: A payment transaction (online gateway or counter cash) can produce EXACTLY ONE financial ledger entry under concurrent retries, webhook collisions, or network timeouts.
- **Enforcement**: `finalizeSuccessfulPayment` derives deterministic document IDs (`pay_fin_${gatewayPaymentId}` or `cash_fin_${orderId}`) and performs a Phase 1 read of `finTxRef`. If it exists, the transaction returns `{ alreadyCaptured: true }` idempotently.
- **Verification**: Tests 265, 271, 279.

### `INV-005`: Append-Only Historical Ledger Immutability
- **Rule**: Historical ledgers (`inventoryLedger`, `financialTransactions`, `orderEvents`) are strictly append-only. Zero update or delete operations are permitted.
- **Enforcement**: `firestore.rules` enforces `allow write: if false;` on all audit collections. CI static analysis sweeps TypeScript source files to assert 0 `.update()` or `.delete()` calls.
- **Verification**: Tests 269, 270.

### `INV-006`: Non-Resurrection of Cancelled Orders
- **Rule**: If a payment arrives after an order has been cancelled, the order status must NEVER be resurrected to `confirmed`, and inventory must NEVER be committed.
- **Enforcement**: `finalizeSuccessfulPayment` routes late payments to `orphanedPayments`, records the transaction under `ORPHAN_SUSPENSE`, and returns `{ status: 'cancelled', orphaned: true }`.
- **Verification**: Tests 230, 266.

---

## 🔐 Section III: Authorization, Sessions & Workstations

### `INV-007`: Capability-Driven Server-Side Authorization
- **Rule**: Operations are authorized strictly by canonical server capabilities (`SystemCapability`), not ad-hoc role strings or client UI routes.
- **Enforcement**: `assertCapability` evaluates caller role against `ROLE_CAPABILITY_MATRIX`. Unrecognized roles (e.g. `supergod`) fail closed.
- **Verification**: Tests 199, 219, 229, 263, 280.

### `INV-008`: Zero-PII Public TV Projection
- **Rule**: Public canteen displays and unauthenticated monitors receive strictly zero Personally Identifiable Information (PII), customer names, phones, item details, amounts, or priority stars.
- **Enforcement**: `buildPublicQueuePayload` projects only token (`TB-042`) and preparation wait time to `publicLiveQueue/current`.
- **Verification**: Tests 285.

### `INV-009`: Revocation-Aware Privileged Sessions
- **Rule**: When a privileged staff or developer account is demoted or tokens are revoked, existing privileged and workstation sessions must immediately fail closed.
- **Enforcement**: `assignStaffRole` revokes refresh tokens and marks active `privilegedSessions` and `workstationSessions` as `REVOKED`. `assertPrivilegedSession` checks `status === 'ACTIVE'`, authorized role, and normalized `tokensValidAfterTime`.
- **Verification**: Tests 272, 274, 281.

### `INV-010`: Full Forensic Traceability of Privileged Actions
- **Rule**: Every administrative, emergency, or inventory mutation must log an immutable audit event containing actor ID, role, action, reason, timestamp, and client IP/user-agent.
- **Enforcement**: `logSecurityEvent` records events with sanitized details to `securityEvents`.
- **Verification**: Tests 249, 269.

---

## ⚡ Section IV: Order Lifecycle, Concurrency & Verification

### `INV-011`: Two-Phase Inventory Lifecycle
- **Rule**: Online orders must be created in `payment_pending` and reserve stock. Physical stock is committed ONLY upon payment capture via `finalizeSuccessfulPayment`.
- **Enforcement**: Two-phase reservation engine in `inventory_reservation.ts`. Expired reservations release stock automatically.
- **Verification**: Tests 256, 268.

### `INV-012`: Unpaid Order Pickup Handover Barrier
- **Rule**: Food or packaged items can NEVER be released to a customer unless the order is fully paid (`paymentStatus === 'paid'` or `'captured'`).
- **Enforcement**: `verifyPickup` enforces payment status before verifying PIN or QR token.
- **Verification**: Tests 255, 280.

### `INV-013`: Pickup PIN Brute-Force Lockout
- **Rule**: 3 consecutive failed pickup PIN verification attempts permanently locks the order and invalidates the QR token.
- **Enforcement**: `verifyPickup` increments `failedPinAttempts` inside transaction. At 3 failures, marks `isLockedForInvestigation: true`.
- **Verification**: Tests 227, 284.

### `INV-014`: Cryptographic Order Secrets Isolation
- **Rule**: Pickup PIN hashes, QR nonces, and consumption timestamps are strictly isolated from public order documents.
- **Enforcement**: Secrets reside in `orderSecrets/{orderId}` with `allow read, write: if false;` in `firestore.rules`.
- **Verification**: Tests 284.

### `INV-015`: Ephemeral Action-Bound Step-Up Challenges
- **Rule**: Emergency platform actions (`KILL_SWITCH`, `FREEZE_FINANCIALS`, `UNFREEZE_PLATFORM`) strictly require an ephemeral 60-second, single-use CSPRNG nonce bound to the specific action and actor.
- **Enforcement**: `requestEmergencyStepUpChallenge` requires a privileged session, and `executeEmergencyOperationalAction` atomically consumes the challenge with constant-time comparison.
- **Verification**: Tests 264, 277.

---

## 🔄 Section V: Resilience, Disaster Recovery & Cloud Economics

### `INV-016`: Atomic State-Ledger Coupling
- **Rule**: State mutations (`stockOnHand`, `order.status`) and their corresponding ledger entries (`inventoryLedger`, `financialTransactions`) MUST be executed in the exact same Firestore transaction. Both commit, or neither commits.
- **Enforcement**: Staged pending mutations in `db.runTransaction`.
- **Verification**: Test 278.

### `INV-017`: Non-Fatal Decoupled Side Effects (Outbox Pattern)
- **Rule**: Push notifications, SMS, or external alerts must NEVER cause core payment finalization or inventory commit to fail or roll back.
- **Enforcement**: Asynchronous background triggers and top-level `try/catch` insulation in `notifications.ts`.
- **Verification**: Tests 275, 279.

### `INV-018`: Fail-Closed Zero-Trust on Database Records
- **Rule**: Backend handlers must NEVER trust existing database documents blindly. Malformed, negative, or corrupt fields fail closed.
- **Enforcement**: Type and boundary guards on every document read in `checkout.ts`, `inventory.ts`, and `pickup_verify.ts`.
- **Verification**: Test 280.

### `INV-019`: Stale Backup Invalidation
- **Rule**: Restoring an old database backup cannot resurrect demoted users or re-enable expired shift PINs.
- **Enforcement**: Verification against Firebase Auth `tokensValidAfterTime` epoch and date-bound shift PIN validation (`shiftDate === today`).
- **Verification**: Test 281.

### `INV-020`: Server-Authoritative Time & Normalized Timestamps
- **Rule**: All security timing decisions, challenge expirations, session idle windows, and shift dates are determined server-side in `Asia/Kolkata` (+05:30) offset.
- **Enforcement**: `normalizeTimestampToMillis` normalizes all timestamp representations uniformly.
- **Verification**: Tests 194, 225, 282.

### `INV-021`: Production App Check Attestation
- **Rule**: In production environments, all incoming callable requests must present a valid Firebase App Check attestation token.
- **Enforcement**: `enforceAppCheck` fails closed with `unauthenticated` if `request.app` is missing.
- **Verification**: Test 283.

### `INV-022`: Double-Entry Financial Balance
- **Rule**: Every financial transaction must satisfy the fundamental double-entry balance: `Sum of Debits == Sum of Credits`.
- **Enforcement**: Balanced postings generated in `payment_finalize.ts` and validated in daily reconciliation cron and integrity monitor.
- **Verification**: Tests 200, 242, 276.

### `INV-023`: Rate Limiting as Defense-in-Depth
- **Rule**: Rate limiting is strictly for abuse reduction and Denial-of-Wallet defense; it is never a substitute for authorization or capability verification.
- **Enforcement**: Core authorization barriers hold even when rotating IP addresses bypass rate limiters.
- **Verification**: Test 273.

### `INV-024`: Public Token vs. Internal ID Decoupling
- **Rule**: Sequential public tokens (`TB-001`, `TB-042`) are purely for display. Food handover and order mutations require the non-enumerable internal `orderId` plus cryptographic PIN/QR secrets.
- **Enforcement**: `orders/{orderId}` has non-enumerable document ID; `verifyPickup` requires both `orderId` and valid secret.
- **Verification**: Test 284.
