# Security and reliability repair — 2026-10-17

## Scope and outcome

Reviewed the trusted order/payment/pickup boundaries, staff authentication and authorization, browser/Flutter callers, deployed client rules, HTTP serving, and clean Linux setup/packaging. Implemented the concrete defects below and added regression coverage. This is **not** an exhaustive penetration-test certificate or proof that every repository feature is bug-free.

Initial backend baseline: **446 passed, 2 failed**. The failures were host-timezone-dependent campus schedule fixtures; they now use explicit IST dates. Existing unrelated edits to the kitchen toast and in-app notification overlay were preserved and were not included in these repair commits.

## Findings repaired

| Finding | Change and evidence |
| --- | --- |
| Institutional emails/workstation flags could grant administrative Firestore access | Canonical rules now use server-owned roles/current role consistency, validated workstation generations and live PIN/hardware binding. Actual Firestore rules emulator tests cover forged roles, stale/demoted claims and revoked/expired hardware/PIN/session variants. |
| Client writes bypassed authoritative menu, order, stock, payment, verification and role handlers | Rules deny direct authoritative mutations; browser and Flutter fallbacks were removed. Real service/UI regressions verify rejected callables cannot become local success. Bounded daily-board and customer preference edits remain supported. |
| Emergency operational-mode callable elevated email/profile/workstation hints to manager/admin | Removed every such fallback. Current enabled Auth authority, exact signed role/UID binding and revocation timing are required; tests execute the actual callable, including legitimate manager transitions and separation of duties. |
| Ordinary staff and privileged/workstation sessions could retain stale authority | Added current Auth checks on operational guards, sensitive mutations and workstation administration. Privileged sessions require current roles/MFA/valid timestamps; virtual stations require current generation, PIN issuance and enrolled hardware. Lookup failures deny. |
| Profile provisioning trusted a privileged token role for a non-Google provider exception | `provisionUserProfile` now revalidates current enabled Auth authority before using that exception. A real compiled-handler regression rejects a demoted account before any profile/claims writes. |
| Shift PIN failure updates were rolled back by throwing inside their transaction | Commit the failure result first, deny afterward, and never issue a session/token. Twelve actual-handler tests include transaction retries, threshold lockout, issuance replacement and commit failures. |
| MFA TOTP/recovery credentials could be replayed concurrently | Credential validation, single-use consumption and privileged-session creation now share one Firestore transaction. Concurrent identical TOTP and recovery-code requests produce one session and one rejection; recovery-code telemetry is redacted. |
| Pickup could bypass credentials, payment/readiness checks, or lose lockout updates | Require canonical capability, actual PIN/signed QR, captured payment and permitted fulfillment state. Failed attempts commit before denial; locking revokes QR. Isolated nonce/expiry/consumption checks prevent replay. The UI no longer directly collects or offers credential-free handover. |
| Gateway fetch/capture errors could be ignored | Require exact captured payment/order ID, integer paise, currency and ownership before settlement. Errors, malformed responses and mismatches leave no successful capture ledger. Cash/webhook flows have independent trusted authority. |
| Payment sessions fabricated/recreated gateway identities or raced external creation | Checkout no longer invents gateway IDs. An atomic nonce claim serializes creation; only an exact provider response creates an immutable binding. Lost acknowledgements reuse proven results; uncertain results are held for reconciliation, not blind retry. A real emulator test executes checkout through session creation and replay. |
| Refund retries could repeat a gateway operation or corrupt accounting | Bind actor/order/amount/idempotency, reserve funds atomically, verify durable provider results and reconcile uncertain outcomes. Same/different-key concurrent attempts cannot disburse reserved funds twice; confirmed settlement replay checks reservation and ledger identity. |
| Session cancellation could touch paid/refunded/terminal orders or another order's priority lock | Restrict to unpaid pending online sessions, validate input and current non-owner staff authority, release inventory exactly once, and delete only the matching faculty lock. Actual handler regressions cover concurrent retries and every rejected state. |
| Payment polling inferred paid state from arbitrary ledger entries | Polling is now read-only. It preserves recorded refund/payment state and cannot turn a refund, corrupt ledger or stale cancellation snapshot into paid authority. Legacy inconsistencies require trusted reconciliation. |
| Optional public queue projection failures reported committed operations as failed | Checkout, capture and pickup preserve successful authority after commit even if projection refresh fails. Real checkout emulator coverage verifies the original one-time PIN is still delivered. |
| Runtime misclassification, placeholder secrets and attestation bypasses | Fixed project-ID precedence and string-boolean simulation handling. Removed source credential defaults/aliases; production requires dedicated secrets and verified App Check for every role. Staff App Check initializes before client services; emulator routing is explicit loopback-only. |
| Static serving/deployment exposed repository content or crashed on malformed requests | Node allowlists public assets, rejects malformed paths/symlinks/private files and supports only GET/HEAD. Python launches this server rather than exposing the repository. Hosting publishes only rebuilt `dist/site`; staging preserves the old bundle on invalid input and rejects symlinked parents. |
| Storage deletion/overwrite rules were incorrect and stale staff claims remained usable | Separate validated upload/update from admin deletion. Proof owners cannot overwrite submitted evidence, including Storage API uploads evaluated as create. Administrative Storage writes now bind the token role to the server-owned `staffUsers` role. MIME/size limits also apply to replacements and metadata updates. Real Storage emulator tests cover permissions, stale-role denial and bounds. |
| Browser administrative fallbacks could bypass server authority; dynamic operational data was not uniformly escaped | Removed direct Firestore fallbacks for operational-mode changes and faculty verification from the admin/security views. Added HTML escaping and bounded quantity rendering for workstation/MFA/AI/analytics/pickup/cashier/TV values, with static client-boundary regressions. |
| Deployment/test scripts were nonreproducible or falsely green | Pinned local tooling/lockfiles, Java 21, Docker/Makefile, explicit project/site selection, real check invocations and bounded packaging/deployment. Removed fabricated test-count fallbacks, masked failures, broad repository archives and home-directory credential reads. Script/CI tests use local stubs, not real providers. |

