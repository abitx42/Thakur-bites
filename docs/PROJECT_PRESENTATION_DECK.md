# Thakur Bites — Project Presentation Deck (12 Slides)
**Department of Computer Science & Engineering (Cyber Security)**  
**Thakur College of Engineering & Technology (TCET), Mumbai**  
**AAD Mini Project Defense & Presentation**

---

## Slide 1: Title & Introduction
- **Header**: TCET Autonomous — Department of Computer Science & Engineering (Cyber Security)
- **Title**: **THAKUR BITES**
- **Subtitle**: High-Concurrency Real-Time Campus Canteen Commerce & Anti-Hallucination AI Copilot
- **Presenter**: Roll No. 01 — CSE(CS)-A
- **Guide**: Lecturer Mr. Chirag Yadav
- **Visual**: Thakur Bites brand mark, mobile phone mockup, and TCET insignia.
- **Speaker Notes**:
  > *"Good morning respected evaluators and guide. Today, I am proud to present Thakur Bites: a production-grade, high-concurrency campus canteen platform designed specifically for the unique operational demands of our college, TCET. Unlike generic commercial delivery wrappers, Thakur Bites combines server-authoritative double-entry financial accounting, station-filtered kitchen operations, and an air-gapped AI Business Intelligence Copilot built with zero PII and anti-hallucination guarantees."*

---

## Slide 2: The Campus Canteen Dilemma (Problem Statement)
- **Header**: Problem Statement
- **Title**: The 30-Minute Recess Crunch
- **Bullet Points**:
  - **Severe Rush-Hour Surges**: 1,000+ students descend on the canteen in a tight 30–45 minute lunch window.
  - **Physical Queue Chaos & Starvation**: Students ordering a ₹15 cold drink wait behind complex multi-dish cooking queues.
  - **Client-Side Pricing Vulnerabilities**: Commercial web ordering forms allow client inspection and parameter tampering (altering cart prices to ₹0).
  - **Financial Discrepancies**: Mixed counter-cash and UPI payments create un-auditable discrepancies between kitchen output and collected revenue.
  - **AI Financial Hallucinations**: Standard LLMs hooked into business dashboards invent profit margins without raw ingredient cost data.
- **Visual**: Split diagram: Left showing long physical queue chaos; Right showing security attack vectors (price tampering, inventory over-booking).
- **Speaker Notes**:
  > *"During our primary recess at TCET, demand spikes by over 350%. Existing systems fail because they treat college dining like commercial delivery. Furthermore, from a cyber security perspective, many campus projects leave pricing logic on the client, allowing malicious users to modify payloads in DevTools. Our objective was to engineer a zero-trust, server-authoritative system that completely solves queue starvation and financial leakage."*

---

## Slide 3: Proposed Solution — Thakur Bites Ecosystem
- **Header**: Proposed Solution
- **Title**: Unified 4-Pillar Commerce & Governance Platform
- **Bullet Points**:
  - **Pillar 1 — Student Flutter App**: Cross-platform Android APK and responsive web app with dynamic preparation estimates and offline wishlists.
  - **Pillar 2 — Operations Workstation Suite**: Real-time Kitchen Display System (KDS), Cashier Counter POS, and 4-digit PIN pickup verification.
  - **Pillar 3 — Live Dispatch TV**: Large-format, zero-PII token board showing 'Preparing' and 'Ready' states across the cafeteria.
  - **Pillar 4 — AI Business Copilot**: Air-gapped decision support tool inside the Admin Portal answering sales, velocity, and stock queries with zero hallucination.
- **Visual**: 4-quadrant diagram connecting Student App, KDS, TV Display, and Admin AI Copilot.
- **Speaker Notes**:
  > *"Thakur Bites is not just a student app; it is a complete 4-pillar ecosystem. Students order via Flutter mobile or web. The kitchen receives tickets filtered by station—South Indian, Snacks, Beverages, and Meals. Cashiers process rapid counter cash with double-entry receipts. A high-contrast TV board projects tokens with zero student PII. And canteen management interacts with an AI Copilot that turns live telemetry into actionable decisions."*

