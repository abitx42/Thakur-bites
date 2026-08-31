import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { enforceRateLimit } from './rate_limiter';
import { enforceAppCheck } from './app_check';
import { logSecurityEvent } from './security_logger';
import { syncUserCustomClaims } from './claims_manager';
import { AccountType, VerificationStatus, PriorityLevel, VerificationApplication } from './types';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface SubmitVerificationRequest {
  applicationType: 'TEACHER' | 'COLLEGE_STAFF';
  employeeId: string;
  department: string;
  designation: string;
  officialEmail?: string;
  idProofStoragePath?: string;
}

export interface ReviewVerificationRequest {
  applicationId: string;
  decision: 'APPROVED' | 'REJECTED';
  reviewNotes?: string;
}

/**
 * Platform 2.0 — Submit Faculty / Staff Verification Application
 * 
 * Called by logged-in users who wish to verify their Teacher or College Staff status.
 * Updates user profile to UNDER_REVIEW and logs security telemetry.
 */
export const submitVerificationApplication = onCall<SubmitVerificationRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to apply for verification.');
  }

  const userId = request.auth.uid;
  const userEmail = (request.auth.token.email as string | undefined)?.trim().toLowerCase() || '';

  await enforceRateLimit(userId, 'role_assignment');

  const { applicationType, employeeId, department, designation, officialEmail, idProofStoragePath } = request.data || {};

  if (!applicationType || !['TEACHER', 'COLLEGE_STAFF'].includes(applicationType)) {
    throw new HttpsError('invalid-argument', 'Valid applicationType (TEACHER or COLLEGE_STAFF) is required.');
  }

  const cleanEmployeeId = String(employeeId || '').trim().toUpperCase().slice(0, 30);
  const cleanDept = String(department || '').trim().slice(0, 50);
  const cleanDesignation = String(designation || '').trim().slice(0, 50);
  const cleanOfficialEmail = String(officialEmail || userEmail).trim().toLowerCase().slice(0, 100);

  if (cleanEmployeeId.length < 2) {
    throw new HttpsError('invalid-argument', 'Valid Employee / Faculty ID is required.');
  }
  if (cleanDept.length < 2) {
    throw new HttpsError('invalid-argument', 'Valid Department name is required.');
  }
  if (cleanDesignation.length < 2) {
    throw new HttpsError('invalid-argument', 'Valid Designation title is required.');
  }

  // Generate unique cryptographic application ID (e.g. FAC-A8F23BC98410)
  const hexSuffix = crypto.randomBytes(8).toString('hex').toUpperCase();
  const applicationId = `${applicationType === 'TEACHER' ? 'FAC' : 'STF'}-${hexSuffix}`;
  const appRef = db.collection('verificationApplications').doc(applicationId);
  const userRef = db.collection('users').doc(userId);
  const now = admin.firestore.Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError('failed-precondition', 'User profile must be provisioned before applying.');
    }

    const userData = userSnap.data()!;
    if (userData.verificationStatus === 'VERIFIED' && userData.accountType === applicationType) {
      throw new HttpsError('already-exists', `You are already a verified ${applicationType}.`);
    }

    if (userData.verificationStatus === 'UNDER_REVIEW') {
      throw new HttpsError('already-exists', 'You already have a pending verification application under review.');
    }

    // Sanitize storage path to prevent directory traversal
    const safeProofPath = idProofStoragePath
      ? `faculty_proofs/${userId}_${crypto.randomBytes(6).toString('hex')}`
      : undefined;

    const newApp: VerificationApplication = {
      applicationId,
      userId,
      applicationType,
      employeeId: cleanEmployeeId,
      department: cleanDept,
      designation: cleanDesignation,
      officialEmail: cleanOfficialEmail,
      idProofStoragePath: safeProofPath,
      status: 'SUBMITTED',
      submittedAt: now,
    };

    transaction.set(appRef, newApp);
    transaction.update(userRef, {
      verificationStatus: 'UNDER_REVIEW',
      department: cleanDept,
      designation: cleanDesignation,
      rollNo: cleanEmployeeId,
      updatedAt: now,
    });
  });

  await logSecurityEvent({
    eventType: 'VERIFICATION_APPLICATION_SUBMITTED',
    severity: 'INFO',
    actorUid: userId,
    details: {
      applicationId,
      applicationType,
      employeeId: cleanEmployeeId,
      department: cleanDept,
    },
  });

  return {
    success: true,
    applicationId,
    status: 'SUBMITTED',
    message: 'Verification application submitted successfully. Pending staff review.',
  };
});

/**
 * Platform 2.0 — Review Faculty / Staff Verification Application
 * 
 * Restricted to Manager, Admin, or Security Admin roles.
 * Upgrades the user account in-place with zero data migration (preserves same UID and order history).
 */
