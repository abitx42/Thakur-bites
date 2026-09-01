import { UserRole } from './types';
import { HttpsError } from 'firebase-functions/v2/https';

export type SystemCapability =
  | 'view_kitchen_orders'
  | 'update_kitchen_status'
  | 'view_pickup_orders'
  | 'verify_pickup'
  | 'unlock_pickup'
  | 'view_cashier_orders'
  | 'record_cash_payment'
  | 'generate_shift_pin'
  | 'revoke_shift_pin'
  | 'process_refund'
  | 'cancel_staff_order'
  | 'adjust_inventory'
  | 'review_verification'
  | 'manage_staff_roles'
  | 'manage_platform_flags'
  | 'emergency_freeze'
  | 'view_telemetry';

const ROLE_CAPABILITY_MATRIX: Record<UserRole, Set<SystemCapability>> = {
  student: new Set([]),
  kitchen: new Set(['view_kitchen_orders', 'update_kitchen_status']),
  pickup: new Set(['view_pickup_orders', 'verify_pickup', 'unlock_pickup']),
  cashier: new Set(['view_cashier_orders', 'record_cash_payment']),
  manager: new Set([
    'view_kitchen_orders',
    'update_kitchen_status',
    'view_pickup_orders',
    'verify_pickup',
    'unlock_pickup',
    'view_cashier_orders',
    'record_cash_payment',
    'generate_shift_pin',
    'revoke_shift_pin',
    'process_refund',
    'cancel_staff_order',
    'adjust_inventory',
    'review_verification',
  ]),
  admin: new Set([
    'view_kitchen_orders',
    'update_kitchen_status',
    'view_pickup_orders',
    'verify_pickup',
    'unlock_pickup',
    'view_cashier_orders',
    'record_cash_payment',
    'generate_shift_pin',
    'revoke_shift_pin',
    'process_refund',
    'cancel_staff_order',
    'adjust_inventory',
    'review_verification',
    'manage_staff_roles',
    'manage_platform_flags',
  ]),
  security_admin: new Set([
    'view_kitchen_orders',
    'update_kitchen_status',
    'view_pickup_orders',
    'verify_pickup',
    'unlock_pickup',
    'view_cashier_orders',
    'record_cash_payment',
    'generate_shift_pin',
    'revoke_shift_pin',
    'process_refund',
    'cancel_staff_order',
    'adjust_inventory',
    'review_verification',
    'manage_staff_roles',
    'manage_platform_flags',
    'emergency_freeze',
    'view_telemetry',
  ]),
  system: new Set([
    'view_kitchen_orders',
    'update_kitchen_status',
    'view_pickup_orders',
    'verify_pickup',
    'unlock_pickup',
    'view_cashier_orders',
    'record_cash_payment',
    'generate_shift_pin',
    'revoke_shift_pin',
    'process_refund',
    'cancel_staff_order',
    'adjust_inventory',
    'review_verification',
    'manage_staff_roles',
    'manage_platform_flags',
    'emergency_freeze',
    'view_telemetry',
  ]),
};

/**
 * Checks if a given role possesses the requested capability.
 */
export function hasCapability(role: UserRole | string | undefined, capability: SystemCapability): boolean {
  if (!role) return false;
  const capabilities = ROLE_CAPABILITY_MATRIX[role as UserRole];
  return capabilities ? capabilities.has(capability) : false;
}

/**
 * Asserts that the calling role possesses the requested capability, throwing a 403 permission-denied error if not.
 */
export function assertCapability(role: UserRole | string | undefined, capability: SystemCapability): void {
  if (!hasCapability(role, capability)) {
    throw new HttpsError(
      'permission-denied',
      `Access denied. Role "${role || 'unauthenticated'}" lacks required capability "${capability}".`
    );
  }
}
