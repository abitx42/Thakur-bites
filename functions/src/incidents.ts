import { randomUUID } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  UserRole,
  IncidentDoc,
  IncidentSeverity,
  IncidentStatus,
  IncidentTimelineEntry,
  IncidentPostmortem,
} from './types';
import { enforceAppCheck } from './app_check';
import { assertCapability } from './authorization_policy';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * ═══════════════════════════════════════════════════════════════════
 * PHASE 7.6: PRODUCTION INCIDENT LIFECYCLE & POSTMORTEM ENGINE
 * ═══════════════════════════════════════════════════════════════════
 * State Machine:
 * DETECTED -> ACKNOWLEDGED -> INVESTIGATING -> MITIGATED -> RECOVERED -> POST_INCIDENT_REVIEW
 */

export const createProductionIncident = onCall<{
  title: string;
  severity: IncidentSeverity;
  circuitBreakerMode: string;
  relatedAnomalyIds?: string[];
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  assertCapability(
    callerRole,
    'view_business_analytics',
    'Permission denied: Only managers or administrators can create incident records.'
  );

  const { title, severity, circuitBreakerMode, relatedAnomalyIds = [] } = request.data;
  if (!title || typeof title !== 'string' || title.trim().length < 5) {
    throw new HttpsError('invalid-argument', 'Title must be at least 5 characters long.');
  }

  const now = Timestamp.now();
  const incidentId = `INC_${randomUUID()}`;

  const timeline: IncidentTimelineEntry[] = [
    {
      timestamp: now,
      actor: request.auth.uid,
      action: 'INCIDENT_CREATED',
      notes: `Incident initiated with severity ${severity}. Mode: ${circuitBreakerMode}`,
    },
  ];

  const doc: IncidentDoc = {
    incidentId,
    title: title.trim(),
    severity,
    status: 'DETECTED',
    detectedAt: now,
    detectedBy: request.auth.uid,
    circuitBreakerMode,
    relatedAnomalyIds,
    timeline,
    actionsTaken: ['Automated notification dispatched to staff channel'],
  };

  await db.collection('incidents').doc(incidentId).set(doc);

  await logSecurityEvent({
    eventType: 'PRODUCTION_INCIDENT_CREATED',
    severity: severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    actorUid: request.auth.uid,
    details: { incidentId, title: title.trim(), severity, circuitBreakerMode },
  });

  return {
    success: true,
    incidentId,
    status: doc.status,
    detectedAt: now.toDate().toISOString(),
  };
});

export const updateIncidentStatus = onCall<{
  incidentId: string;
  status: IncidentStatus;
  actionNote: string;
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'security_admin' && callerRole !== 'admin' && (callerRole as string) !== 'developer') {
    throw new HttpsError('permission-denied', 'Permission denied: Only Security Admins can advance incident status.');
  }

  const { incidentId, status, actionNote } = request.data;
  const docRef = db.collection('incidents').doc(incidentId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Incident ${incidentId} not found.`);
  }

  const now = Timestamp.now();
  const timelineEntry: IncidentTimelineEntry = {
    timestamp: now,
    actor: request.auth.uid,
    action: `STATUS_UPDATED_TO_${status}`,
    notes: actionNote,
  };

  const updates: Record<string, any> = {
    status,
    timeline: admin.firestore.FieldValue.arrayUnion(timelineEntry),
    actionsTaken: admin.firestore.FieldValue.arrayUnion(actionNote),
  };

  if (status === 'POST_INCIDENT_REVIEW') {
    updates.closedAt = now;
  }

  await docRef.update(updates);

  return {
    success: true,
    incidentId,
    status,
    updatedAt: now.toDate().toISOString(),
  };
});

export const recordPostmortemReview = onCall<{
  incidentId: string;
  rootCause: string;
  preventiveActions: string[];
}>(async (request) => {
  enforceAppCheck(request);
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  const callerRole = (request.auth.token.role as UserRole) || 'student';
  if (callerRole !== 'security_admin' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Permission denied: Only Admins can submit postmortem reviews.');
  }

  const { incidentId, rootCause, preventiveActions } = request.data;
  if (!rootCause || rootCause.trim().length < 10) {
    throw new HttpsError('invalid-argument', 'Detailed rootCause (at least 10 chars) is required.');
  }
  if (!Array.isArray(preventiveActions) || preventiveActions.length === 0) {
    throw new HttpsError('invalid-argument', 'At least 1 preventive action item is required.');
  }

  const now = Timestamp.now();
  const postmortem: IncidentPostmortem = {
    rootCause: rootCause.trim(),
    preventiveActions,
    reviewedBy: request.auth.uid,
    reviewedAt: now,
  };

  await db.collection('incidents').doc(incidentId).update({
    postmortem,
    status: 'POST_INCIDENT_REVIEW',
    closedAt: now,
  });

  return {
    success: true,
    incidentId,
    status: 'POST_INCIDENT_REVIEW',
    reviewedAt: now.toDate().toISOString(),
  };
});
