import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

export { createCheckout } from './checkout';
export { updateOrderStatus } from './order_state';
export { assignStaffRole } from './auth_roles';
export { verifyPickup, unlockOrderPickupVerification } from './pickup_verify';
export {
  createPaymentSession,
  verifyPayment,
  recordCashPayment,
  handlePaymentWebhook,
  reconcileDailyLedger,
  cancelOrExpirePaymentSession,
} from './payments';
export { processOrderRefund } from './refunds';
export { adjustInventoryStock } from './inventory';
