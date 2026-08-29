# Thakur Bites — Implementation Roadmap (Solo Build)

> AN app made for college canteen to solve the problem of offline crowd and shift the crowd to app

Companion to the product plan — that doc answers *what* and *why*, this one answers *how* and *in what order*. Built for: one person, first real app, no fixed deadline. That last part is genuinely an advantage — it means small correct phases beat rushed big ones.

## The Stack — and Why Each Piece

| Layer | Choice | Why |
|-------|--------|-----|
| Student app | Flutter (Dart) | One codebase for Android now, iOS later — matches what you said you eventually want. Huge official beginner docs, hot reload makes learning fast, and "food ordering app" is one of the most common Flutter tutorial projects out there — you won't be short of directly relevant guides. |
| Backend | Firebase (Firestore + Auth + Hosting) | No server to write, manage, or pay for early on. Firestore has real-time listeners built in — which solves the "Kitchen screen must update live" requirement almost for free, no WebSocket code needed. Generous free tier easily covers a campus pilot. |
| Staff dashboard | Plain HTML/CSS/JS + Firebase JS SDK, hosted free on Firebase Hosting | This is 3 simple internal screens, not a product. Learning a second framework (React etc.) just for this would be wasted effort — plain JS talking directly to Firebase is genuinely simpler here, and you can reuse the visual style from the HTML mockups already built. |
| State management (Flutter) | setState → Provider | Lowest learning curve, enormous tutorial coverage. Skip Riverpod/Bloc for now — they solve problems you don't have yet. |
| Version control | Git + GitHub from day one, even solo | Protects your work, and Play Store's tooling assumes it anyway. |

> **One honest heads-up:** everything above stays inside Flutter/Dart and plain JS except Phase 13 (real payment), which needs a small Firebase Cloud Function to verify payment securely — that's written in Node.js/JavaScript. It's a small, contained piece, but it *is* a second language sneaking in. Flagging it now so it's not a surprise later.

---

## Play Store Reality Check — Do This Early, Not Last

I checked current requirements since Google's changed this recently, and it changes how you should sequence the final phases:

- **$25 one-time registration fee** to create a Play Console account.
- **Identity verification is now mandatory** for new personal accounts (rolling out through September 2026 — so this applies to you). You'll need real government ID documents. Start this whenever you're ready to create the account — it doesn't need to wait for the app to be finished.
- **12 testers, opted in continuously for 14 days**, is mandatory before you can even apply for public release — this applies to every new personal account. The genuinely good news: this is the same pilot you already wanted to run with willing classmates. Don't treat it as red tape separate from testing — plan to recruit your 12+ pilot testers as your official closed-testing group and get both done at once.
- **Budget 3–5+ weeks** after the app is ready just for the account + verification + closed-testing process. Start the account and verification steps as early as you're comfortable, so that clock isn't sitting entirely at the end.

---

## Ground Rules Given Solo + First Build

- Each phase below should end with something that actually runs — resist the urge to build three phases in parallel before testing any of them.
- Commit to Git at the end of every phase, not just "when it feels done."
- Don't skip Firestore security rules to save time (Phase 1) — an open database is the single most common beginner mistake, and it's much easier to get right from the start than retrofit later.
- It's fine — expected, even — to follow a tutorial closely for Phase 0–2. Understanding *why* it works matters more than writing every line from scratch.

---

## Part A — Foundations

### Phase 0 · Environment & Learning Setup

**Goal:** Flutter is installed, a "hello world" app runs on your phone/emulator, and you've done one real official tutorial before touching your own app.

- Install Flutter SDK; install Antigravity as your IDE (it's VS Code-based, so Flutter's Dart extension works inside it normally)
- Run `flutter doctor`, fix whatever it flags
- Complete Flutter's official "first app" codelab (a simple counter or list app) — do this one mostly by hand, even with an agentic IDE available, so the fundamentals actually stick before you start delegating
- Set up a GitHub repo for Thakur Bites, first commit — include this roadmap and the product plan as markdown files in a `/docs` folder, so Antigravity's agent has real project context to reference on every task, not just a blank repo

### Phase 1 · Firebase Project & Data Model

**Goal:** Flutter talks to Firebase successfully, and your data structure is decided before you build screens around it.

