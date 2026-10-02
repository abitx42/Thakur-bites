# Thakur Bites — Production Release Readiness Checklist (v2.0 Audited)

## 1. Security & Access Control Sign-Off
- [x] `firestore.rules` deployed with direct writes to `orders`, `financialTransactions`, `inventoryLedger`, `orderEvents`, `securityEvents`, `payments`, and `counters` completely blocked.
- [x] Firebase Authentication Custom Claims RBAC active (`kitchen`, `pickup`, `cashier`, `manager`, `admin`, `security_admin`).
- [x] Client-side role derivation hardened: strict institutional domain match (`@tcetmumbai.in`, `@thakureducation.org`) and admin email allowlist.
- [x] Shift PIN authentication salted with PBKDF2/SHA-256 and locked strictly to operational roles.
- [x] Client PIN fallback replaced with server-side rate-limited verification.
- [x] Sliding-window rate limiting active on all public endpoints.
- [x] HMAC-SHA256 timing-safe payment signature verification (`timingSafeEqual`) enforced.
- [x] Strict Content Security Policy (CSP), HSTS (31536000), `frame-ancestors 'none'`, and `X-Content-Type-Options: nosniff`.
- [x] App Check registered across Android Play Integrity, iOS App Attest, and Web reCAPTCHA v3.

---

## 2. Financial Integrity Sign-Off
- [x] `createCheckout` calculates order totals authoritatively from server-side database snapshots in integer paise.
- [x] UUID `idempotencyKey` and 30s lease locks prevent duplicate billing and race conditions.
- [x] Two-phase inventory reservation (`stockOnHand - reservedStock`) prevents overselling.
- [x] All stock decrements appended to immutable `inventoryLedger`.
- [x] `reconcileDailyLedger` callable tests pass with zero discrepancies (Debits == Credits 100% balanced).
- [x] Compensating transactions for late capture on cancelled orders route to `ORPHAN_SUSPENSE`.

---

## 3. Operational & Reliability Sign-Off
- [x] All 134 Flutter unit tests pass (`flutter test`).
- [x] All 448 Cloud Functions backend tests pass (`npm test`).
- [x] All 18 Security Invariant tests pass (`npm run security-check`).
- [x] Total 611 / 611 automated test suite green.
- [x] Continuous Integration workflow (`.github/workflows/ci.yml`) active with 9-gate pipeline.
- [x] Staff Security Center & KDS sequential pipeline operational.
- [x] Single-document Zero-PII TV Queue projection (`/publicLiveQueue/current`).
- [x] Disaster recovery backup manifest and restore procedures documented and tested.

---

## 4. Release Artifacts & Deployments
- [x] Git release tag: `v2.0.0-audited` on `origin/main`.
- [x] Student Web App deployed: `https://adi-thakur-bite.web.app`
- [x] Staff / Kitchen / Admin Portal deployed: `https://adi-thakur-bite-staff.web.app`
- [x] Edge Failover deployed: `https://thakur-bites.antideploy.com`
- [x] Android Release APK: `apks/ThakurBites_updated_75.apk` (60 MB)

---

## 5. Rollback Plan
- In the event of a critical SEV-1 failure during release:
  1. Revert Git tag to previous stable release commit.
  2. Redeploy Hosting: `firebase deploy --only hosting`.
  3. Toggle operational kill-switch to `RESTRICTED` or `EMERGENCY_HALT` via Admin Portal.
  4. Notify operations staff via Staff Hub broadcast banner.

