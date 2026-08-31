# 📖 Thakur Bites — Enterprise Operational Runbook & SOPs

This document defines standard operating procedures (SOPs) for Canteen Managers, Cashiers, Kitchen Dispatch Staff, and IT/Security Administrators operating the **Thakur Bites** platform at Thakur College of Engineering & Technology (TCET).

---

## 📋 Table of Contents
1. [Daily Opening Procedure (07:30 IST)](#1-daily-opening-procedure-0730-ist)
2. [Kitchen Display System (KDS) Operations](#2-kitchen-display-system-kds-operations)
3. [Pickup Counter & Student Handover SOP](#3-pickup-counter--student-handover-sop)
4. [Counter Cash Settlement & Reconciliation](#4-counter-cash-settlement--reconciliation)
5. [Handling Failed Payments & Refund Disputes](#5-handling-failed-payments--refund-disputes)
6. [Security Lockout Resolution (3 Failed PINs)](#6-security-lockout-resolution-3-failed-pins)
7. [Disaster Recovery & Point-in-Time Restore](#7-disaster-recovery--point-in-time-restore)
8. [Daily Closing & Financial Reconciliation (18:30 IST)](#8-daily-closing--financial-reconciliation-1830-ist)

---

## 1. Daily Opening Procedure (07:30 IST)

1. **Staff Sign-in**:
   - Open **Staff Hub**: `http://localhost:8081` (or production URL).
   - Enter your authorized Staff PIN (`1234` for Kitchen, `5678` for Pickup, `9999` for Admin/Security).
2. **Menu Availability Check**:
   - Navigate to **📋 Menu & Stock**.
   - Verify all kitchen-cooked items (Dosa, Roti-Bhaji, Chai, Pao Bhaji) are toggled **Available**.
   - Input physical stock counts for packaged instant items (Wafers, Samosas, Drinks).
3. **Audio Alert Verification**:
   - Click the test sound button in Kitchen KDS to ensure speakers/tablets are unmuted for order dispatch chimes.

---

## 2. Kitchen Display System (KDS) Operations

- **New Orders Arrival**:
  - Automatically chime on the kitchen display tablet.
  - Orders display daily sequential token numbers (`TB-001`, `TB-002`, etc.) and preparation estimates.
- **Workflow State Transitions**:
  - `CONFIRMED` $\to$ Click **"Start Prep"** $\to$ `PREPARING`
  - `PREPARING` $\to$ When plated, click **"Mark Ready"** $\to$ `READY`
  - *Trigger*: Marking an order `READY` sends a push notification to the student's phone and chimes the Pickup Counter.

---

## 3. Pickup Counter & Student Handover SOP

1. **Dual Verification Protocol**:
   - **Method A (Primary - QR Code)**:
     - Scan the student's dynamic signed QR code from their mobile screen.
     - The system validates the cryptographic HMAC signature and matches the one-time `qrNonce`.
     - Order instantly transitions to `COLLECTED`.
   - **Method B (Secondary - 6-Digit PIN)**:
     - If the student's screen is cracked or battery is low, ask for their **6-digit alphanumeric PIN** and **Token Number**.
     - Enter the PIN into the Pickup Station pad.
     - Verification executes zero-knowledge SHA-256 hash matching against isolated `orderSecrets`.

---

## 4. Counter Cash Settlement & Reconciliation

- **Placing Counter Orders**:
  - If a student pays cash at the physical counter, the cashier selects **"Counter Cash"** payment method.
  - Order is placed in `payment_pending` status with `paymentMethod: counter_cash`.
- **Collecting Cash**:
  - Cashier accepts cash $\to$ clicks **"Record Cash Payment"** $\to$ transitions payment to `paid`.
  - Automatically posts ledger entry:
    - **Debit**: `CASH_ON_HAND`
    - **Credit**: `SALES_REVENUE`

---

## 5. Handling Failed Payments & Refund Disputes

1. **Auto-Expiry Release**:
   - If an online payment fails or is abandoned, the 15-minute temporary inventory reservation lock automatically expires and restores stock without manager intervention.
2. **Partial / Full Refunds**:
   - If food cannot be prepared due to equipment failure:
     - Manager opens **🛡️ Security Center** $\to$ **Disburse Refund**.
     - Input Order ID, Refund Amount in Rupees, and Authoritative Reason.
     - System mathematically enforces: $\text{amountRefundedPaise} + \text{requestedPaise} \le \text{amountPaidPaise}$.
     - Reversal is posted automatically in double-entry financial ledger.

---

## 6. Security Lockout Resolution (3 Failed PINs)

- **Scenario**: An attacker or confused student enters the wrong PIN 3 times.
- **Sentinel Action**: System automatically locks the order for investigation (`isLockedForInvestigation: true`) and fires a security event audit log.
- **Manager Override**:
  1. Student presents college ID card to Canteen Manager.
  2. Manager verifies Student Roll Number & TCET Email.
  3. Manager navigates to **🛡️ Security Center** $\to$ **Unlock Order**.
  4. Enters Order ID and physical verification note.
  5. Failed attempt counter resets to 0.

---

## 7. Disaster Recovery & Point-in-Time Restore

1. **Generating Timestamped Backup**:
   ```bash
   node functions/scripts/backup_restore.js
   ```
   Generates a cryptographically signed SHA-256 JSON manifest containing all 16 collections.

2. **Validating Backup Integrity**:
   - Runs timing-safe SHA-256 checksum comparison before restoring any data.
   - Prevents corrupted or tampered JSON backups from ever touching Firestore.

---

## 8. Daily Closing & Financial Reconciliation (18:30 IST)

1. **Run Daily Reconciliation Function**:
   - Manager navigates to **📊 Operations Analytics**.
   - Click **"Generate Daily Settlement Summary"**.
   - System computes:
     - Total Gross Revenue
     - Digital (`GATEWAY_RECEIVABLE`) vs Physical Cash (`CASH_ON_HAND`)
     - Total Refunds Disbursed
     - Net Settlement Recognized
2. **Lock Operational Day**:
   - Canteen POS day is closed in Asia/Kolkata timezone.
   - Token counter resets to `TB-001` for the next morning.