Unsupported user-directory disable/priority/self-master mutations are now disabled with an explanation rather than unsafe direct database writes. Replacing these with additional governed backend features is separate work.

## Observed verification

All checks below were actually run after the relevant source changes; none is inferred from a badge or simulated role review.

| Check | Observed result |
| --- | --- |
| `make setup` on Linux aarch64 | Passed: both `npm ci` installs, exact Flutter revision, locked Pub restore and emulator downloads; project-local caches |
| `make test` | **106/106 root runtime/script tests + 841/841 backend/client-boundary tests**, 0 failed/skipped; TypeScript build passed |
| Offline transport regressions | External DNS callbacks/promises, direct TCP and HTTPS blocked by the test preload; real HTTP loopback fixtures still pass |
| `npm run test:flutter` | Analyzer: **No issues found**; actual Flutter unit/widget suite: **139/139 passed** |
| `npm run test:rules` with Java 21 | **100/100 passed**, 0 skipped, using real Firestore and Storage emulators; includes real transaction concurrency, checkout/session integration and stale Storage-role denial |
| `bash scripts/run_all_security_checks.sh` | Passed scans, offline regressions, Flutter, real emulators and both npm audits |
| Source/history secret scanner | No matches for its configured patterns; scanned 497 source files and 283 commits at this checkpoint |
| Custom SAST | Six configured guardrails passed; 325 executable source files at this checkpoint |
| Root and Functions npm audits | **0 known advisories** in each installed locked tree |
| `npm run build:web` | Release compiled successfully, `✓ Built build/web`, allowlisted `dist/site` staged |
| Actual rebuilt-site HTTP smoke | **6/6 passed**: customer/staff/bundle/config served; private env/backend paths returned 404 |
| Actual package-only command | Produced `dist/packages/thakur-bites-runtime.tar.gz` without credentials, uploads or deployment; reproducibility/private-path rejection also covered by automated fixtures |
| Shell syntax and `git diff --check` | Passed |

