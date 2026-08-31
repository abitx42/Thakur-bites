import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { OrderStatus } from './types';
import { logSecurityEvent } from './security_logger';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface NotificationPayload {
  title: string;
  body: string;
  orderId: string;
  tokenNumber: string;
  status: OrderStatus;
  clickAction: string;
}

/**
 * Constructs user-facing push notification payloads based on order state transitions
 */
export function buildOrderNotification(
  orderId: string,
  tokenNumber: string,
  fromStatus: OrderStatus,
  toStatus: OrderStatus
): NotificationPayload | null {
  if (fromStatus === toStatus) return null;

  switch (toStatus) {
    case 'confirmed':
      return {
        title: '✅ Order Placed Successfully!',
        body: `Your order #${tokenNumber} has been received and queued in the canteen kitchen.`,
        orderId,
        tokenNumber,
        status: toStatus,
        clickAction: '/ticket',
      };
    case 'preparing':
      return {
        title: '🍳 Cooking in Progress!',
        body: `Order #${tokenNumber} is now being prepared fresh on the hot station.`,
        orderId,
        tokenNumber,
        status: toStatus,
        clickAction: '/ticket',
      };
    case 'ready':
      return {
        title: '🔔 Your Food is Ready for Pickup!',
        body: `Order #${tokenNumber} is ready at the pickup counter! Please present your QR code or PIN.`,
        orderId,
        tokenNumber,
        status: toStatus,
        clickAction: '/ticket',
      };
    case 'collected':
      return {
        title: '✨ Order Collected — Enjoy your meal!',
        body: `Hope you enjoy your food! Please take 5 seconds to rate your dishes.`,
        orderId,
        tokenNumber,
        status: toStatus,
        clickAction: '/ticket',
      };
    case 'cancelled':
      return {
        title: '❌ Order Cancelled',
        body: `Order #${tokenNumber} was cancelled. If debited, your refund has been processed.`,
        orderId,
        tokenNumber,
        status: toStatus,
        clickAction: '/ticket',
      };
    default:
      return null;
  }
}

/**
 * Real-time Firestore Trigger: Dispatches Push Notifications on Order Status Changes
 */
export const onOrderStatusNotification = onDocumentUpdated('orders/{orderId}', async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();

  if (!beforeData || !afterData) return;

  const fromStatus = beforeData.status as OrderStatus;
  const toStatus = afterData.status as OrderStatus;
  const orderId = event.params.orderId;
  const studentId = afterData.studentId;
  const tokenNumber = afterData.tokenNumber || 'TB-XXX';

  const notification = buildOrderNotification(orderId, tokenNumber, fromStatus, toStatus);
  if (!notification) return;

  // 1. Record notification in student notifications subcollection
  const notifRef = db.collection('students').doc(studentId).collection('notifications').doc();
  await notifRef.set({
    notificationId: notifRef.id,
    orderId,
    tokenNumber,
    status: toStatus,
    title: notification.title,
    body: notification.body,
    createdAt: admin.firestore.Timestamp.now(),
    isRead: false,
  });

  // 2. Fetch student FCM Device Tokens
  try {
    const studentDoc = await db.collection('students').doc(studentId).get();
    const fcmTokens: string[] = studentDoc.data()?.fcmTokens || [];

    if (fcmTokens.length > 0) {
      await admin.messaging().sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          orderId,
          tokenNumber,
          status: toStatus,
          clickAction: notification.clickAction,
        },
        android: {
          priority: toStatus === 'ready' ? 'high' : 'normal',
          notification: {
            sound: 'default',
            channelId: 'order_updates',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      });
    }
  } catch (err: any) {
    await logSecurityEvent({
      eventType: 'FCM_NOTIFICATION_FAILURE',
      severity: 'LOW',
      actorUid: studentId,
      details: { orderId, error: err.message },
    });
  }
});
