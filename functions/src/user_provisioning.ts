import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserDocument } from './types';
import { classifyIdentity } from './identity_classifier';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';

const db = admin.firestore();

export interface ProvisionUserRequest {
  displayName?: string;
  phone?: string;
  department?: string;
  year?: string;
  rollNo?: string;
}

/**
 * Universal User Profile Provisioner (Platform 2.0).
 * 
 * Called after Google Sign-In (or any Firebase Auth sign-in).
 * Uses identity_classifier to determine initial accountType and verificationStatus.
 * If an existing students/{uid} document exists, migrates data preserving totalOrders and createdAt.
 * 
 * Client cannot set: accountType, verificationStatus, priorityLevel, isVerified,
 * accountDisabled, totalOrders, totalSpentPaise, averageOrderPaise.
 */
export const provisionUserProfile = onCall<ProvisionUserRequest>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userId = request.auth.uid;
  const email = (request.auth.token.email as string | undefined)?.trim().toLowerCase();
  const emailVerified = request.auth.token.email_verified === true;
  const displayNameFromToken = (request.auth.token.name as string | undefined) || '';
  const photoURL = (request.auth.token.picture as string | undefined) || '';

  if (!email) {
    throw new HttpsError('invalid-argument', 'Authenticated user must have an email address.');
  }

  await enforceRateLimit(userId, 'role_assignment');

  // Classify identity based on email
  const classification = classifyIdentity(email);

  // If institutional email, require verification
  let verificationStatus = classification.verificationStatus;
  if (classification.identityHints.isInstitutionalEmail && !emailVerified) {
    verificationStatus = 'PENDING';
  }

  // Sanitize client-provided fields
  const { displayName, phone, department, year, rollNo } = request.data || {};
  const cleanName = String(displayName || displayNameFromToken || 'Thakur Bites User').trim().slice(0, 100);
  const cleanPhone = String(phone || '').trim().slice(0, 20);
  const cleanDept = String(department || '').trim().slice(0, 50);
  const cleanYear = String(year || '').trim().slice(0, 10);
  const cleanRollNo = String(rollNo || '').trim().toUpperCase().slice(0, 20);

  const userRef = db.collection('users').doc(userId);
  const studentRef = db.collection('students').doc(userId);
  const now = admin.firestore.Timestamp.now();

  const result = await db.runTransaction(async (transaction) => {
    const [userSnap, studentSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(studentRef),
    ]);

    if (userSnap.exists) {
      // User already exists — update mutable fields only
      const existingData = userSnap.data() as UserDocument;
      transaction.update(userRef, {
        displayName: cleanName || existingData.displayName,
        photoURL: photoURL || existingData.photoURL || '',
        phone: cleanPhone || existingData.phone || '',
        department: cleanDept || existingData.department || '',
        year: cleanYear || existingData.year || '',
        rollNo: cleanRollNo || existingData.rollNo || '',
        updatedAt: now,
      });

      return {
        isNew: false,
        accountType: existingData.accountType,
        verificationStatus: existingData.verificationStatus,
        priorityLevel: existingData.priorityLevel,
      };
    }

    // Check for legacy students/{uid} migration
    let migratedOrders = 0;
    let migratedSpent = 0;
    let migratedCreatedAt = now;

    if (studentSnap.exists) {
      const studentData = studentSnap.data()!;
      migratedOrders = Number(studentData.totalOrders || 0);
      migratedSpent = Number(studentData.totalSpentPaise || 0);
      if (studentData.createdAt) {
        migratedCreatedAt = studentData.createdAt;
      }
      // Preserve student-specific fields
      if (!cleanDept && studentData.department) {
        // Use existing department
      }
    }

    const isVerified = classification.accountType === 'VISITOR'
      ? true  // Visitors are always "verified" (no institutional proof needed)
      : (emailVerified && classification.verificationStatus === 'VERIFIED');

    const newUser: UserDocument = {
      uid: userId,
      email,
      displayName: cleanName,
      photoURL: photoURL || undefined,
      accountType: classification.accountType,
      verificationStatus: verificationStatus,
      priorityLevel: classification.priorityLevel,
      department: cleanDept || (studentSnap.exists ? studentSnap.data()?.department : '') || '',
      year: cleanYear || (studentSnap.exists ? studentSnap.data()?.year : '') || '',
      rollNo: cleanRollNo || (studentSnap.exists ? studentSnap.data()?.rollNo : '') || '',
      phone: cleanPhone || (studentSnap.exists ? studentSnap.data()?.phone : '') || '',
      isVerified,
      accountDisabled: false,
      totalOrders: migratedOrders,
      totalSpentPaise: migratedSpent,
      averageOrderPaise: migratedOrders > 0 ? Math.round(migratedSpent / migratedOrders) : 0,
      createdAt: migratedCreatedAt,
      updatedAt: now,
    };

    transaction.set(userRef, newUser);

    return {
      isNew: true,
      accountType: classification.accountType,
      verificationStatus,
      priorityLevel: classification.priorityLevel,
    };
  });

  // Set custom claims for RBAC
  await admin.auth().setCustomUserClaims(userId, {
    accountType: result.accountType,
    verificationStatus: result.verificationStatus,
    priorityLevel: result.priorityLevel,
  });

  await logSecurityEvent({
    eventType: result.isNew ? 'USER_PROFILE_PROVISIONED' : 'USER_PROFILE_UPDATED',
    severity: 'INFO',
    actorUid: userId,
    details: {
      email,
      accountType: result.accountType,
      verificationStatus: result.verificationStatus,
      priorityLevel: result.priorityLevel,
      migratedFromStudents: !result.isNew ? false : (await db.collection('students').doc(userId).get()).exists,
    },
  });

  return {
    success: true,
    userId,
    email,
    displayName: cleanName,
    accountType: result.accountType,
    verificationStatus: result.verificationStatus,
    priorityLevel: result.priorityLevel,
    isNew: result.isNew,
  };
});
