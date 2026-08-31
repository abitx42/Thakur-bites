import * as admin from 'firebase-admin';
import { AccountType, VerificationStatus, PriorityLevel, UserRole } from './types';

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
 * Fetches current custom claims from Firebase Auth, merges the patch atomically,
 * and sets the updated claims object without destroying existing role or identity properties.
 */
export async function syncUserCustomClaims(
  uid: string,
  claimsPatch: Partial<AuthoritativeCustomClaims>
): Promise<AuthoritativeCustomClaims> {
  const userRecord = await admin.auth().getUser(uid);
  const existingClaims = (userRecord.customClaims || {}) as AuthoritativeCustomClaims;

  const mergedClaims: AuthoritativeCustomClaims = {
    ...existingClaims,
    ...claimsPatch,
    updatedAt: new Date().toISOString(),
  };

  await admin.auth().setCustomUserClaims(uid, mergedClaims);
  return mergedClaims;
}