---

## Slide 4: System Architecture & Defense-in-Depth
- **Header**: Architecture & Security
- **Title**: Layered Server-Authoritative Architecture
- **Bullet Points**:
  - **Presentation Layer**: Flutter 3.x Client (Android APK/Web) + Vanilla ES Modules Web Apps.
  - **Security Sentinel**: Pre-bootstrap framebusting (OWASP A05), Content-Security-Policy (CSP), and App Check (Play Integrity & ReCAPTCHA v3).
  - **API Boundary**: 100% server-authoritative Cloud Functions (`checkoutOrder`, `updateOrderStatus`, `aiBusinessChat`).
  - **Data Layer**: Cloud Firestore protected by 537 lines of strict Row-Level Security Rules with canary traps.
  - **AI Subsystem**: Air-gapped prompt constructor using `<UNTRUSTED_BUSINESS_DATA>` encapsulation.
- **Visual**: 5-tier architecture flowchart displaying clean separation of concerns and security boundaries.
- **Speaker Notes**:
  > *"Our architecture enforces defense-in-depth. Every transaction is processed by serverless Cloud Functions where prices are resolved strictly from the authoritative database, rendering client-side tampering impossible. Firestore security rules deny all direct client writes to financial ledgers and anomaly records. The AI layer is isolated and never receives raw database connections."*

---

## Slide 5: The Financial Engine & Invariants
- **Header**: Financial Integrity
- **Title**: Integer-Paise Accounting & Autonomous Circuit Breakers
- **Bullet Points**:
  - **Integer-Paise Precision**: All currency is modeled in integer paise (₹1 = 100 paise), eliminating IEEE 754 floating-point rounding errors.
  - **Double-Entry Ledger**: Every captured order automatically writes balanced debits and credits to an immutable financial audit log.
  - **Deterministic Idempotency**: Payment webhooks and cash receipts use deterministic keys (`cash_fin_${orderId}`) to guarantee exactly-once accounting.
  - **3-Tier Autonomous Circuit Breakers**:
    - *Level 1 (Warning)*: Anomaly logged without disrupting operations.
    - *Level 2 (Restricted)*: Halts new checkouts while allowing kitchen queue completion.
    - *Level 3 (Emergency Freeze)*: Freezes all checkouts while preserving ready-order pickups.
- **Visual**: Double-entry ledger balance equation graphic and circuit breaker state transition diagram.
- **Speaker Notes**:
  > *"In financial systems, floating-point math causes rounding leaks. We store all currency in integer paise. Furthermore, every transaction produces a double-entry debit and credit entry. If an invariant violation occurs, our autonomous circuit breaker triggers immediately—either in warning, restricted, or emergency freeze mode—protecting campus funds while ensuring students who already paid can still collect their warm meals."*

---

## Slide 6: Station-Filtered KDS & Anti-Starvation Queuing
- **Header**: Operational Operations
- **Title**: Kitchen Display System & Smart Canteen Scheduling
- **Bullet Points**:
  - **Station Routing**: Orders automatically route to dedicated prep stations: South Indian (Dosas), Tiffin/Snacks (Vada Pav, Samosa), Beverages (Cold Coffee), and Thali/Meals.
  - **Dynamic Priority Anti-Starvation**: 20-minute waiting student orders dynamically elevate priority, preventing hunger starvation behind bulk faculty orders.
  - **Instant Meal Customizer**: Dynamic Daily Board syncs daily sabji and roti/puri availability to prevent cancellations at the counter.
  - **Double-Handover Defense**: 4-digit pickup PIN verification prevents token theft and replay attacks.
