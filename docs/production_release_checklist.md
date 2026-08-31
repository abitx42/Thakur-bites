# Thakur Bites — Production Release Readiness Checklist

## 1. Security & Access Control Sign-Off
- [x] `firestore.rules` deployed with direct writes to `orders`, `inventoryLedger`, `orderEvents`, `securityEvents`, `payments`, and `counters` completely blocked (`allow write: if false`).
- [x] Firebase Authentication Custom Claims RBAC active (`kitchen`, `pickup`, `manager`, `admin`, `security_admin`).
- [x] Client PIN fallback replaced with server-side rate-limited verification.
- [x] Sliding-window rate limiting active on all public endpoints.
- [x] HMAC-SHA256 timing-safe payment signature verification enforced.

---

## 2. Financial Integrity Sign-Off
- [x] `createCheckout` calculates order totals authoritatively from server-side database snapshots.
- [x] UUID `idempotencyKey` prevents duplicate billing and order creation on retry.
- [x] All stock decrements appended to immutable `inventoryLedger`.
- [x] `reconcileDailyLedger` callable tests pass with zero discrepancies.

---

## 3. Operational & Reliability Sign-Off
- [x] All 20 Flutter unit tests pass (`flutter test`).
- [x] All 18 Cloud Functions backend tests pass (`npm test`).
- [x] Continuous Integration workflow (`.github/workflows/ci.yml`) active on all branches.
- [x] Staff Security Center live stream operational.
- [x] Disaster recovery backup manifest and restore procedures documented and tested.

---

## 4. Rollback Plan
- In the event of a critical SEV-1 failure during release:
  1. Revert Git tag to previous stable release commit.
  2. Redeploy Cloud Functions: `firebase deploy --only functions`.
  3. Notify operations staff via Staff Hub banner.
