# Thakur Bites — STRIDE Threat Model & Security Mitigations

| Threat (STRIDE) | Attack Vector | System Defense / Mitigation |
|---|---|---|
| **Spoofing** | Student impersonation or fake staff PIN entry | Authenticated TCET email / verified mobile token; Firebase Auth with cryptographically signed Custom Claims (`kitchen`, `pickup`, `admin`). No client PIN bypass. |
| **Tampering** | Client submits modified price (`₹1` instead of `₹50`) or negative quantities in payload | Backend lookup: Cloud Function ignores client prices and computes total authoritatively from `menuItems` document snapshot. Quantities validated to integer `>= 1`. |
| **Repudiation** | Staff claims an order wasn't collected or student denies receipt | Append-only `orderEvents` and `inventoryLedger` records timestamp, actor UID, role, and verification signature. Single-use hashed QR/PIN validation. |
| **Information Disclosure** | Student views other students' orders, PINs, or roll numbers; Token TV reveals sensitive PINs | Restrictive `firestore.rules` enforces `request.auth.uid == resource.data.studentId`. Token TV UI displays only public sequence numbers (`TB-001`), never private verification PINs. |
| **Denial of Service / Race Conditions** | Rapid checkout clicks causing double-spending or stock overselling | Idempotency keys prevent duplicate order creation on network retries. ACID Firestore transactions in trusted Cloud Functions guarantee serialized atomic stock decrements. |
| **Elevation of Privilege** | Student sets `isAdmin = true` on their profile document | `firestore.rules` blocks direct updates to privileged fields; role assignments require backend `assignStaffRole` callable with `security_admin` claim and audit event logging. |