- **Visual**: Screenshot of Kitchen KDS with color-coded station tickets and timer countdowns.
- **Speaker Notes**:
  > *"Our kitchen workstation separates instant snacks from cooked meals. A student ordering a cold coffee isn't delayed behind someone ordering three masala dosas. Furthermore, our anti-starvation algorithm guarantees that any student waiting over 20 minutes automatically gains queue priority. When an order is ready, a 4-digit PIN is verified at the pickup counter, completely eliminating token replay theft."*

---

## Slide 7: AI Business Copilot — Anti-Hallucination Architecture
- **Header**: Artificial Intelligence & Analytics
- **Title**: Grounded Decision Support with Truth Layer Sanitization
- **Bullet Points**:
  - **Air-Gapped Truth Layer**: Synthesizes verified orders, inventory run-rates, and sales velocity into sanitized snapshots.
  - **Prompt Injection Neutralization**: Strips XML tags, boundary markers, and control characters from database strings; caps queries to 300 characters.
  - **Non-Negotiable Cost Refusal**: Strictly refuses dish profit/loss calculations: explains that ingredient and packaging procurement costs are not recorded in the database.
  - **Zero Customer PII**: Transmits 0 student names, emails, phones, or PINs to external models.
- **Visual**: Diagram showing Raw DB → Truth Layer Aggregator (PII Stripper) → `<UNTRUSTED_BUSINESS_DATA>` → Gemini LLM → Evidence Drawer.
- **Speaker Notes**:
  > *"When managers use generative AI, the greatest danger is hallucinated financial numbers. Our AI Business Copilot solves this through an air-gapped Truth Layer. It aggregates real server metrics, strips 100% of student PII, and wraps facts in untrusted data delimiters. If asked 'What is our profit margin on Vada Pav?', it refuses to invent numbers and explicitly states that ingredient procurement costs are not tracked."*

---

## Slide 8: Multi-Provider Failover & Evidence Drawer
- **Header**: AI Reliability & Verification
- **Title**: Resilient Provider Cascade & Verifiable Ground Truth
- **Bullet Points**:
  - **Priority 1 — Google Gemini**: `gemini-2.5-flash` at temperature `0.1` for grounded, consistent operational advice.
  - **Priority 2 — OpenRouter**: OpenAI-compatible chat completion cloud fallback.
  - **Priority 3 — Rule-Based Fallback Engine**: Deterministic offline analytics engine ensuring 100% uptime with zero external API dependencies.
  - **Interactive Evidence Drawer ("🔍 View Evidence & Ground Truth")**:
    - Attached to every response in the Admin Portal.
    - Cites exact verified order count, gross/net paise, model provider used, and explicit `ACTUAL` data status tags.
- **Visual**: Screenshot of the AI Copilot chat interface showing the Operational Attention Board, quick ask chips, and expanded Evidence Drawer.
- **Speaker Notes**:
  > *"To ensure the system never goes down during internet blips or API quota exhaustion, we built an AIRouter failover engine. It first queries Gemini 2.5 Flash, cascades to OpenRouter, and falls back to our local deterministic rule-based engine. Every answer includes a clickable Evidence Drawer showing the exact verified orders, revenue paise, and citations used to construct the answer."*

---

## Slide 9: Frontend Craft & Responsive Large-Screen Layout
- **Header**: Frontend & UI/UX Craft
- **Title**: Token & Tiffin Design System & Responsive Adaptation
- **Bullet Points**:
  - **Editorial Typography Scale**: Bebas Neue display titles, IBM Plex Mono for financial tokens and metrics, Inter for legible UI text.
  - **Adaptive `MaterialApp.builder`**:
    - *Mobile Phones ($\le$ 600px)*: Full-bleed natural mobile scaling.
    - *Tablets & Desktop Web*: Automatically constrains to a centered 540px mobile frame with subtle elevation shadow and warm canteen background (`#F0EBE1`).
  - **Zero Layout Overflows**: 134 widget tests verify zero RenderFlex overflow across Add buttons, quantity steppers, and stock limit banners.
  - **WCAG 2.2 AA Accessibility**: 44px+ tap targets, high contrast ratios, and `prefers-reduced-motion` compliance.
