# Thakur Bites

Campus canteen ordering, kitchen dispatch, counter pickup and TV display. The customer app is Flutter; the staff portals are browser JavaScript; trusted commands run in Firebase Cloud Functions v2 with Firestore and Storage.

**Security boundary:** clients do not create or settle orders, mutate stock/prices, grant staff roles, or bypass pickup verification. Failures remain failures. Institutional email addresses, local caches and workstation flags are not administrative authority.

## Pinned tools and clean Linux setup

Run commands from the repository root. No global npm packages are required.

| Tool | Pin / requirement |
| --- | --- |
| Node | `22.23.3` (`.nvmrc`) |
| npm | `10.9.9` (`packageManager`) |
| Flutter | `3.47.2`, revision `d3b14c876900e553bc736ca19295fc09e3853e8e` |
| Dart | `3.13.2`, supplied by the Flutter SDK |
| Firebase CLI | Project-local `firebase-tools@15.34.0` in the root lockfile |
| Java | 21, for Firestore/Storage emulators |

The **Dockerfile is the system-package recipe** for a clean Debian Linux machine: CA certificates, curl, git, make, Python 3, unzip, xz, libGLU and Java 21. Use Docker below if these are not already installed. Native development requires the same prerequisites plus the pinned Node/npm. Do not install npm dependencies globally or change the lockfiles during setup.

```bash
node --version
npm --version
java -version
make setup
```

`make setup` performs both `npm ci` installs, clones the pinned Flutter SDK into `.tools/flutter` if absent, checks its exact revision, precaches web/Linux artifacts, runs `flutter pub get --enforce-lockfile`, and downloads both emulator binaries. Initial setup needs Internet access. Node modules, SDK, npm/Pub caches and emulator binaries stay in `node_modules`, `functions/node_modules`, `.tools`, and `.cache` within this project. Generated directories are ignored by git.

An existing **exactly pinned** SDK can be selected with `FLUTTER_BIN`; otherwise use the project-local SDK. Ensure Java 21 is selected by `JAVA_HOME`/`PATH` before emulator commands.

## Build and run the web app

```bash
npm run build             # Compile the backend TypeScript
npm run build:web         # Rebuild Flutter release output and stage public files
npm start                # http://localhost:8080
```

Routes: customer `/`, staff `/staff`, administration `/admin`, developer `/developer`, TV `/tv` or `/web_tv`, privacy `/privacy`.

The server binds `127.0.0.1` by default. Set `HOST=0.0.0.0` only when intentionally exposing it; `PORT` defaults to `8080`. `PUBLIC_DIR` defaults to `dist/site`. The compatibility Python launcher serves the same hardened server on loopback port `8081`.

**Publish only `dist/site`, never the repository root or the historical generated bundles checked into it.** Staging overlays rebuilt Flutter output with allowlisted portal assets, rejects symlinks and excludes private configuration/source, dependencies and sourcemaps. A failed staging validation preserves the previous good bundle. Node serving and Firebase Hosting use matching App Check-compatible security headers.

### Firebase / App Check configuration

The checked-in Firebase app identifiers are public configuration, not server credentials. Choose your intended Firebase project and authorized domains before signing in or placing real orders; a localhost static preview does not automatically redirect Firebase requests to emulators.

For authenticated web use, register the app/domains in Firebase App Check with **reCAPTCHA v3** and supply its **public site key**:

```bash
export FIREBASE_APP_CHECK_WEB_KEY='YOUR_PUBLIC_RECAPTCHA_V3_SITE_KEY'
npm run build:web
npm start
```

The build passes this value to Flutter and generates matching staff `js/publicConfig.js` inside `dist/site`. Without it, a build is for inspection only; the staff bootstrap fails closed and production backend attestation remains mandatory. No debug-token or staff bypass is enabled.

Staff Functions emulator routing is off by default. For explicit local-only development, edit the **public** source `js/publicConfig.js` to use `{ host: '127.0.0.1', port: 5001 }` for `functionsEmulator`; the browser must also be on loopback. That port must serve the real Functions emulator, not this static server. Do not commit an emulator opt-in for production. The automated tests below manage isolated demo emulators themselves and do not require this edit.

