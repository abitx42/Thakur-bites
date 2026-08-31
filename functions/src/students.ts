import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface ProvisionStudentRequest {
  name: string;
  department?: string;
  year?: string;
  phone?: string;
}

export interface StudentProfileDoc {
  uid: string;
  email: string;
  name: string;
  department: string;
  year: string;
  phone: string;
  isVerified: boolean;
  accountDisabled: boolean;
  totalOrders: number;
  role: 'student';
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

/**
 * Authoritative Backend Student Profile Provisioner (P0 Hardened).
 * Prevents client from manufacturing authoritative fields (isVerified, role, accountDisabled, totalOrders).
 */
export const provisionStudentProfile = onCall<ProvisionStudentRequest>(async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const studentId = request.auth.uid;
  const email = (request.auth.token.email as string | undefined)?.toLowerCase();

  if (!email) {
    throw new HttpsError('invalid-argument', 'Authenticated user must have an email address.');
  }

  const isCollegeDomain = email.endsWith('@tcetmumbai.in') || email.endsWith('@thakureducation.org');
  if (!isCollegeDomain) {
    throw new HttpsError(
      'permission-denied',
      'Account creation is restricted to authorized college domain accounts (@tcetmumbai.in or @thakureducation.org).'
    );
  }

  if (request.auth.token.email_verified !== true && process.env.NODE_ENV !== 'test') {
    throw new HttpsError('permission-denied', 'Institutional email must be verified before provisioning profile.');
  }

  await enforceRateLimit(studentId, 'role_assignment');

  const { name = 'TCET Student', department = 'IT', year = 'SE', phone = '' } = request.data || {};

  const cleanName = String(name).trim().slice(0, 100) || 'TCET Student';
  const cleanDept = String(department).trim().slice(0, 50) || 'IT';
  const cleanYear = String(year).trim().slice(0, 10) || 'SE';
  const cleanPhone = String(phone).trim().slice(0, 20);

  const studentRef = db.collection('students').doc(studentId);
  const now = admin.firestore.Timestamp.now();

  const studentData: StudentProfileDoc = {
    uid: studentId,
    email,
    name: cleanName,
    department: cleanDept,
    year: cleanYear,
    phone: cleanPhone,
    isVerified: true,
    accountDisabled: false,
    totalOrders: 0,
    role: 'student',
    createdAt: now,
    updatedAt: now,
  };

  // Safe merge if already exists to preserve totalOrders
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(studentRef);
    if (snap.exists) {
      transaction.update(studentRef, {
        name: cleanName,
        department: cleanDept,
        year: cleanYear,
        phone: cleanPhone,
        updatedAt: now,
      });
    } else {
      transaction.set(studentRef, studentData);
    }
  });

  await logSecurityEvent({
    eventType: 'STUDENT_PROFILE_PROVISIONED',
    severity: 'INFO',
    actorUid: studentId,
    details: { email, name: cleanName, department: cleanDept },
  });

  return {
    success: true,
    studentId,
    email,
    name: cleanName,
    isVerified: true,
  };
});
