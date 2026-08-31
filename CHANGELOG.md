# 📋 Thakur Bites Platform 2.0 — Changelog & Release Notes

## [v2.0.0-hardened] — 2026-09-01

### 🛡️ Platform Hardening & Security Boundary Reconciliation
- **TV Single Ephemeral Projection**: Reconciled TV architecture to subscribe strictly to single public document `publicLiveQueue/current`.
- **Public TV Social Equality**: Removed public priority crowns/stars to prevent cafeteria social friction.
- **Fail-Closed TV ETAs**: Removed fake `6m` default; displays `"Est. Pending"` when ETA is null.
- **Firestore Security Rules**: Restricted `/publicLiveQueue` strictly to document `current`. Denied arbitrary collection enumeration.
- **Automated Secret Scanner**: Added `scripts/scan_secrets.js` to scan for leaked private keys, service account JSON files, and database passwords.
- **SAST Static Analysis Code Analyzer**: Added `scripts/sast_analyzer.js` checking for OWASP injection patterns, `eval()`, and insecure random generation.
- **CSPRNG PIN Fix**: Hardened PIN generation in `js/state.js` with `window.crypto.getRandomValues`.
- **Dedicated Firestore Rules & Escalation Test Suite**: Added Tests 136–142 in `security_abuse.test.js` validating rules enforcement, visitor privacy boundaries, and faculty verification forgery defense.
- **Categorized Invariant Report**: Master CI runner now outputs a 9-domain categorical security report (197 tests 100% green).

---

## [v2.0.0] — 2026-09-01

### 🧑‍🎓 Phase 1: Universal Identity & Account System
- Added `identity_classifier.ts` classifying TCET student emails (`@tcetmumbai.in`), visitor emails, and faculty emails (`@thakureducation.org`).
- Added universal `provisionUserProfile` Cloud Function.
- Added 3-tab Google Sign-In bottom sheet in Flutter app.

### 📱 Phase 2: Profile, Order History, Favourites & Reorder
- Added authoritative `reorderPreviousOrder` Cloud Function with live price recalculation and instant stock boundary checks.
- Added Flutter `FavouritesScreen` with quick reorder cards.
- Added Flutter `PreferencesScreen` with dietary preferences and push notification toggles.
- Added optimistic heart toggles on menu catalog cards.

### 🏢 Phase 3: Teacher & College Staff Verification
- Added `submitVerificationApplication` and `reviewVerificationApplication` Cloud Functions.
- Implemented in-place faculty role elevation on the same UID without account duplication.
- Added Flutter `VerificationScreen` for ID proof submissions.
- Added Staff Operations Hub admin verification approval panel.

### ⚡️ Phase 4: Anti-Starvation Priority Queue Scheduling
- Added dynamic Effective Priority Score formula: $P_{\text{eff}} = P_{\text{base}} + (\text{WaitMinutes} \times 5)$.
- Added anti-starvation aging (+5 pts/min) allowing waiting student tickets to catch up to faculty tickets after 20 minutes.
- Added active faculty priority quota limit (max 1 concurrent priority ticket).
- Added Kitchen KDS priority sorting and ⭐️ gold faculty badges.

### 🔑 Phase 5: Staff Hub Shift PINs & Workstation Hardware Binding
- Added CSPRNG 6-digit shift PIN generation with salted SHA-256 hash storage.
- Implemented workstation hardware device binding (`tb_workstation_device_id`).
- Implemented 5-strike brute-force lockout (15 min lock).
- Added Fast Shift PIN Keypad in 3-tab Staff Operations modal.

### 📺 Phase 6: Standalone 4K TV Display Web App
- Created standalone `web_tv/` web application with 3 resilient stream states.
- Implemented Web Audio API synthesized two-tone order ready chime (800Hz $\to$ 1060Hz).
- Added `web_tv/manifest.json` for smart TV kiosk full-screen mode.

### 📊 Phase 7: Owner Executive Console Dashboard
- Added `getOwnerBusinessMetrics` and `updateOwnerFeatureFlags` Cloud Functions.
- Implemented real-time gross revenue, Digital UPI vs Cash Counter split, and AOV metrics.
- Added predictive inventory stockout run-rate calculator ($\text{burnRate} = \frac{\text{unitsSold}}{\text{hoursElapsed}}$) with red urgent restock badges.
- Added campus control switches for Mobile Ordering, Faculty Priority, Cash Counter, and Rush ETA multipliers.

### 🛡️ Phase 8: Developer Command Cockpit
- Added `getDeveloperTelemetry` and `simulatePermissionCheck` Cloud Functions.
- Added interactive RBAC Permission Matrix simulator in `securityCenterView.js`.
- Added 1-Click 15-Point Invariant Integrity Scanner.

---

## 🧪 Test Matrix Summary
- **166** Backend Invariant & Security Abuse Tests
- **31** Flutter Client Unit & Widget Tests
- **197** Total Automated Tests Passing (100% Green)
- **Zero** Leaked Secrets (167 files scanned)
- **Zero** SAST Code Violations (130 files analyzed)
- **Zero** High/Critical Dependency Vulnerabilities