- Create a Firebase project, add it to your Flutter app via FlutterFire
- Design Firestore collections: `menuItems`, `orders`, `dailyBoard` (today's sabjis/special), `students`
- Write baseline security rules: students can create their own orders but never edit others', order status can only be changed by an authenticated staff session
- Smoke test: write one dummy document from the app, read it back — prove the pipeline works before building anything real on top of it

---

## Part B — Core Student App (local only, nothing live yet)

### Phase 2 · Menu Screen

**Goal:** Real menu items, pulled from Firestore, rendered in the category-tab + card-grid design already built.

- Port the color/type system from the HTML mockup into a Flutter theme (colors, fonts, card styles)
- Fetch `menuItems` from Firestore, display in the grid
- Category tab filtering (client-side is fine at this size)
- Seed Firestore manually with your current 6 demo items for now — real menu comes in Phase 14

### Phase 3 · Cart & Local State

**Goal:** Add/remove items, see a running total — entirely local, no backend writes yet.

- Cart state via Provider
- Menu card stepper (+ / qty / −) matching the earlier prototype
- Cart screen with per-item quantity control and total

---

## Part C — The Real Ordering Loop

### Phase 4 · Order Placement (Fake Payment Gate)

**Goal:** Tapping "Confirm" actually creates a real order in Firestore.

- "Confirm Order" writes a new `orders` document (items, total, timestamp) — payment is still a placeholder button, not real money
- Generate the 4-digit pickup code
- Simple ready-time estimate for now (lookup table per item — the real per-station capacity math comes later, Phase 12)

### Phase 5 · Confirmation / Ticket Screen

**Goal:** The signature perforated-ticket screen, now showing a real order instead of dummy data.

- Wire the existing ticket UI to the order just created
- QR/code, item list, total, ready-time — all pulled from the live document

### Phase 6 · Real-Time Order Status

**Goal:** Status updates live, no manual refresh — this is where Firestore's real-time listeners do the heavy lifting.

- Status screen subscribes to the order document
- Stepper UI (Placed → Preparing → Ready → Collected) driven by a `status` field

### Phase 7 · Student Login

**Goal:** Real accounts, order history.

- Firebase Auth via phone OTP (simplest for students — no passwords to manage, everyone already has a phone number)
- Orders tied to the logged-in student; basic order history list

> 🎯 **Milestone:** by the end of Part C you have a genuinely working app — a real student can log in, order, get a code, and watch status update live. Everything after this is expansion, not a rebuild.

---

## Part D — Staff Dashboard (separate lightweight web app)

### Phase 8 · Dashboard Shell

**Goal:** A bookmarkable web page, gated behind one shared PIN, hosted free.

- Plain HTML/JS page connected directly to the Firebase JS SDK
- One shared PIN check (not per-worker logins, matches how your 4 people rotate)
- Deploy to Firebase Hosting

### Phase 9 · Kitchen View

**Goal:** New paid orders appear live, staff can mark them ready.

- Live-updating list of orders where `status = placed`, sorted by promised time
- "Mark Ready" button updates status

### Phase 10 · Pickup / Redeem View

**Goal:** Staff can verify and close out an order using the 4-digit code.

- Lookup by code, shows matching order + student's name
- "Mark Collected" — locks the order, second attempt at the same code gets flagged instead of silently succeeding

### Phase 11 · Menu Management View

**Goal:** Staff can run the daily-changing parts without touching code.

- Add/edit items, toggle on/off, adjust stock counts for instant items
- Today's Board editor — the 2 daily sabjis + optional special banner

---

## Part E — The Hard Problem

### Phase 12 · Per-Station Slot & Capacity Logic

**Goal:** The actual throughput math from the product plan, now layered onto a system that already works without it.

- Requires the real timing data first — go time the dosa station during an actual break (per the product plan's Section 10)
- Track how many orders are already assigned to each time slot per station; once a slot's full, push new orders to the next one automatically
- This was deliberately saved for last among the "core" phases — it's the hardest logic, and you don't want it blocking a working v1

---

## Part F — Real Payment + Real Content

### Phase 13 · Real UPI Payment

**Goal:** Replace the placeholder "Confirm" button with real money — only once the vendor's business account is actually sorted (see product plan, Section 7).

- Razorpay (or similar) Flutter SDK
- A small Firebase Cloud Function to verify the payment webhook before an order is created — this is the Node.js piece flagged earlier
- Refunds via the gateway's API for no-shows/cancellations

### Phase 14 · Full Menu + Real Photos

**Goal:** Swap demo data for the real thing once you send it over.

- Full menu import (Chinese, Lunch/Thali, Tea-Coffee, Cold Drinks, Shakes/Juice — per the categories already mapped)
- Real dish photos in place of icon placeholders
- Full/Half size variants, swappable roti/puri components (per product plan Section 5.2)

---

## Part G — Ship It

### Phase 15 · Testing & Bug Bash

- Walk every flow end to end: order → pay → code → kitchen → pickup → collected
- Deliberately try to break it: double-redeem a code, kill the app mid-payment, order right as a slot fills up
- App icon, splash screen, loading/error/empty states

### Phase 16 · Play Store Account + Identity Verification

- Register the Play Console account ($25 one-time)
- Complete identity verification — start this as soon as you're comfortable, it can run in parallel with later dev phases
- Build a signed release AAB targeting the current required API level

### Phase 17 · Closed Testing (doubles as your real pilot)

- Recruit 12+ classmates, get them opted in via the testing link
- Keep them opted in and engaged for 14 continuous days — this is the same "pilot with willing classmates" from the original plan, just formally structured to satisfy Play Store's requirement at the same time
- Actually watch how it's used — this is where you'll find the real-world issues no amount of solo testing surfaces

### Phase 18 · Production Release & Iterate

- Apply for production access once the 14-day window is met
- Launch narrow — one station, one break period, exactly as the original plan's build order intended
- Take the working, live app to the canteen owner as leverage for real UPI onboarding if that hasn't happened yet

---

## What To Actually Do Right Now

1. Install Flutter, run `flutter doctor`, get it green.
2. Complete one official Flutter codelab before writing a single line of Thakur Bites code.
3. Create the Firebase project.

That's it — that's Phase 0. Everything else waits until that's done.
