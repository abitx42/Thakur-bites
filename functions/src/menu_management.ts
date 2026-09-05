import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { assertCapability } from './authorization_policy';
import { assertActiveWorkstationSession } from './shift_pins';
import { UserRole } from './types';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export interface ToggleMenuItemAvailabilityRequest {
  itemId: string;
  available: boolean;
}

export interface UpdateMenuItemDetailsRequest {
  itemId: string;
  details: {
    name?: string;
    price?: number;
    category?: string;
    prepMinutes?: number;
    batchDate?: string;
    type?: 'instant' | 'cooked';
  };
}

export interface UpsertMenuItemRequest {
  itemData: {
    id?: string;
    name: string;
    price: number;
    category: string;
    type: 'instant' | 'cooked';
    prepMinutes?: number;
    stockCount?: number;
    batchDate?: string;
    available?: boolean;
    imageUrl?: string;
    iconKey?: string;
  };
}

export interface DeleteMenuItemRequest {
  itemId: string;
}

/**
 * 1. Authoritative Menu Item Availability Toggle
 * Restricted strictly to staff roles possessing the 'manage_menu' capability.
 */
export const toggleMenuItemAvailability = onCall<ToggleMenuItemAvailabilityRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  try {
    assertCapability(actorRole, 'manage_menu');
  } catch (_) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_MENU_MODIFICATION',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole, action: 'toggle_availability' },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators can update menu item availability.');
  }

  await enforceRateLimit(request.auth.uid, 'menu_management');

  const { itemId, available } = request.data || {};
  if (!itemId || typeof itemId !== 'string' || itemId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid itemId (max 128 characters) is required.');
  }
  if (typeof available !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Boolean availability state is required.');
  }

  const itemRef = db.collection('menuItems').doc(itemId);
  const snap = await itemRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Menu item ${itemId} not found.`);
  }

  await itemRef.update({
    available,
    updatedAt: admin.firestore.Timestamp.now(),
    updatedBy: request.auth.uid,
  });

  await logSecurityEvent({
    eventType: 'MENU_ITEM_AVAILABILITY_CHANGED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: { itemId, available, role: actorRole },
  });

  return { success: true, itemId, available };
});

/**
 * 2. Authoritative Menu Item Details Update
 */
export const updateMenuItemDetails = onCall<UpdateMenuItemDetailsRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  try {
    assertCapability(actorRole, 'manage_menu');
  } catch (_) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_MENU_MODIFICATION',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole, action: 'update_details' },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators can modify menu items.');
  }

  await enforceRateLimit(request.auth.uid, 'menu_management');

  const { itemId, details } = request.data || {};
  if (!itemId || typeof itemId !== 'string' || itemId.length > 128) {
    throw new HttpsError('invalid-argument', 'Valid itemId is required.');
  }
  if (!details || typeof details !== 'object') {
    throw new HttpsError('invalid-argument', 'Details payload is required.');
  }

  const updates: Record<string, any> = {
    updatedAt: admin.firestore.Timestamp.now(),
    updatedBy: request.auth.uid,
  };

  if (details.name !== undefined) {
    const name = String(details.name).trim();
    if (name.length < 2 || name.length > 100) {
      throw new HttpsError('invalid-argument', 'Item name must be 2-100 characters.');
    }
    updates.name = name;
  }

  if (details.price !== undefined) {
    const price = Number(details.price);
    if (!Number.isFinite(price) || price < 0 || price > 10000) {
      throw new HttpsError('invalid-argument', 'Valid price between ₹0 and ₹10,000 is required.');
    }
    updates.price = price;
  }

  if (details.category !== undefined) {
    updates.category = String(details.category).trim().slice(0, 50);
  }

  if (details.prepMinutes !== undefined) {
    const prep = Math.max(0, Math.min(180, Number(details.prepMinutes) || 0));
    updates.prepMinutes = prep;
  }

  if (details.batchDate !== undefined) {
    updates.batchDate = String(details.batchDate).trim().slice(0, 30);
  }

  if (details.type !== undefined) {
    if (!['instant', 'cooked'].includes(details.type)) {
      throw new HttpsError('invalid-argument', 'Item type must be either "instant" or "cooked".');
    }
    updates.type = details.type;
  }

  const itemRef = db.collection('menuItems').doc(itemId);
  const snap = await itemRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Menu item ${itemId} not found.`);
  }

  await itemRef.update(updates);

  await logSecurityEvent({
    eventType: 'MENU_ITEM_DETAILS_UPDATED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: { itemId, updates, role: actorRole },
  });

  return { success: true, itemId };
});