## Tests

After setup, the single offline regression command is:

```bash
make test
```

This runs HTTP/staging/deploy-script tests, compiles TypeScript and runs backend/client-boundary regressions. The runner isolates its credential home, removes deployment secrets from child environments, and preloads a test-only external TCP/DNS blocker; loopback fixtures remain enabled. It does not install packages, fetch advisories or require Firebase/gateway credentials. This is a regression safeguard, not a sandbox for malicious test code.

Additional checks:

```bash
npm run test:flutter     # Actual Flutter analyze + unit/widget tests, --no-pub
npm run test:rules       # Actual Firestore + Storage rules/transaction emulators
make test-all            # All three suites, after SDK/emulator caches are hydrated
make audit               # ONLINE npm audits in both trees + local source/history scans
bash scripts/run_all_security_checks.sh
```

`test:rules` compiles the backend first and uses demo projects on ports `8080` (Firestore) and `9199` (Storage); stop another local instance before running. Mocked gateway/Auth tests are not live provider certification. Some older tests are structural assertions or duplicated models, not executions of production handlers. New regressions identify which real modules/callables they exercise; Flutter structural checks do not replace the actual Flutter suite.

Current observed results and deployment limitations are recorded in [`reports/security-review.md`](reports/security-review.md), not hard-coded passing badges. The master runner fails on a failed command and reports actual runner results without fabricated fallback counts.

## Docker build, run and offline checks

Build a static runtime image (backend APIs remain Firebase-hosted):

```bash
# Optional: export the PUBLIC App Check key first as shown above.
docker build --build-arg FIREBASE_APP_CHECK_WEB_KEY -t thakur-bites .
docker run --rm -p 127.0.0.1:8080:8080 thakur-bites
```

The multi-stage build installs pinned project dependencies and SDK, runs Node and Flutter checks, builds the web app, then copies **only** public output and the dependency-free HTTP runtime into a non-root final image. Payment/QR credentials must not be build arguments or image files.

For an offline, hydrated test image:

```bash
docker build --target checks -t thakur-bites-checks .
docker run --rm --network none thakur-bites-checks
```

The `checks` target includes source and cached tools; do not publish it as the production runtime. Image builds require network access. **Docker was unavailable in the audit sandbox: these container commands are provided but have not been executed there.** Native setup, tests and release web build were executed.

## Required backend deployment configuration

Use `.env.example` as a **name/schema reference only**. The HTTP/build tools do not automatically load it. Inject actual values through the Functions runtime's secure environment/secret-binding configuration; never add a populated env, service-account key or gateway credential to git, a web bundle or an image.

| Variable | Purpose |
| --- | --- |
| `QR_SIGNING_SECRET` | Fresh high-entropy secret for pickup credentials; rotate the retired source-default key |
| `PAYMENT_GATEWAY_KEY_ID` | Correct Razorpay account key ID (`rzp_live_…` in production) |
| `PAYMENT_GATEWAY_SECRET` | Gateway API/payment signature secret |
| `RAZORPAY_WEBHOOK_SECRET` | **Separate** webhook signing secret; not the API secret |
| `ENFORCE_APP_CHECK` | Set to `true`; production enforces attestation regardless of bypass flags |
| `SIMULATE_PAYMENTS` | `false`; simulation is restricted to explicit isolated test/emulator contexts |

Creating a secret-manager entry alone does not expose it to a function: verify the consuming runtime's bindings. Missing/placeholder credentials deliberately block payment/QR operations. This repository does not provision a cloud account, payment account, secret bindings or initial administrative identity.

### Authorized Firebase deployment

Only a suitably authorized operator should execute deployment commands. Select and verify the project/site variables; do not rely on the workstation's default project or production-only target mapping. Authenticate the **local** CLI through your approved account/service identity first.