- **Visual**: Side-by-side comparison: Mobile phone screenshot next to desktop browser screenshot showing centered app frame.
- **Speaker Notes**:
  > *"We rejected generic AI templates in favor of our custom 'Token & Tiffin' design system. On phones, the Flutter app renders edge-to-edge. On wide desktop monitors or iPads, our adaptive builder wraps the UI in an elegant 540px centered frame with soft shadows, preventing distorted wide buttons and stretched text lines. All 134 layout tests verify zero RenderFlex overflow."*

---

## Slide 10: Empirical Results & Verification Metrics
- **Header**: Results & Quality Assurance
- **Title**: 100% Automated Test Pass Rate
- **Bullet Points**:
  - **Backend Security & Financial Suite**: **447 / 447 tests passed** (0 failures, 3.57s runtime) across 34 suites.
  - **Flutter Layout & Widget Suite**: **134 / 134 tests passed** across all UI interaction states.
  - **Static Analysis (`flutter analyze`)**: **0 issues found** across the entire Flutter project.
  - **APK Compilation**: Release build #73 successfully generated (`apks/ThakurBites_updated_73.apk`, 60 MB).
  - **Web Compilation**: Flutter Web compiled and synchronized to hosting root with security headers.
- **Visual**: Visual dashboard bar showing 447/447 green checkmarks and test execution log excerpt.
- **Speaker Notes**:
  > *"Our empirical verification is exhaustive. We ran 447 backend security tests covering price tampering, replay attacks, ledger balancing, and prompt injection defense. In the Flutter client, 134 widget tests passed with zero errors. The project compiles with zero static analysis warnings and our automated build script packaged Release APK #73."*

---

## Slide 11: Live Demonstration Highlights
- **Header**: System Demonstration
- **Title**: Real-Time Operational Flow
- **Demonstration Steps**:
  1. **Student Ordering**: Browsing catalog on Android phone, instant meal customization, checkout with Razorpay sandbox.
  2. **Kitchen Dispatch**: KDS updates instantly via Firestore listener; chef marks ticket 'Preparing'.
  3. **TV Projection**: Token transitions immediately from 'Preparing' to 'Ready' on the public TV display.
  4. **Pickup Verification**: Staff scans/enters 4-digit PIN; token marked 'Collected' and archived.
  5. **Admin AI Ingestion**: Manager opens AI Copilot, asks *"How are we doing today?"*, and examines verified evidence drawer.
- **Visual**: Flow diagram illustrating the 5-step live demonstration lifecycle.
- **Speaker Notes**:
  > *"During our live demonstration, we showcase the complete end-to-end loop: a student places an order on their phone, the kitchen KDS receives it with sound cues, the TV board displays the token, the student collects their meal via PIN verification, and the admin AI Copilot immediately reflects the transaction in its real-time attention board."*

---

## Slide 12: Conclusion & Future Roadmap
- **Header**: Conclusion & Future Scope
- **Title**: Transforming Campus Dining into a Secure, Intelligent Utility
- **Key Takeaways**:
  - **Production-Ready**: Proven resilience across high-concurrency rush simulations and rigorous security tests.
  - **Auditable & Safe**: Integer-paise double-entry ledgers and an anti-hallucination AI copilot guarantee trust.
  - **Future Roadmap**:
    - Predictive pre-cooking time-series models before recess bells.
    - RFID / NFC college smart ID tap pickups on staff terminals.
    - Expansion to multi-canteen consortia across the Thakur Education campus.
- **Presenter Contact**: Roll No. 01 — Department of Computer Science & Engineering (Cyber Security), TCET
- **Speaker Notes**:
  > *"In conclusion, Thakur Bites demonstrates how modern serverless cloud architecture, declarative mobile design, and constrained AI models can solve genuine, high-friction operational challenges in our college. It is secure, auditable, and production-tested. Thank you, and I look forward to your questions."*
