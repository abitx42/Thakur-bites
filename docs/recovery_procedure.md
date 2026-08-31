# Thakur Bites — Disaster Recovery & Backup Procedures

## 1. Recovery Objectives
- **Recovery Point Objective (RPO)**: < 1 hour (Automated snapshot intervals)
- **Recovery Time Objective (RTO)**: < 15 minutes (Automated restoration pipeline)

---

## 2. Backup Architecture
1. **Automated Firestore Snapshots**:
   - Critical collections (`menuItems`, `orders`, `inventoryLedger`, `orderEvents`, `securityEvents`, `payments`, `dailyReconciliations`) exported hourly to cold storage.
2. **Cryptographic Checksums**:
   - Every backup artifact includes a SHA-256 integrity hash to prevent corrupted or tampered restorations.

---

## 3. Step-by-Step Restoration Protocol

### Scenario A: Accidental Document Deletion or Corruption
1. **Identify Corruption Timestamp**:
   - Locate the incident timestamp in the **Security Center** or audit logs.
2. **Execute Snapshot Verification**:
   ```bash
   node functions/scripts/backup_restore.js
   ```
3. **Point-In-Time Restoration**:
   - Restore affected collections from the latest valid snapshot prior to the corruption incident.
4. **Integrity Reconciliation**:
   - Trigger `reconcileDailyLedger` to confirm zero discrepancies between orders and payments.

### Scenario B: Cloud Region Failover
1. Switch DNS / Firebase Hosting target to secondary region.
2. Verify Cloud Functions deployment and environment variables.
3. Validate client app connectivity on staging environment.