The web build intentionally had **no configured public App Check site key** and is for inspection, not authenticated production readiness. Scanner counts refer to the checkpoint above; reports and later documentation commits can increase them. A scanner finding zero configured-pattern matches is not proof that no secrets or security defects exist anywhere.

## Remaining limits and deployment blockers

1. **Container verification is blocked here.** There is no Docker executable/daemon. `unshare --net` was also denied by the sandbox. Native Node tests did pass with the external-network preload, but neither a clean Docker build nor `docker run --network none` is claimed. Run the documented `checks` image on a Docker-capable Linux host before relying on container reproducibility.
2. **No live service was deployed or provider-certified.** Firebase IAM/index deployment, real Google login, reCAPTCHA/Play Integrity/App Attest, Razorpay capture/refund/webhook delivery, Antideploy and GitHub Actions were not exercised with actual accounts. Script tests use synthetic local stubs; emulator payment creation uses explicit isolated simulation. Physical Android/iOS/device/browser end-to-end checks remain required.
3. **Secure production configuration is required.** Register actual web domains, provide the public App Check key, provision/bind the four exact backend secret names, keep simulation off, and verify the selected project/Hosting sites. Backend production enforcement cannot be bypassed by the keyless inspection build.
4. **Legacy data/credentials need controlled migration.** Rotate the retired QR signing default; old public-order-only pickup credentials and unproven gateway placeholders fail closed. Reauthenticate staff on enrolled hardware with fresh claims and current sessions. Do not restore an old privileged/workstation session or manually mark an order paid to bypass the new guards.
5. **Unknown financial outcomes remain reserved.** A timed-out gateway operation can have succeeded remotely. Reconcile against trusted provider records and the immutable ledger before any retry/release. The repair prevents blind repeated disbursement; it does not automate every historical/manual recovery case.
6. **Not every endpoint is a fresh-authority gate.** The repaired mutation/operational/workstation boundaries validate current Auth state; legacy read-only analytics/inspection endpoints were not comprehensively migrated and can retain normal signed-ID-token validity until refresh/expiry. Do not interpret this review as universal instantaneous account revocation across all Firebase services.
7. **Test scope is mixed.** Many retained tests are source assertions or duplicate business models. New actual-module mocks prove the exercised branches, not every Firebase/gateway SDK behavior. Real emulator tests provide additional rules/transaction evidence; the 139 Flutter tests do not constitute complete authenticated UI automation or release-device certification.

## Safe rollout and follow-up

- Follow the exact setup/build/test/deploy commands in `README.md`. Existing historical production-signoff/audit documents are not evidence for this repaired build.
- Validate the Docker `checks` image and its offline run on an appropriate host. Native setup and web build already passed on Linux aarch64; x86_64/container execution remains a separate verification target.
- In a nonproduction project, configure attestation and backend secrets, then exercise real customer login/provisioning, lost-response checkout retry, capture/webhook race, cancellation, partial/full refund and pickup lockout/QR rotation.
- Verify staff demotion/disable/revocation, MFA role assignment and enrolled-terminal reauthentication with real accounts. Review any read-only endpoint that requires faster-than-ID-token-expiry revocation.
- Schedule a coordinated backend/rules/client rollout; direct-write fallback support has intentionally been removed. GitHub staging/production workflow scope is **Firestore and Hosting**, not Functions/Storage deployment.
- Treat private credentials and reconciliation payloads as private operational records; do not place them in this report, repository, test fixture, archive or web output.

**Conclusion:** the named repairs and available local checks are supported by executable evidence. Production certification and Docker/offline-container verification remain explicitly unverified.
