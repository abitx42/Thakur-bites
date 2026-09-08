# 🍛 Thakur Bites Platform 2.0 — Smart Campus Canteen Operating System

[![Backend Tests](https://img.shields.io/badge/backend%20invariants-396%20passing-brightgreen.svg)](functions/test/)
[![Client Tests](https://img.shields.io/badge/flutter%20tests-67%20passing-blue.svg)](thakur_bites/test/)
[![Emulator Tests](https://img.shields.io/badge/firestore%20emulator-22%20passing-success.svg)](functions/test/emulator/)
[![Static Analysis](https://img.shields.io/badge/static%20analysis-clean%20(0%20issues)-green.svg)](thakur_bites/)
[![Firebase](https://img.shields.io/badge/firebase-Cloud%20Functions%20v2-FFCA28.svg)](functions/)

**Thakur Bites Platform 2.0** is an enterprise-grade digital canteen pre-ordering, kitchen dispatch (KDS), and counter pickup operating system built specifically for Thakur College of Engineering & Technology (TCET).

It synchronizes three distinct interfaces backed by a single authoritative cloud backend:
1. **📱 Flutter Customer App**: For students, visitors, and verified teachers/faculty.
2. **🍳 Staff Operations Hub**: Web workstation portal for Kitchen KDS, Pickup Dispatch, Menu & Inventory Control, Owner Executive Dashboard, and Developer Security Cockpit.
3. **📺 Standalone 4K TV Board (`web_tv/`)**: Zero-authentication, high-contrast order dispatch monitor for cafeteria wall TVs.

---

## 🏛️ Platform 2.0 Architecture

```mermaid
flowchart TD
    subgraph ClientLayer["Client & Operations Layer"]
        A["📱 Customer App (Flutter Web/Mobile)"] -->|HTTPS / App Check| Gateway["Firebase Cloud Functions v2"]
        B["🍳 Kitchen KDS Display (Web Hub)"] -->|WebSocket Sync| Firestore[("Authoritative Firestore DB")]
        C["📦 Pickup Counter Station"] -->|verifyPickup (PIN / QR)| Gateway
        D["📊 Owner Executive Console"] -->|getOwnerBusinessMetrics| Gateway
        E["🛡️ Developer Security Cockpit"] -->|executeEmergencyOperationalAction| Gateway
        F["📺 Standalone TV Board (web_tv/)"] -->|Zero-Auth Read| Firestore
    end

    subgraph SecurityLayer["Platform 2.0 Invariant Engines"]
        Gateway --> AU["1. Universal Identity Classifier (Student/Visitor/Teacher)"]
        Gateway --> PQ["2. Anti-Starvation Priority Queue Scheduler (Fail-Closed)"]
        Gateway --> SP["3. PBKDF2 Shift PINs & Hardware Device Binding"]
        Gateway --> RE["4. Authoritative Live Reorder Engine"]
        Gateway --> IV["5. Two-Phase Inventory Locks (available = onHand - reserved)"]
        Gateway --> FL["6. Double-Entry Integer Paise Financial Ledgers"]
        Gateway --> OR["7. Orphaned Payment Reconciler (Zero Cancelled Resurrections)"]
    end

    subgraph DefenseLayer["Continuous Defense & Automation"]
        IM["⏰ Hourly Continuous Integrity Monitor"] -->|Checks 15 Invariants| Firestore
        IM -->|Critical Breach Detected| CB["🚨 Auto-Trip to FINANCIAL_FROZEN"]
        EOD["⏰ Daily 23:59 Reconciliation Cron"] -->|Rebalances Ledgers| Firestore
        BK["💾 Cryptographic Backup Restore Validator"] -->|SHA-256 Checksum| Firestore
    end
```

---

## 🌟 Core Platform 2.0 Innovations

1. **🧑‍🎓 Universal Multi-Role Identity System**:
   - Google account determines identity hint; backend determines role and priority level.
   - TCET institutional student emails (`@tcetmumbai.in`) verified automatically. Visitors given safe guest accounts.
   - In-place faculty verification elevates teachers to Priority Level 2 on the **same UID** without account duplication.

2. **⚡️ Anti-Starvation Priority Queue Scheduling**:
   - Dynamic Effective Priority formula: $P_{\text{eff}} = P_{\text{base}} + (\text{WaitMinutes} \times 5)$.
   - Every minute a student ticket waits, it gains $+5$ points, catching up to faculty tickets after 20 minutes to prevent queue stagnation.
   - Faculty throttled to max 1 concurrent active priority order inside the checkout transaction; subsequent orders drop to standard queue.

3. **🔑 PBKDF2 Shift PINs & Workstation Hardware Binding**:
   - 6-digit CSPRNG shift PINs derived with PBKDF2 (10,000 iterations + salt) in `shiftPins/{pinId}`.
   - Binds each PIN to designated counter hardware tablet UUIDs (`tb_workstation_device_id`), blocking unauthorized personal device access.
   - 5-strike brute-force lockout locks workstation login for 15 minutes.

4. **📺 Standalone 4K TV Display Web App (`web_tv/`)**:
   - Zero-authentication web app with 3 resilient stream states: 🟢 **Live Stream**, 🟡 **Reconnecting**, and 🔴 **Off-Hours Standby**.
   - Zero-PII security boundary (strips student names, roll numbers, and payment details).
   - Synthesized Web Audio API two-tone counter bell chime when tokens enter `READY` state.

5. **📊 Executive Owner Console & Predictive Stockout Forecaster**:
   - Real-time gross revenue, Digital UPI vs Cash breakdown, AOV, and active ticket distribution.
   - Run-rate stockout forecaster: $\text{burnRate} = \frac{\text{unitsSold}}{\text{hoursElapsed}}$ and $\text{hoursRemaining} = \frac{\text{availableStock}}{\text{burnRate}}$.
   - Campus feature flags: Mobile Ordering, Faculty Priority, Cash Counter, and Rush Multiplier (1.0x to 2.5x).

6. **🛡️ Developer Command Cockpit & Four-Eyes Disaster Recovery**:
   - Real-time security incident stream with deterministic state-machine progression.
   - Four-eyes approval gate: Unfreezing `FINANCIAL_FROZEN` mode requires two distinct administrators (`requestedBy ≠ approvingAdminUid`) or verified cryptographic SHA-256 break-glass token.
   - Server-authoritative double-entry ledger whitelist with zero free-text account entries.

---

## 📊 Tiered Production-Readiness Verification Matrix

Rather than conflating unit test counts with full production certification, Thakur Bites adheres to an honest multi-tier verification model:

| Verification Tier | Target Area | Status | Evidence / Command |
| :--- | :--- | :---: | :--- |
| **Tier 1: Backend Invariants** | Logic, RBAC, ledgers & state machines | ✅ **396 / 396 PASS** | `npm test` in `functions/` (18 test suites) |
| **Tier 1: Flutter Client** | State, pricing, preferences & UI models | ✅ **67 / 67 PASS** | `flutter test` in `thakur_bites/` (7 test suites) |
| **Tier 1: Static Code Analysis** | Type safety, secret hygiene & linter | ✅ **0 ISSUES** | `dart analyze --fatal-infos` & `tsc` clean |
| **Tier 2: Real Firebase Emulator** | Firestore Rules & atomic transactions | ✅ **22 / 22 PASS** | `npm run test:emulator` (Rules, Concurrency, DR) |
| **Tier 3: Razorpay Test Mode** | Sandbox payment, HMAC & webhook race | ⏳ **In Progress** | Automated harness passing; awaiting manual pilot check |
| **Tier 4: Physical Device Smoke** | Android release APK & iOS on campus | ⏳ **Awaiting Build** | Real-device installation on TCET Wi-Fi & 4G network |
| **Pilot 0: TCET Operational Trial**| Canteen staff dry-run with 5 test orders| ⏳ **Staged** | Pilot 0 runbook protocol prepared |

---

## 🧪 Master Test & Verification Suite

Run all enterprise security gates sequentially:

```bash
# Run Tier 1 unit & invariant suite
cd functions && npm test

# Run Tier 2 real Firestore emulator suite
cd functions && npm run test:emulator

# Run Flutter client test suite
cd thakur_bites && flutter test

# Run Master CI Verification Script (9 Gates)
bash scripts/run_all_security_checks.sh
```

| Verification Gate | Test Count | Status | Description |
| :--- | :---: | :---: | :--- |
| **Backend Invariant & Security Suite** | 396 | `100% PASS` | Canonical RBAC, distributed refund idempotency, delta accounting rollbacks, TV data minimization, orphaned payments, and four-eyes DR approval. |
| **Flutter Client Unit & Widget Suite** | 67 | `100% PASS` | Pricing models, UserProfile parser, UserPreferences, ETA Rush scaling, CartProvider, operational banners, and offline recovery. |
| **Flutter Static Analysis** | — | `0 Errors` | `dart analyze --fatal-infos` passing cleanly with 0 warnings or infos. |
| **Real Firestore Emulator Suite** | 22 | `100% PASS` | Real Firestore Security Rules enforcement (12 tests), transaction concurrency & overselling prevention (4 tests), and multi-admin DR approval transactions (6 tests). |
| **Automated Backup & Restore Engine** | 4 | `VERIFIED` | Cryptographic SHA-256 checksum and ledger balance verification. |
| **100-Order Peak Lunch Rush Simulator** | 100 | `100% PASS` | 100 parallel checkout requests with 0 dropped orders and 0 oversold units. |
| **Security Invariant Assertion Suite** | 18 | `100% PASS` | 10 attack classes tested against live cloud function signatures (100% defended). |

---

## 🚀 Quick Start & Development Launcher

### Interactive Multi-Service Launcher
```bash
./scripts/dev_runner.sh
```
- **`[A]`**: Run Master Security CI Verification Suite (187 Tests)
- **`[B]`**: Start Staff Hub & TV Display HTTP Server (Port 3000)
- **`[C]`**: Launch Flutter Web Client (Port 8080)
- **`[D]`**: Seed Realistic Demo Campus Data into Firestore

### Key Port Matrix
| Interface | Local URL | Authentication |
|:---|:---|:---|
| **Customer Web App** | `http://localhost:8080` | Google Sign-In / Student Login |
| **Staff Operations Hub** | `http://localhost:3000` | Dynamic Shift PIN (CSPRNG generated) or Email |
| **Cafeteria 4K TV Board** | `http://localhost:3000/web_tv` | Zero-Auth (Public Read-Only) |

---

## 📄 License & Compliance

Thakur Bites Platform 2.0 is licensed under the MIT License for Thakur College of Engineering & Technology (TCET).
