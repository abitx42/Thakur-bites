# Production Secrets & Zero-Downtime Key Rotation Governance

**Project**: Thakur Bites (`adi-thakur-bite`)  
**Target Environment**: Staging & Production  
**Document Version**: 1.0.0 (Phase 9 Release)  
**Classification**: TCET Infrastructure Operational Governance — Restricted

---

## 1. Authoritative Secrets Inventory & Google Secret Manager Mapping

All production secrets for Thakur Bites are provisioned in **Google Cloud Secret Manager (GSM)** in region `asia-south1` (Mumbai).  
**Zero hardcoded secrets, fallback API keys, or plaintext secrets are permitted in source control or client bundles.**

| GSM Secret Resource ID | Environment | Description | Rotation Cadence | Zero-Downtime Strategy |
|---|---|---|---|---|
| `PAYMENT_GATEWAY_KEY_ID` | Prod | Public Key ID for Razorpay Gateway (`rzp_live_...`) | 90 Days | Dual-Key Overlap via Remote Config |
| `PAYMENT_GATEWAY_SECRET` | Prod | HMAC-SHA256 signature secret for order capture | 90 Days | Multi-version secret fallback |
| `RAZORPAY_WEBHOOK_SECRET` | Prod | Secret used to verify incoming webhook payloads | 90 Days | Dual webhook secret verification |
| `MFA_ADMIN_SECRET` | Prod | Base32 seed for privileged Admin TOTP MFA | 180 Days | Step-up re-enrollment flow |
| `BREAK_GLASS_RECOVERY_KEY` | Prod | Cryptographic challenge secret for emergency DR | 30 Days | Four-eyes step-up invalidation |
| `APP_CHECK_DEBUG_TOKEN` | Dev/Staging | Firebase App Check token for automated test runs | Per Sprint | Isolated strictly to non-prod |

---

## 2. Zero-Downtime Dual-Key Rotation Procedure (Payment Gateway)

Rotating payment credentials in a live college dining environment must prevent transaction disruption for students actively checking out. Razorpay supports active primary and secondary API keys concurrently.

### Step 1: Generate Secondary Key in Razorpay Dashboard
1. Log into Razorpay Dashboard (`https://dashboard.razorpay.com`) using institutional hardware MFA.
2. Navigate to **Settings** $\to$ **API Keys**.
3. Click **Generate Secondary Key**.
4. Razorpay displays `KEY_ID_NEW` and `KEY_SECRET_NEW`. Copy securely into memory.
   > ⚠️ **DO NOT** click "Revoke Old Key" at this stage. Both keys remain valid during the transition window.

### Step 2: Add Secret Versions in Google Cloud Secret Manager
```bash
# Add new version for PAYMENT_GATEWAY_KEY_ID
echo -n "rzp_live_NEW_KEY_ID" | gcloud secrets versions add PAYMENT_GATEWAY_KEY_ID \
  --project=adi-thakur-bite \
  --data-file=-

# Add new version for PAYMENT_GATEWAY_SECRET
echo -n "NEW_SECRET_STRING" | gcloud secrets versions add PAYMENT_GATEWAY_SECRET \
  --project=adi-thakur-bite \
  --data-file=-
```

### Step 3: Deploy Cloud Functions with Secret Pinning
Redeploy Cloud Functions to mount the latest version of Secret Manager payloads:
```bash
firebase deploy --only functions --project=adi-thakur-bite
```
Verify Cloud Functions cold-start health:
```bash
gcloud functions logs read --limit 20 --project=adi-thakur-bite
```

### Step 4: Client App Dynamic Key Refresh (Remote Config)
1. Update Firebase Remote Config key `razorpay_key_id` to `rzp_live_NEW_KEY_ID`.
2. Publish Remote Config changes.
3. Mobile clients running Thakur Bites automatically fetch the new Key ID within 5 minutes without requiring app re-installation.

### Step 5: Webhook Dual-Secret Verification
During rotation, Razorpay webhooks may still be signed with the previous webhook secret for in-flight transactions.
The Cloud Function `handlePaymentWebhook` verifies incoming signatures against both `latest` and `latest-1` secret versions before rejecting payloads.

### Step 6: 24-Hour Observation & Final Revocation
1. Monitor operational metrics via Google Cloud Monitoring:
   - Metric: `cloudfunctions.googleapis.com/function/execution_count`
   - Filter: `INVALID_WEBHOOK_SIGNATURE == 0`
   - Filter: `PAYMENT_AMOUNT_TAMPERING_FLAGGED == 0`
2. After 24 hours of zero transactions on the old key, return to the Razorpay Dashboard.
3. Click **Revoke Primary Key**. The new key automatically becomes the active Primary Key.
4. Destroy deprecated secret versions in Secret Manager:
```bash
gcloud secrets versions destroy PAYMENT_GATEWAY_KEY_ID --version=1 --project=adi-thakur-bite
gcloud secrets versions destroy PAYMENT_GATEWAY_SECRET --version=1 --project=adi-thakur-bite
```

---

## 3. Emergency Break-Glass Credential Rotation Runbook

In the event of an operational anomaly, staff role compromise, or routine 30-day rotation, the emergency break-glass credentials must be rotated immediately using the Four-Eyes principle.

### Step 1: Invalidate Outstanding Recovery Challenges
Execute authoritative Cloud Function command to terminate any pending break-glass tokens:
```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'adi-thakur-bite' });
const db = admin.firestore();
db.collection('systemConfig').doc('breakGlassChallenge').set({
  activeTokenHash: null,
  invalidatedAt: admin.firestore.Timestamp.now(),
  invalidationReason: 'SCHEDULED_OR_EMERGENCY_ROTATION'
}, { merge: true }).then(() => console.log('✅ Outstanding break-glass tokens invalidated.'));
"
```

### Step 2: Generate Cryptographically Secure Entropy
```bash
NEW_BREAK_GLASS_KEY=$(openssl rand -hex 32)
echo -n "$NEW_BREAK_GLASS_KEY" | gcloud secrets versions add BREAK_GLASS_RECOVERY_KEY \
  --project=adi-thakur-bite \
  --data-file=-
```

### Step 3: Four-Eyes Verification
1. **Requester (DevOps Lead)** initiates rotation and logs commit hash.
2. **Approver (Head of Canteen / IT Dean)** signs off via Firebase Security Console.
3. Audit record is automatically written to `/disasterRecoveryLogs` with `crypto.randomUUID()`.

---

## 4. Disaster Drill & Verification Checklist

Before opening the canteen during morning prep (07:30 IST), the on-duty manager runs:
- [ ] `node scripts/seed_environment.js --env=production --dry-run` confirms production flags are active.
- [ ] `./scripts/run_all_security_checks.sh` validates all 9 security gates pass 100%.
- [ ] Razorpay webhook endpoint responds `200 OK` on health probe.
- [ ] Cloud Function error rate $< 0.1\%$ over the trailing 60 minutes.