export const reviewVerificationApplication = onCall<ReviewVerificationRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const reviewerUid = request.auth.uid;
  const reviewerRole = (request.auth.token.role as string | undefined) || '';

  if (!['manager', 'admin', 'security_admin'].includes(reviewerRole)) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_VERIFICATION_REVIEW_ATTEMPT',
      severity: 'HIGH',
      actorUid: reviewerUid,
      details: { attemptedRole: reviewerRole },
    });
    throw new HttpsError('permission-denied', 'Only managers or administrators can review verification applications.');
  }

  const { applicationId, decision, reviewNotes } = request.data || {};

  if (!applicationId || typeof applicationId !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid applicationId is required.');
  }

  if (!decision || !['APPROVED', 'REJECTED'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Decision must be APPROVED or REJECTED.');
  }

  const appRef = db.collection('verificationApplications').doc(applicationId);
  const now = admin.firestore.Timestamp.now();

  const reviewResult = await db.runTransaction(async (transaction) => {
    const appSnap = await transaction.get(appRef);
    if (!appSnap.exists) {
      throw new HttpsError('not-found', `Application ${applicationId} not found.`);
    }

    const appData = appSnap.data() as VerificationApplication;
    if (appData.status === 'APPROVED' || appData.status === 'REJECTED') {
      throw new HttpsError('failed-precondition', `Application has already been resolved as ${appData.status}.`);
    }

    const userRef = db.collection('users').doc(appData.userId);
    const userSnap = await transaction.get(userRef);

    if (decision === 'APPROVED') {
      const newAccountType: AccountType = appData.applicationType;
      const newStatus: VerificationStatus = 'VERIFIED';
      const newPriority: PriorityLevel = 2; // Priority level 2 for faculty & staff

      transaction.update(appRef, {
        status: 'APPROVED',
        reviewedAt: now,
        reviewerId: reviewerUid,
        reviewNotes: reviewNotes ? String(reviewNotes).slice(0, 200) : 'Approved by campus administrator',
      });

      if (userSnap.exists) {
        transaction.update(userRef, {
          accountType: newAccountType,
          verificationStatus: newStatus,
          priorityLevel: newPriority,
          isVerified: true,
          department: appData.department,
          designation: appData.designation,
          updatedAt: now,
        });
      }

      return {
        applicantUid: appData.userId,
        accountType: newAccountType,
        verificationStatus: newStatus,
        priorityLevel: newPriority,
        decision: 'APPROVED',
      };
    } else {
      transaction.update(appRef, {
        status: 'REJECTED',
        reviewedAt: now,
        reviewerId: reviewerUid,
        reviewNotes: reviewNotes ? String(reviewNotes).slice(0, 200) : 'Verification proof rejected',
      });

      if (userSnap.exists) {
        transaction.update(userRef, {
          verificationStatus: 'REJECTED',
          updatedAt: now,
        });
      }

      return {
        applicantUid: appData.userId,
        decision: 'REJECTED',
      };
    }
  });

  // Update Firebase Auth custom claims atomically
  if (reviewResult.decision === 'APPROVED' && reviewResult.applicantUid) {
    try {
      await syncUserCustomClaims(reviewResult.applicantUid, {
        accountType: reviewResult.accountType,
        verificationStatus: reviewResult.verificationStatus,
        priorityLevel: reviewResult.priorityLevel,
      });
    } catch (e) {
      console.error(`Error setting custom claims for ${reviewResult.applicantUid}:`, e);
    }
  }

  await logSecurityEvent({
    eventType: decision === 'APPROVED' ? 'VERIFICATION_APPLICATION_APPROVED' : 'VERIFICATION_APPLICATION_REJECTED',
    severity: 'INFO',
    actorUid: reviewerUid,
    details: {
      applicationId,
      applicantUid: reviewResult.applicantUid,
      decision,
    },
  });

  return {
    success: true,
    applicationId,
    decision,
    message: `Application ${applicationId} has been successfully ${decision.toLowerCase()}.`,
  };
});

/**
 * Platform 2.0 — Get Pending Verification Applications
 * 
 * Restricted to Manager, Admin, or Security Admin roles.
 */
export const getPendingVerificationApplications = onCall(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const reviewerRole = (request.auth.token.role as string | undefined) || '';
  if (!['manager', 'admin', 'security_admin'].includes(reviewerRole)) {
    throw new HttpsError('permission-denied', 'Staff permissions required to view applications.');
  }

  const snapshot = await db
    .collection('verificationApplications')
    .where('status', 'in', ['SUBMITTED', 'UNDER_REVIEW'])
    .orderBy('submittedAt', 'desc')
    .limit(50)
    .get();

  const applications = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    submittedAt: doc.data().submittedAt?.toDate?.()?.toISOString?.() || null,
  }));

  return {
    success: true,
    applications,
  };
});
