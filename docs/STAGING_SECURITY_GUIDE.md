# 🛡️ Thakur Bites Platform 2.0 — Staging Dynamic Security Testing (DAST) Guide

This guide details the operational procedures, security test cases, and automated attack scripts to execute against the **Staging Environment** before promoting to production.

---

## 🎯 Testing Philosophy: Authorization Boundary Defense

> **The Target:**
> Security scanners and automated attack payloads *will* reach the application endpoints.
> The platform is secure when attacks cannot bypass authentication, cross role boundaries, corrupt inventory/financial ledgers, or cause unauthorized business impact.

---

## 📋 Staging Pre-Requisite Seed Data

Before running DAST suites against staging, seed the staging project (`adi-thakur-bite-staging`):

```bash
# Seed realistic students, faculty, visitors, and workstation shift PINs (PIN: 123456)
node scripts/seed_demo_data.js
```

### Staging Identities Configured:
1. **Visitor Account**: `guest.visitor@gmail.com` (Unverified external, Priority Level 0)
2. **Student Account**: `2024101@tcetmumbai.in` (Verified TCET Student, Priority Level 1)
3. **Faculty Account**: `faculty.hod@thakureducation.org` (Verified Faculty, Priority Level 2)
4. **Kitchen Operator**: `kitchen.station1@tcetmumbai.in` (Role: `kitchen`)
5. **Pickup Staff**: `counter.dispatch@tcetmumbai.in` (Role: `pickup`)
6. **Cashier Operator**: `cashier.counter@tcetmumbai.in` (Role: `cashier`)
7. **Campus Manager**: `canteen.manager@tcetmumbai.in` (Role: `manager`)
8. **Security Admin**: `security.officer@tcetmumbai.in` (Role: `security_admin`)

---

## 🧪 Categorical DAST Test Scenarios

### 1. 🔑 Authentication & Identity Boundaries

| Test ID | Attack Scenario | Expected Behavior |
|:---|:---|:---|
| **DAST-AUTH-01** | Expired Firebase Auth JWT passed to `createCheckout` | ❌ Rejected: `unauthenticated` (HTTP 401) |
| **DAST-AUTH-02** | Tampered JWT with modified `role: admin` | ❌ Rejected: Cryptographic signature mismatch |
| **DAST-AUTH-03** | Unverified `@tcetmumbai.in` student token | ❌ Rejected: `UNVERIFIED_INSTITUTIONAL_EMAIL` |
| **DAST-AUTH-04** | Visitor `@gmail.com` calling `createCheckout` | ✅ Permitted: Assigned `accountType: VISITOR`, `priorityLevel: 0` |
| **DAST-AUTH-05** | Student attempting direct `accountType: TEACHER` write | ❌ Rejected: Stripped by backend sanitizer and locked by Firestore rules |

---

### 2. 🛡️ Authorization & IDOR Boundaries

| Test ID | Attack Scenario | Expected Behavior |
|:---|:---|:---|
| **DAST-AUTHZ-01** | Student A reading Student B's order `/orders/ord_B` | ❌ Rejected: Firestore rules evaluate `isOwner(studentId) == false` |
| **DAST-AUTHZ-02** | Cashier reading double-entry ledgers `/financialTransactions` | ❌ Rejected: Firestore rules restrict to `isManagerOrAdmin()` |
| **DAST-AUTHZ-03** | Kitchen staff reading student profiles `/users/userId` | ❌ Rejected: Firestore rules restrict to owner or managers |
| **DAST-AUTHZ-04** | Student calling `assignStaffRole` | ❌ Rejected: `permission-denied`, security incident logged |
| **DAST-AUTHZ-05** | Admin attempting to promote another user to `security_admin` | ❌ Rejected: Separation of duties requires caller to be `security_admin` |

---

### 3. 📦 Inventory & Financial Invariant Boundaries

| Test ID | Attack Scenario | Expected Behavior |
|:---|:---|:---|
| **DAST-INV-01** | Negative quantity in cart: `quantity: -5` | ❌ Rejected: Schema bounds check `quantity >= 1` |
| **DAST-INV-02** | Integer overflow quantity: `quantity: 10000` | ❌ Rejected: Maximum item cap $\le 50$ |
| **DAST-INV-03** | Concurrent checkout race: 100 buyers for 10 units | ⚖️ Exactly 10 succeed, 90 rejected with `insufficient-stock` |
| **DAST-INV-04** | Client tampered unit price: ₹120 $\to$ ₹1 | ❌ Ignored: Server re-fetches authoritative catalog prices |
| **DAST-FIN-01** | Fake webhook signature on payment finalization | ❌ Rejected: HMAC SHA-256 raw buffer verification fails |
| **DAST-FIN-02** | Double payment finalization (Replay Attack) | 🛡️ Idempotent: Subsequent calls return cached payment result |

---

### 4. 📟 Pickup State Machine & Workstation Security

| Test ID | Attack Scenario | Expected Behavior |
|:---|:---|:---|
| **DAST-PKP-01** | Generic `updateOrderStatus(orderId, 'collected')` | ❌ Rejected: `ready -> collected` removed from generic updater |
| **DAST-PKP-02** | Replay scanned QR token a second time | ❌ Rejected: `REPLAY_DETECTED` (order is already `COLLECTED`) |
| **DAST-PKP-03** | Brute force 4-digit pickup PIN (5 rapid wrong guesses) | 🔒 Locked: Order flagged for physical manager verification |
| **DAST-PKP-04** | Workstation Shift PIN login with mismatched device ID | ❌ Rejected: Hardware fingerprint mismatch |

---

## 🚀 Running Automated DAST Attack Scripts

```bash
# 1. Execute full local verification gates
bash scripts/run_all_security_checks.sh

# 2. Run High-Concurrency Concurrency Stress Simulator
node scripts/simulate_lunch_rush.js

# 3. Verify Cryptographic Ledger & Backup Integrity
node functions/scripts/verify_backup_restore.js
```

---

## 📊 Post-Staging DAST Promotion Checklist

- [x] All 210 Unit & Invariant Tests Passing (100% Green)
- [x] Leaked Secret Scan Clean (0 secrets detected)
- [x] Custom SAST Guardrails Clean (3/3 rules passed)
- [x] Zero High/Critical Dependency Vulnerabilities
- [x] Storage Security Rules Configured (`storage.rules`)
- [x] Firestore Rules Lockdown Verified
- [x] HTTP Security Headers Configured (CSP, HSTS, X-Frame-Options)
- [x] Single Document TV Ephemeral Projection Verified (`publicLiveQueue/current`)
