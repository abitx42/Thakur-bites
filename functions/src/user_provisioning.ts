import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { UserDocument, VerificationStatus, PriorityLevel } from './types';
import { classifyIdentity } from './identity_classifier';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';
import { logSecurityEvent } from './security_logger';
import { syncUserCustomClaims } from './claims_manager';
import { enforceAppVersionPolicy } from './version_policy';

const db = admin.firestore();

export interface ProvisionUserRequest {
  displayName?: string;
  phone?: string;
  department?: string;
  year?: string;
  rollNo?: string;
  appVersion?: string;
}

/**
 * Universal User Profile Provisioner (Platform 2.0).
 * 
 * Called after Google Sign-In, Email Sign-Up, or Guest Sign-In.
 * Authoritatively determines accountType, verificationStatus, and priorityLevel on the backend.
 * 
 * SECURITY INVARIANTS:
 * 1. Anonymous / Guest sessions are strictly assigned accountType: 'VISITOR', priorityLevel: 0.
 *    Client self-assertion of student/teacher status is strictly IGNORED.
 * 2. Institutional student/teacher status requires verified institutional email (@tcetmumbai.in, @thakureducation.org).
 * 3. Client cannot set or tamper with: accountType, verificationStatus, priorityLevel, isVerified,
 *    accountDisabled, totalOrders, totalSpentPaise, averageOrderPaise.
 * 4. Migrates legacy students/{uid} documents server-side.
 */
export const provisionUserProfile = onCall<ProvisionUserRequest>(async (request) => {
  enforceAppCheck(request);
  await enforceAppVersionPolicy(request.data?.appVersion);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userId = request.auth.uid;
  const email = (request.auth.token.email as string | undefined)?.trim().toLowerCase() || '';
  const isAnonymous = request.auth.token.firebase?.sign_in_provider === 'anonymous' || !email;
  const emailVerified = request.auth.token.email_verified === true;
  const displayNameFromToken = (request.auth.token.name as string | undefined) || '';
  const photoURL = (request.auth.token.picture as string | undefined) || '';

  await enforceRateLimit(userId, 'role_assignment');

  // Authoritatively classify identity based on verified email
  let classification: ReturnType<typeof classifyIdentity>;
  let verificationStatus: VerificationStatus;
  let priorityLevel: PriorityLevel;

  if (isAnonymous) {
    // Anonymous / Guest sign-in: Always VISITOR, Zero priority, Not Required verification
    classification = {
      accountType: 'VISITOR',
      verificationStatus: 'NOT_REQUIRED',
      priorityLevel: 0,
      identityHints: {
        isInstitutionalEmail: false,
        domain: '',
        possibleStudentId: false,
      },
    };
    verificationStatus = 'NOT_REQUIRED';
    priorityLevel = 0;
  } else {
    classification = classifyIdentity(email);
    verificationStatus = classification.verificationStatus;
    // TB-NEW-001 & TB-NEW-003: Institutional email requires verified email ownership.
    // Unverified institutional emails must NOT receive student priority!
    if (classification.identityHints.isInstitutionalEmail && !emailVerified) {
      verificationStatus = 'PENDING';
      priorityLevel = 0; // Demoted to standard queue until ownership is verified
    } else {
      priorityLevel = classification.priorityLevel;
    }
  }

  // Sanitize client-provided fields (TB-AUTH-011)
  const { displayName, phone, department, year, rollNo } = request.data || {};
  const fallbackDefaultName = isAnonymous ? 'Guest Visitor' : 'Thakur Bites User';
  const cleanName = String(displayName || displayNameFromToken || fallbackDefaultName).trim().slice(0, 100);
  
  let cleanPhone = String(phone || '').trim().slice(0, 20);
  if (cleanPhone && !/^\+?[0-9]{7,15}$/.test(cleanPhone)) {
    cleanPhone = '';
  }

  const safePhotoURL = photoURL && (photoURL.startsWith('https://') || photoURL.startsWith('data:image/'))
    ? photoURL.slice(0, 500)
    : '';

  const cleanDept = String(department || '').trim().slice(0, 50);
  const cleanYear = String(year || '').trim().slice(0, 10);
  
  let cleanRollNo = String(rollNo || (isAnonymous ? 'GUEST' : '')).trim().toUpperCase().slice(0, 30);
  if (cleanRollNo && !/^[A-Z0-9_\-\/]+$/.test(cleanRollNo)) {
    cleanRollNo = isAnonymous ? 'GUEST' : '';
  }

  const userRef = db.collection('users').doc(userId);
  const studentRef = db.collection('students').doc(userId);
  const now = admin.firestore.Timestamp.now();

  const result = await db.runTransaction(async (transaction) => {
    const [userSnap, studentSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(studentRef),
    ]);

    if (userSnap.exists) {
      // User already exists — update mutable client-editable fields only (TB-AUTH-010)
      const existingData = userSnap.data() as UserDocument;

      // TB-NEW-003: If user was previously PENDING email verification, but has now verified institutional email, elevate them.
      let currentVerificationStatus = existingData.verificationStatus;
      let currentPriorityLevel = existingData.priorityLevel;
      let currentIsVerified = existingData.isVerified;

      if (
        classification.identityHints.isInstitutionalEmail &&
        emailVerified &&
        existingData.verificationStatus === 'PENDING' &&
        existingData.accountType === 'STUDENT'
      ) {
        currentVerificationStatus = 'VERIFIED';
        currentPriorityLevel = 1;
        currentIsVerified = true;
      }

      // Invariant: verified students/teachers cannot have their rollNo/employeeId or department overwritten by client
      const isProfileLocked = currentVerificationStatus === 'VERIFIED' || existingData.accountType === 'TEACHER';
      const preservedRollNo = isProfileLocked && existingData.rollNo ? existingData.rollNo : (cleanRollNo || existingData.rollNo || '');
      const preservedDept = isProfileLocked && existingData.department ? existingData.department : (cleanDept || existingData.department || '');

      transaction.update(userRef, {
        displayName: cleanName || existingData.displayName,
        photoURL: safePhotoURL || existingData.photoURL || '',
        phone: cleanPhone || existingData.phone || '',
        department: preservedDept,
        year: cleanYear || existingData.year || '',
        rollNo: preservedRollNo,
        verificationStatus: currentVerificationStatus,
        priorityLevel: currentPriorityLevel,
        isVerified: currentIsVerified,
        updatedAt: now,
      });

      return {
        isNew: false,
        accountType: existingData.accountType,
        verificationStatus: currentVerificationStatus,
        priorityLevel: currentPriorityLevel,
        isVerified: currentIsVerified,
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
    }

    const isVerified = isAnonymous || classification.accountType === 'VISITOR'
      ? true  // Visitors do not require institutional verification
      : (emailVerified && verificationStatus === 'VERIFIED');

    const newUser: UserDocument = {
      uid: userId,
      email,
      displayName: cleanName,
      photoURL: photoURL || undefined,
      accountType: classification.accountType,
      verificationStatus: verificationStatus,
      priorityLevel: priorityLevel,
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
      priorityLevel,
      isVerified,
    };
  });

  // Set custom claims for RBAC using atomic claims synchronizer
  await syncUserCustomClaims(userId, {
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
      isAnonymous,
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
    isVerified: result.isVerified,
    isNew: result.isNew,
  };
});