/**
 * 3. Authoritative Upsert (Add / Overwrite) Menu Item
 */
export const upsertMenuItem = onCall<UpsertMenuItemRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  try {
    assertCapability(actorRole, 'manage_menu');
  } catch (_) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_MENU_MODIFICATION',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole, action: 'upsert_item' },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators can add or overwrite menu items.');
  }

  await enforceRateLimit(request.auth.uid, 'menu_management');

  const { itemData } = request.data || {};
  if (!itemData || typeof itemData !== 'object') {
    throw new HttpsError('invalid-argument', 'itemData payload is required.');
  }

  const name = String(itemData.name || '').trim();
  if (name.length < 2 || name.length > 100) {
    throw new HttpsError('invalid-argument', 'Item name must be 2-100 characters.');
  }

  const price = Number(itemData.price);
  if (!Number.isFinite(price) || price < 0 || price > 10000) {
    throw new HttpsError('invalid-argument', 'Valid price between ₹0 and ₹10,000 is required.');
  }

  const type = itemData.type === 'instant' ? 'instant' : 'cooked';
  const isInstant = type === 'instant';
  const initialStock = isInstant ? Math.max(0, Number(itemData.stockCount || 0)) : 100;
  const docId = (itemData.id || name.toLowerCase().replace(/[^a-z0-9]/g, '_')).slice(0, 128);

  const itemRef = db.collection('menuItems').doc(docId);
  const existingSnap = await itemRef.get();
  const existingData = existingSnap.exists ? existingSnap.data()! : {};

  const stockOnHand = existingSnap.exists && typeof existingData.stockOnHand === 'number'
    ? existingData.stockOnHand
    : initialStock;
  const reservedStock = existingSnap.exists && typeof existingData.reservedStock === 'number'
    ? existingData.reservedStock
    : 0;

  const docPayload = {
    name,
    price,
    category: String(itemData.category || 'General').trim().slice(0, 50),
    type,
    prepMinutes: Math.max(0, Math.min(180, Number(itemData.prepMinutes) || 0)),
    stockCount: stockOnHand,
    stockOnHand,
    reservedStock,
    availableStock: Math.max(0, stockOnHand - reservedStock),
    batchDate: String(itemData.batchDate || '').trim().slice(0, 30),
    available: itemData.available !== undefined ? itemData.available : (isInstant ? stockOnHand > 0 : true),
    imageUrl: String(itemData.imageUrl || '').slice(0, 500),
    iconKey: String(itemData.iconKey || itemData.category || '').slice(0, 50),
    updatedAt: admin.firestore.Timestamp.now(),
    updatedBy: request.auth.uid,
    createdAt: existingData.createdAt || admin.firestore.Timestamp.now(),
  };

  await itemRef.set(docPayload, { merge: true });

  await logSecurityEvent({
    eventType: 'MENU_ITEM_UPSERTED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: { itemId: docId, name, price, role: actorRole },
  });

  return { success: true, itemId: docId };
});

/**
 * 4. Authoritative Menu Item Deletion
 */
export const deleteMenuItemAdmin = onCall<DeleteMenuItemRequest>(async (request) => {
  enforceAppCheck(request);

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Staff authentication is required.');
  }

  await assertActiveWorkstationSession(request.auth.uid, request.auth.token);

  const actorRole = (request.auth.token.role as UserRole) || 'student';
  try {
    assertCapability(actorRole, 'manage_menu');
  } catch (_) {
    await logSecurityEvent({
      eventType: 'UNAUTHORIZED_MENU_MODIFICATION',
      severity: 'HIGH',
      actorUid: request.auth.uid,
      details: { role: actorRole, action: 'delete_item' },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators can delete menu items.');
  }

  await enforceRateLimit(request.auth.uid, 'menu_management');

  const { itemId } = request.data || {};
  if (!itemId || typeof itemId !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid itemId is required.');
  }

  const itemRef = db.collection('menuItems').doc(itemId);
  await itemRef.delete();

  await logSecurityEvent({
    eventType: 'MENU_ITEM_DELETED',
    severity: 'MEDIUM',
    actorUid: request.auth.uid,
    details: { itemId, role: actorRole },
  });

  return { success: true, itemId };
});
