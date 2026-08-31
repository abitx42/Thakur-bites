import { AccountType, VerificationStatus, PriorityLevel } from './types';

export interface IdentityClassification {
  accountType: AccountType;
  verificationStatus: VerificationStatus;
  priorityLevel: PriorityLevel;
  identityHints: {
    isInstitutionalEmail: boolean;
    domain: string;
    possibleStudentId: boolean;
  };
}

/**
 * Pure function that classifies a user's identity based on their email.
 * This is a HINT — the backend determines the final role.
 * The client cannot override this classification.
 */
export function classifyIdentity(email: string): IdentityClassification {
  const cleanEmail = email.trim().toLowerCase();
  const domain = cleanEmail.split('@').pop() || '';
  const localPart = cleanEmail.split('@')[0] || '';

  // TCET Student: numeric prefix in local part + @tcetmumbai.in
  if (domain === 'tcetmumbai.in') {
    const hasNumericPrefix = /^\d+/.test(localPart);
    return {
      accountType: 'STUDENT',
      verificationStatus: hasNumericPrefix ? 'VERIFIED' : 'PENDING',
      priorityLevel: 1,
      identityHints: {
        isInstitutionalEmail: true,
        domain,
        possibleStudentId: hasNumericPrefix,
      },
    };
  }

  // Thakur Education org: likely college staff or faculty
  if (domain === 'thakureducation.org') {
    return {
      accountType: 'COLLEGE_STAFF',
      verificationStatus: 'PENDING',
      priorityLevel: 1, // Starts as normal, upgraded after verification
      identityHints: {
        isInstitutionalEmail: true,
        domain,
        possibleStudentId: false,
      },
    };
  }

  // All other domains: Visitor
  return {
    accountType: 'VISITOR',
    verificationStatus: 'NOT_REQUIRED',
    priorityLevel: 0,
    identityHints: {
      isInstitutionalEmail: false,
      domain,
      possibleStudentId: false,
    },
  };
}
