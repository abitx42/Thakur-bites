import * as admin from 'firebase-admin';
import { AccountType, VerificationStatus, PriorityLevel, UserRole } from './types';

const db = admin.firestore();

export interface AuthoritativeCustomClaims {
  role?: UserRole;
  accountType?: AccountType;
  verificationStatus?: VerificationStatus;
  priorityLevel?: PriorityLevel;
  permissionsVersion?: number;
  assignedAt?: string;
  updatedAt?: string;
}

/**
 * Authoritative Claims Synchronizer.
 * Serializes claims changes via Firestore authoritativeClaims/{uid} document,
 * merges the patch atomically, and sets Firebase Auth custom claims.
 */
export async function syncUserCustomClaims(
  uid: string,
  claimsPatch: Partial<AuthoritativeCustomClaims>
): Promise<AuthoritativeCustomClaims> {
  const claimsDocRef = db.collection('authoritativeClaims').doc(uid);
  const now = admin.firestore.Timestamp.now();

  const mergedClaims = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(claimsDocRef);
    let existingClaims: AuthoritativeCustomClaims = {};
    if (snap.exists) {
      existingClaims = snap.data() as AuthoritativeCustomClaims;
    } else {
      try {
        const userRecord = await admin.auth().getUser(uid);
        existingClaims = (userRecord.customClaims || {}) as AuthoritativeCustomClaims;
      } catch (err) {
        existingClaims = {};
      }
    }

    const updatedClaims: AuthoritativeCustomClaims = {
      ...existingClaims,
      ...claimsPatch,
      updatedAt: now.toDate().toISOString(),
    };

    transaction.set(claimsDocRef, updatedClaims, { merge: true });
    return updatedClaims;
  });

  await admin.auth().setCustomUserClaims(uid, mergedClaims);
  return mergedClaims;
}
