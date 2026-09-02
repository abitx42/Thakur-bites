import { UserRole } from './types';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Platform 2.0 Canonical System Capabilities
 * 
 * Every protected operation in the platform maps to a specific capability.
 * Functions and rules authorize based on capabilities, NOT ad-hoc role string lists.
 */
export type SystemCapability =
  // Operational Kitchen, Pickup & Cashier
  | 'view_kitchen_orders'
  | 'update_kitchen_status'
  | 'view_pickup_orders'
  | 'verify_pickup'
  | 'unlock_pickup'
  | 'view_cashier_orders'
  | 'record_cash_payment'
  // Shift PINs & Hardware Binding
  | 'manage_shift_pins'
  | 'generate_shift_pin'
  | 'revoke_shift_pin'
  // Financial & Order Governance
  | 'process_refund'
  | 'cancel_staff_order'
  | 'adjust_inventory'
  | 'manage_menu'
  // Identity, Staff & Platform Administration
  | 'review_verification'
  | 'manage_staff_roles'
  | 'manage_platform_flags'
  | 'view_business_analytics'
  // Developer & Engineering Operations
  | 'manage_version_policy'
  | 'view_telemetry'
  | 'run_diagnostics'
  | 'emergency_freeze';

/**
 * Base Admin Capabilities (Business Authority)
 */
const ADMIN_CAPABILITIES: SystemCapability[] = [
  'view_kitchen_orders',
  'update_kitchen_status',
  'view_pickup_orders',
  'verify_pickup',
  'unlock_pickup',
  'view_cashier_orders',
  'record_cash_payment',
  'manage_shift_pins',
  'generate_shift_pin',
  'revoke_shift_pin',
  'process_refund',
  'cancel_staff_order',
  'adjust_inventory',
  'manage_menu',
  'review_verification',
  'manage_staff_roles',
  'manage_platform_flags',
  'view_business_analytics',
  'manage_version_policy',
];

/**
 * Developer Capabilities = All Admin Capabilities + Engineering Authority
 */
const DEVELOPER_CAPABILITIES: SystemCapability[] = [
  ...ADMIN_CAPABILITIES,
  'view_telemetry',
  'run_diagnostics',
  'emergency_freeze',
];

/**
 * Canonical Role-to-Capability Mapping
 */
export const ROLE_CAPABILITY_MATRIX: Record<UserRole, Set<SystemCapability>> = {
  customer: new Set([]),
  student: new Set([]),
  kitchen: new Set(['view_kitchen_orders', 'update_kitchen_status']),
  pickup: new Set(['view_pickup_orders', 'verify_pickup', 'unlock_pickup']),
  cashier: new Set(['view_cashier_orders', 'record_cash_payment']),
  admin: new Set(ADMIN_CAPABILITIES),
  developer: new Set(DEVELOPER_CAPABILITIES),
  // Backward compatibility during active migration:
  manager: new Set(ADMIN_CAPABILITIES),
  security_admin: new Set(DEVELOPER_CAPABILITIES),
  system: new Set(DEVELOPER_CAPABILITIES),
};

/**
 * Checks whether a given role possesses a required capability.
 */
export function hasCapability(role: UserRole | string | undefined | null, capability: SystemCapability): boolean {
  if (!role) return false;
  const userRole = role as UserRole;
  const capabilities = ROLE_CAPABILITY_MATRIX[userRole];
  if (!capabilities) return false;
  return capabilities.has(capability);
}

/**
 * Enforces that a role possesses a required capability, failing closed with HttpsError('permission-denied').
 */
export function assertCapability(
  role: UserRole | string | undefined | null,
  capability: SystemCapability,
  errorMessage?: string
): void {
  if (!hasCapability(role, capability)) {
    throw new HttpsError(
      'permission-denied',
      errorMessage || `Access denied: Role '${role || 'unauthenticated'}' lacks required capability '${capability}'.`
    );
  }
}

/**
 * Canonical Administrative Role helper (Admin or Developer)
 */
export function isAdministrativeRole(role: UserRole | string | undefined | null): boolean {
  if (!role) return false;
  return role === 'admin' || role === 'developer' || role === 'manager' || role === 'security_admin' || role === 'system';
}

/**
 * Canonical Developer Role helper (Developer or System)
 */
export function isDeveloperRole(role: UserRole | string | undefined | null): boolean {
  if (!role) return false;
  return role === 'developer' || role === 'security_admin' || role === 'system';
}

/**
 * Canonical Operational Staff Role helper (Any staff or administrative role)
 */
export function isOperationalStaffRole(role: UserRole | string | undefined | null): boolean {
  if (!role) return false;
  return (
    role === 'kitchen' ||
    role === 'pickup' ||
    role === 'cashier' ||
    isAdministrativeRole(role)
  );
}