```bash
# Set FIREBASE_PROJECT_ID, FIREBASE_APP_HOSTING_SITE and FIREBASE_STAFF_HOSTING_SITE
# to the intended project and its TWO distinct Hosting site IDs.
make test-all
make audit
npm run build:web
./node_modules/.bin/firebase target:apply hosting app "$FIREBASE_APP_HOSTING_SITE" --project "$FIREBASE_PROJECT_ID"
./node_modules/.bin/firebase target:apply hosting staff "$FIREBASE_STAFF_HOSTING_SITE" --project "$FIREBASE_PROJECT_ID"
# Review the resulting .firebaserc mapping before this consequential command:
./node_modules/.bin/firebase deploy --only functions,firestore,storage,hosting --project "$FIREBASE_PROJECT_ID"
```

Configure the App Check key and runtime secrets **before** exposing authenticated flows. Coordinate backend, rules and client rollout during an appropriate maintenance window; the new rules intentionally reject legacy direct writes. Reauthenticate staff on enrolled hardware, verify fresh role claims/MFA, and test real provider capture/refund/webhook behavior with a test account before production money moves. Do not blindly retry uncertain gateway/refund outcomes or unblock pending reservations: reconcile against the provider through a trusted operator first.

GitHub staging/production workflows use pinned tools, all gates, explicit Hosting sites, temporary restricted credentials and environment-specific approval. Configure each GitHub environment with:

- Variables: `FIREBASE_APP_CHECK_WEB_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_HOSTING_SITE`, `FIREBASE_STAFF_HOSTING_SITE`.
- Secret: `FIREBASE_SERVICE_ACCOUNT_JSON` for that selected project; apply least-privilege IAM.
- Production environment protection/reviewer rules in GitHub itself.

**Workflow scope is Firestore and Hosting only.** Functions and Storage rollout still require the separate authorized deployment above. The CI inspection artifact is not a deployed service; publishing a release can trigger the production workflow once it is configured. GitHub Actions/provider authentication and real deployments were not executed during the local audit. Android/iOS release signing and physical-device attestation remain separate checks.

### Optional Antideploy runtime

Package an already-built site without credentials, a build or any network deployment:

```bash
mkdir -p dist/packages
bash scripts/deploy_antideploy.sh --package-only dist/packages/thakur-bites-runtime.tar.gz
```

Output must not exist already. `--dry-run OUTPUT.tar.gz` is the same package-only mode. Archives contain only allowlisted `dist/site` files, `server.js`, `web-public.js`, and generated dependency-free runtime manifests/pins. Unsafe files, symlinks and hardlinks are rejected; archive ordering/ownership/timestamps are normalized.

For a **deliberate live deployment**, inject `ANTIDEPLOY_APPLICATION_ID` and `ANTIDEPLOY_TOKEN` through your approved secret mechanism, set the public App Check key, then run `npm run deploy:antideploy`. The script performs one bounded build/upload and bounded status polling, never reads a home-directory credential config, and never claims success on a timeout/unknown result. Inspect the remote task before retrying an uncertain upload. Live Antideploy behavior was not exercised; script tests use local stubs only.

## Repository map

- `functions/src/`: authoritative checkout, inventory, payments/refunds, pickup, role/session and operational commands.
- `firestore/firestore.rules`: canonical client-access rules; `thakur_bites/firestore.rules` references the same ruleset.
- `storage.rules`: private proof and public menu-image access, MIME/size limits and administrative deletion.
- `js/`: staff portal services/views; `thakur_bites/lib/`: Flutter customer UI/services.
- `test/`, `functions/test/`, `functions/test/emulator/`, `thakur_bites/test/`: runtime, isolated and emulator regressions.
- `web-public.js`: shared serving/staging allowlist and Node security policy.
- `scripts/`: locked setup/build/test/packaging helpers. `scripts/dev_runner.sh` offers local checks/serving only, not implicit deployment/seeding.
- `dist/site`: generated deployment output, ignored by git.

## License and compliance

Thakur Bites Platform 2.0 retains its existing MIT License notice for Thakur College of Engineering & Technology (TCET).
