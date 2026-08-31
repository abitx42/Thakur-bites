import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

export { createCheckout } from './checkout';
export { updateOrderStatus } from './order_state';
export { assignStaffRole } from './auth_roles';
export { verifyPickup } from './pickup_verify';
export { createPaymentSession, verifyPayment, reconcileDailyLedger } from './payments';
