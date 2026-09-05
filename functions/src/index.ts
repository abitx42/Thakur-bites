import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

export { createCheckout } from './checkout';
export { updateOrderStatus, cancelOrder } from './order_state';
export { assignStaffRole } from './auth_roles';
export { verifyPickup, unlockOrderPickupVerification, getStudentPickupQr } from './pickup_verify';
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
export { createMealRating } from './ratings';
export { onOrderStatusNotification } from './notifications';
export { setSystemOperationalMode } from './kill_switch';
export { scheduledDailyReconciliation } from './reconciliation_cron';
export { getKitchenOrders, getPickupOrders, getCashierOrders } from './operational_views';
export { scheduledSecurityIntegrityMonitor, runSecurityIntegrityScan } from './integrity_monitor';
export { provisionUserProfile } from './user_provisioning';
export { reorderPreviousOrder } from './reorder';
export {
  submitVerificationApplication,
  reviewVerificationApplication,
  getPendingVerificationApplications,
} from './verification';
export {
  generateShiftPin,
  verifyShiftPin,
  listActiveShiftPins,
  revokeShiftPin,
} from './shift_pins';
export {
  getOwnerBusinessMetrics,
  updateOwnerFeatureFlags,
} from './owner_console';
export {
  getDeveloperTelemetry,
  simulatePermissionCheck,
  requestEmergencyStepUpChallenge,
  executeEmergencyOperationalAction,
} from './developer_cockpit';
export { updateAppVersionPolicy } from './version_policy';
export {
  toggleMenuItemAvailability,
  updateMenuItemDetails,
  upsertMenuItem,
  archiveMenuItem,
  bulkImportMenuItems,
  deleteMenuItemAdmin,
} from './menu_management';
export {
  getSecurityRateLimits,
  updateSecurityRateLimits,
} from './rate_limiter';
export {
  enrollMfaTotp,
  verifyAndEnableMfaTotp,
  createPrivilegedSession,
} from './mfa_totp';
export {
  createWorkstationInvite,
  enrollWorkstation,
  listRegisteredWorkstations,
  revokeWorkstation,
} from './workstation_binding';


