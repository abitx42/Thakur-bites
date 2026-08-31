# 🍛 Thakur Bites — Enterprise Canteen Operations & Security Architecture

[![Tests](https://img.shields.io/badge/tests-149%20passing-brightgreen.svg)](scripts/run_all_security_checks.sh)
[![Security Gate](https://img.shields.io/badge/security%20gate-100%20vectors%20passed-blue.svg)](functions/test/security_abuse.test.js)
[![Flutter](https://img.shields.io/badge/flutter-3.x%20Web-02569B.svg)](thakur_bites/)
[![Firebase](https://img.shields.io/badge/firebase-Cloud%20Functions%20v2-FFCA28.svg)](functions/)

**Thakur Bites** is a high-concurrency, security-hardened smart canteen pre-ordering, kitchen dispatch (KDS), and counter pickup ecosystem built for Thakur College of Engineering & Technology (TCET). 

It combines a Flutter Web student application, a vanilla JS/CSS live staff operations hub, and Firebase Cloud Functions v2 backend hardened with zero-trust institutional authentication, double-entry financial ledgers, and automated circuit breakers.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer["Client & Staff Operations Layer"]
        A["📱 Student Web App (Flutter Web)"] -->|HTTPS / App Check| Gateway["Firebase Cloud Functions v2"]
        B["👨‍🍳 Kitchen KDS Display (Web Hub)"] -->|WebSocket Sync| Firestore[("Authoritative Firestore DB")]
        C["📦 Pickup Counter Station"] -->|verifyPickup (PIN / QR)| Gateway
        D["💳 Cashier Counter Terminal"] -->|recordCashPayment| Gateway
        E["🛡️ Security & Sentinel Center"] -->|runSecurityIntegrityScan| Gateway
    end

    subgraph SecurityLayer["Zero-Trust Security & Invariant Layer"]
        Gateway --> AC["1. Firebase App Check Attestation"]
        AC --> AU["2. Institutional Email Invariant (@tcetmumbai.in + verified)"]
        AU --> RL["3. College NAT-Aware Rate Limiter (UID / Subnet)"]
        RL --> IV["4. Inventory Invariants (available = onHand - reserved)"]
        IV --> FL["5. Double-Entry Financial Ledger Invariants"]
    end

    subgraph DefenseLayer["Continuous Defense & Automation"]
        IM["⏰ Hourly Continuous Integrity Monitor"] -->|Checks Invariants| Firestore
        IM -->|Critical Breach Detected| CB["🚨 Auto-Trip to FINANCIAL_FROZEN"]
        EOD["⏰ Daily 23:59 Reconciliation Cron"] -->|Rebalances Ledgers| Firestore
        BK["💾 Cryptographic Backup Restore Validator"] -->|SHA-256 Checksum| Firestore
    end
```

---

## 🛡️ Core Security & Invariant Guarantees

1. **📦 Inventory Single Source of Truth**:
   - Physical available stock is computed strictly as:
     $$\text{availableStock} \equiv \text{stockOnHand} - \text{reservedStock}$$
   - Zero reliance on legacy duplicate counts; negative/corrupted numbers throw `INVENTORY_CORRUPTION` (no silent `Math.max(0, ...)` clamping).
2. **🚫 Zero-Trust Institutional Identity**:
   - Checkout strictly requires:
     $$\text{email} \land \text{email\_verified} === \text{true} \land \text{email ends with } \texttt{@tcetmumbai.in}$$
   - Zero test-environment bypasses in production authentication paths.
3. **🛡️ Firebase App Check & Non-Oracle Defense**:
   - Attests legitimate client instances on all sensitive callables (`createCheckout`, `createPaymentSession`, `recordCashPayment`, `processOrderRefund`, `assignStaffRole`, `setSystemOperationalMode`, `verifyPickup`, `unlockOrderPickupVerification`).
   - Standardized non-oracle error responses (`"Nice try. Try harder. 😉"` with correlated `incidentId`) preventing detector threshold leakage.
4. **💰 Double-Entry Ledger & Higher-Order Financial Invariants**:
   - Total debits strictly equal total credits for every transaction posting.
   - Cross-checks: $\text{Payment Captured} \equiv \text{Ledger Postings Total} \equiv \text{Order Total Amount Paise}$.
5. **🚨 Continuous Integrity Monitor & Tiered Circuit Breaker**:
   - Hourly full-cursor scanner across orders, inventory, and ledgers.
   - High-confidence critical violations automatically transition the system to `FINANCIAL_FROZEN`.
6. **🏎️ Cryptographic One-Time QR Nonce & CSPRNG PIN Verification**:
   - Orders secrets (`pickupPinHash`, `qrNonce`) are isolated in `orderSecrets/{orderId}` and locked from client reads.
   - 10-way concurrent verification races ensure exactly 1 succeeds and 9 fail with `REPLAY_DETECTED`.

---

## 🧪 Master Test & Verification Suite

To run all 5 enterprise security gates sequentially:

```bash
./scripts/run_all_security_checks.sh
```

### 📊 Verification Suite Breakdown (149 Tests Total)

| Test Suite | Total Tests | Status | Description |
| :--- | :---: | :---: | :--- |
| **Backend Red Team & Security Abuse** | 100 | `100% PASS` | Adversarial vectors (Tests 1–100) covering IDOR, race conditions, parameter pollution, brute force lockout, and App Check. |
| **Backend Core Invariants & Schemas** | 24 | `100% PASS` | Checkout calculation, two-phase reservations, HMAC webhooks, and state machine transitions. |
| **Flutter Client Unit & Widget Suite** | 25 | `100% PASS` | Pricing invariants, CartProvider, dynamic wait ETAs, and ticket token sequences. |
| **Flutter Static Analysis** | — | `0 Errors` | `dart analyze --fatal-infos` passing with zero warnings. |
| **Automated Backup & Restore Engine** | — | `VERIFIED` | Cryptographic SHA-256 checksum and balance verification. |
| **E2E 14-Point Lifecycle Smoke Test** | 14 | `100% PASS` | Full student checkout $\to$ webhook $\to$ KDS $\to$ QR pickup $\to$ sanitized rating lifecycle. |
| **100-Order Peak Lunch Rush Simulator**| 100 | `100% PASS` | 100 concurrent parallel checkout requests with 0 dropped orders and 0 oversold units. |

---

## 🚀 Local Development & Execution

### 1. Start the Student Web App (Flutter Web)
```bash
cd thakur_bites
flutter build web --release
python3 -m http.server 8080 --directory build/web
```
Access at: [`http://localhost:8080`](http://localhost:8080)

### 2. Start the Staff Operations Hub (KDS / Pickup / Admin / Security Center)
```bash
python3 server_no_cache.py
```
Access at: [`http://localhost:8081`](http://localhost:8081)

### 3. Run Backend Unit & Security Tests
```bash
cd functions
npm run build
npm test
```

---

## 📂 Repository Structure

```
.
├── functions/                     # Firebase Cloud Functions v2 Backend
│   ├── src/
│   │   ├── checkout.ts            # Atomic Two-Phase Checkout & Reservation
│   │   ├── inventory_reservation.ts# SSoT Inventory Engine
│   │   ├── integrity_monitor.ts   # Continuous Integrity Scanner & Circuit Breaker
│   │   ├── security_logger.ts     # Global Deterministic Telemetry & Budgeting
│   │   ├── kill_switch.ts         # Operational Mode Controller & RBAC
│   │   ├── pickup_verify.ts       # Cryptographic Nonce & PIN Pickup Engine
│   │   ├── payments.ts            # Transactional Payment Sessions & Webhooks
│   │   └── app_check.ts           # Firebase App Check Attestation Helper
│   ├── test/
│   │   └── security_abuse.test.js # 100 Red Team Adversarial Test Vectors
│   └── scripts/
│       └── verify_backup_restore.js# Backup Restore Integrity Validator
├── thakur_bites/                  # Flutter Web Student Application
│   ├── lib/                       # Screens, Providers & Services
│   └── test/                      # Client-Side Invariant Test Suites
├── js/                            # Staff Operations Hub (Vanilla JS / WebSocket)
│   └── views/                     # KDS, Pickup, Admin, Security Center, TV Display
├── scripts/
│   ├── run_all_security_checks.sh # Master 5-Gate CI Verification Script
│   ├── e2e_smoke_test.js          # Full 14-Point Lifecycle Smoke Test
│   └── simulate_lunch_rush.js     # 100-Concurrent Order Load Simulator
└── firestore/
    └── firestore.rules            # Granular RBAC & PII-Minimized Security Rules
```

---

## 📜 License
Internal TCET Campus Operational Software. Engineered for high-integrity, fail-closed student dining.