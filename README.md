# 🍛 Thakur Bites Platform 2.0 — Smart Campus Canteen Operating System

[![Tests](https://img.shields.io/badge/tests-247%20passing-brightgreen.svg)](scripts/run_all_security_checks.sh)
[![Security Gate](https://img.shields.io/badge/security%20invariants-177%20vectors%20passed-blue.svg)](functions/test/security_abuse.test.js)
[![Flutter](https://img.shields.io/badge/flutter-3.29%20Web%20%26%20Mobile-02569B.svg)](thakur_bites/)
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

6. **🛡️ Developer Command Cockpit & Step-Up Ephemeral Challenges**:
   - Real-time security incident stream with deterministic SHA-256 deduplication.
   - Destructive emergency operations require server-issued 60-second single-use challenge nonces.
   - Automated 15-point invariant integrity scanner and RBAC permission matrix simulator.

---

## 🧪 Master Test & Verification Suite (247 Tests Total)

Run all 9 enterprise security gates sequentially:

```bash
bash scripts/run_all_security_checks.sh
```

| Verification Gate | Test Count | Status | Description |
| :--- | :---: | :---: | :--- |
| **Backend Invariant & Security Abuse Suite** | 201 | `100% PASS` | Tests 1–177 covering identity classification, priority math, PBKDF2 shift PINs, TV minimization, orphaned payments, and step-up challenges. |
| **Flutter Client Unit & Widget Suite** | 31 | `100% PASS` | Pricing models, UserProfile parser, UserPreferences, ETA Rush scaling, and CartProvider. |
| **Flutter Static Analysis** | — | `0 Errors` | `dart analyze --fatal-infos` passing cleanly with 0 warnings. |
| **Automated Backup & Restore Engine** | 4 | `VERIFIED` | Cryptographic SHA-256 checksum and ledger balance verification. |
| **Platform 2.0 E2E Lifecycle Smoke Test** | 11 | `100% PASS` | Full student checkout $\to$ webhook $\to$ priority KDS $\to$ QR pickup $\to$ shift PIN $\to$ TV projection. |
| **100-Order Peak Lunch Rush Simulator** | 100 | `100% PASS` | 100 parallel checkout requests with 0 dropped orders and 0 oversold units. |
| **Automated Staging DAST Security Harness** | 15 | `100% PASS` | 10 attack classes tested against live cloud function signatures (100% defended). |

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
| **Flutter Customer Web App** | `http://localhost:8080` | Google Sign-In / Student Login |
| **Staff Operations Hub** | `http://localhost:3000` | Workstation Shift PIN (`123456`) or Email |
| **Cafeteria 4K TV Board** | `http://localhost:3000/web_tv` | Zero-Auth (Public Read-Only) |

---

## 📄 License & Compliance

Thakur Bites Platform 2.0 is licensed under the MIT License for Thakur College of Engineering & Technology (TCET).
