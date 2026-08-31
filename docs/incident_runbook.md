# Thakur Bites — Operational Security & Incident Response Runbook

## 1. Incident Severity Classification Matrix

| Severity | Definition | Target Response SLA | Escalation Target |
|---|---|---|---|
| **SEV-1 (Critical)** | Core outage, financial discrepancy, payment gateway mismatch, unauthorized role escalation, or database integrity breach. | **< 15 minutes** | Lead Engineer, Principal Security Admin, Canteen Director |
| **SEV-2 (High)** | Peak hour checkout failure, repeated rate-limit anomalies (> 50 events/min), single station KDS disruption. | **< 30 minutes** | Backend Engineer, Canteen Manager |
| **SEV-3 (Medium)** | Slow Firestore synchronization, single student authentication failure, minor UI formatting bug. | **< 2 hours** | On-Call Staff Support |
| **SEV-4 (Low)** | Non-blocking telemetry warning, feature request, cosmetic UI anomaly. | **< 24 hours** | General Backlog |

---

## 2. Emergency Containment & Triage Playbooks

### Playbook A: Financial or Payment Signature Anomaly (`PAYMENT_SIGNATURE_MISMATCH`)
1. **Immediate Action**:
   - Check the **Security Center** (`http://localhost:8081` ➔ Security Center) for the affected `orderId` and `actorUid`.
   - Inspect transaction status on the Payment Provider Dashboard.
2. **Containment**:
   - If spoofing is suspected, deactivate the suspect student account (`accountDisabled = true`).
   - If gateway secret is compromised, rotate `PAYMENT_GATEWAY_SECRET` immediately in Firebase Environment Secrets.
3. **Recovery**:
   - Trigger `reconcileDailyLedger` callable to audit all settlements for the date.

### Playbook B: Heavy Checkout Flooding / DoS (`RATE_LIMIT_EXCEEDED`)
1. **Automated Defense**:
   - Adaptive sliding window rate-limiter automatically throttles clients to 10 checkouts / 60 seconds.
2. **Manual Intervention**:
   - Verify if traffic is genuine campus rush (e.g. 1:00 PM lunch break) or malicious script.
   - If genuine rush, adjust `ENDPOINT_LIMITS.checkout.maxRequests` in `functions/src/rate_limiter.ts`.

### Playbook C: Pickup Verification Replay / Unauthorized Handover
1. **Inspection**:
   - Locate `orderEvents` and `securityEvents` records for the `orderId`.
   - Cross-check `collectedByStaffId` and `verificationMethod`.
2. **Resolution**:
   - If an order was marked collected by mistake, review kitchen KDS history and issue a restock or refund.

---

## 3. Post-Incident Review (PIR) Template
- **Incident Summary**: Date, Duration, Impacted Users/Orders.
- **Root Cause Analysis (5 Whys)**: Underlying failure mechanism.
- **Timeline**: Exact chronological sequence of detection, containment, and recovery.
- **Action Items**: Preventative architectural changes, test cases added to CI pipeline.
