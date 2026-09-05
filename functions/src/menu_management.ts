import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { enforceAppCheck } from './app_check';
import { enforceRateLimit } from './rate_limiter';
import { logSecurityEvent } from './security_logger';
import { assertCapability } from './authorization_policy';
import { assertActiveWorkstationSession } from './shift_pins';
import { UserRole, ParentCategory, DietaryType } from './types';

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
    parentCategory?: ParentCategory;
    category?: string;
    subCategory?: string;
    dietaryType?: DietaryType;
    description?: string;
    prepMinutes?: number;
    batchDate?: string;
    type?: 'instant' | 'cooked';
    displayOrder?: number;
  };
}

export interface UpsertMenuItemRequest {
  itemData: {
    id?: string;
    name: string;
    price: number;
    parentCategory?: ParentCategory;
    category: string;
    subCategory?: string;
    dietaryType?: DietaryType;
    description?: string;
    type: 'instant' | 'cooked';
    prepMinutes?: number;
    stockCount?: number;
    batchDate?: string;
    available?: boolean;
    isArchived?: boolean;
    imageUrl?: string;
    iconKey?: string;
    displayOrder?: number;
  };
}

export interface ArchiveMenuItemRequest {
  itemId: string;
  reason?: string;
}

export interface BulkImportMenuItemDto {
  id?: string;
  name: string;
  price: number;
  parentCategory?: ParentCategory;
  category: string;
  subCategory?: string;
  dietaryType?: DietaryType;
  description?: string;
  type?: 'instant' | 'cooked';
  prepMinutes?: number;
  stockCount?: number;
  available?: boolean;
  imageUrl?: string;
  iconKey?: string;
  displayOrder?: number;
}

export interface BulkImportMenuItemsRequest {
  items: BulkImportMenuItemDto[];
  overwriteExisting?: boolean;
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

  if (details.parentCategory !== undefined) {
    if (!['FOOD', 'SNACKS', 'BEVERAGES', 'DESSERTS'].includes(details.parentCategory)) {
      throw new HttpsError('invalid-argument', 'Invalid parentCategory.');
    }
    updates.parentCategory = details.parentCategory;
  }

  if (details.subCategory !== undefined) {
    updates.subCategory = String(details.subCategory).trim().slice(0, 50);
  }

  if (details.dietaryType !== undefined) {
    if (!['VEG', 'NON_VEG', 'EGG', 'JAIN_AVAILABLE'].includes(details.dietaryType)) {
      throw new HttpsError('invalid-argument', 'Invalid dietaryType.');
    }
    updates.dietaryType = details.dietaryType;
  }

  if (details.description !== undefined) {
    updates.description = String(details.description).trim().slice(0, 500);
  }

  if (details.displayOrder !== undefined) {
    updates.displayOrder = Number(details.displayOrder) || 0;
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

  const oldData = snap.data() || {};
  if (details.price !== undefined && oldData.price !== undefined && Number(details.price) !== Number(oldData.price)) {
    await logSecurityEvent({
      eventType: 'MENU_ITEM_PRICE_CHANGED',
      severity: 'INFO',
      actorUid: request.auth.uid,
      details: { itemId, oldPrice: oldData.price, newPrice: details.price, role: actorRole },
    });
  }

  if (updates.name) {
    updates.normalizedName = updates.name.toLowerCase();
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

  const category = String(itemData.category || 'General').trim().slice(0, 50);
  const parentCategory: ParentCategory = ['FOOD', 'SNACKS', 'BEVERAGES', 'DESSERTS'].includes(itemData.parentCategory as any)
    ? (itemData.parentCategory as ParentCategory)
    : (['drinks', 'beverage'].includes(category.toLowerCase()) ? 'BEVERAGES' : 'FOOD');

  const subCategory = String(itemData.subCategory || category).trim().slice(0, 50);
  const dietaryType: DietaryType = ['VEG', 'NON_VEG', 'EGG', 'JAIN_AVAILABLE'].includes(itemData.dietaryType as any)
    ? (itemData.dietaryType as DietaryType)
    : 'VEG';

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

  const isAvailable = itemData.available !== undefined ? itemData.available : (isInstant ? stockOnHand > 0 : true);

  const docPayload = {
    name,
    normalizedName: name.toLowerCase(),
    price,
    parentCategory,
    category,
    subCategory,
    dietaryType,
    description: String(itemData.description || '').trim().slice(0, 500),
    type,
    prepMinutes: Math.max(0, Math.min(180, Number(itemData.prepMinutes) || 0)),
    stockCount: stockOnHand,
    stockOnHand,
    reservedStock,
    availableStock: Math.max(0, stockOnHand - reservedStock),
    batchDate: String(itemData.batchDate || '').trim().slice(0, 30),
    available: isAvailable,
    isArchived: itemData.isArchived === true,
    availabilityStatus: isAvailable ? 'AVAILABLE' : 'SOLD_OUT',
    imageUrl: String(itemData.imageUrl || '').slice(0, 500),
    iconKey: String(itemData.iconKey || itemData.category || '').slice(0, 50),
    displayOrder: typeof itemData.displayOrder === 'number' ? itemData.displayOrder : (existingData.displayOrder || 0),
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
 * 4. Authoritative Menu Item Soft Archival (Safe Alternative to Hard Delete)
 */
export const archiveMenuItem = onCall<ArchiveMenuItemRequest>(async (request) => {
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
      details: { role: actorRole, action: 'archive_item' },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators can archive menu items.');
  }

  await enforceRateLimit(request.auth.uid, 'menu_management');

  const { itemId, reason } = request.data || {};
  if (!itemId || typeof itemId !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid itemId is required.');
  }

  const itemRef = db.collection('menuItems').doc(itemId);
  const snap = await itemRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Menu item ${itemId} not found.`);
  }

  await itemRef.update({
    isArchived: true,
    available: false,
    availabilityStatus: 'UNAVAILABLE',
    archiveReason: String(reason || 'Administrative Archival').slice(0, 200),
    archivedAt: admin.firestore.Timestamp.now(),
    archivedBy: request.auth.uid,
    updatedAt: admin.firestore.Timestamp.now(),
    updatedBy: request.auth.uid,
  });

  await logSecurityEvent({
    eventType: 'MENU_ITEM_ARCHIVED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: { itemId, role: actorRole, reason },
  });

  return { success: true, itemId, isArchived: true };
});

/**
 * 5. Authoritative Bulk Import of Menu Catalog
 */
export const bulkImportMenuItems = onCall<BulkImportMenuItemsRequest>(async (request) => {
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
      details: { role: actorRole, action: 'bulk_import' },
    });
    throw new HttpsError('permission-denied', 'Only managers and administrators can bulk import menu items.');
  }

  await enforceRateLimit(request.auth.uid, 'menu_management');

  const { items, overwriteExisting = false } = request.data || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'An array of items to import is required.');
  }
  if (items.length > 200) {
    throw new HttpsError('invalid-argument', 'Bulk import batch size cannot exceed 200 items.');
  }

  const now = admin.firestore.Timestamp.now();
  const batch = db.batch();
  const processedIds: string[] = [];
  const seenNames = new Set<string>();

  for (let idx = 0; idx < items.length; idx++) {
    const raw = items[idx];
    if (!raw || typeof raw !== 'object') {
      throw new HttpsError('invalid-argument', `Item at index ${idx} is invalid.`);
    }

    const name = String(raw.name || '').trim();
    if (name.length < 2 || name.length > 100) {
      throw new HttpsError('invalid-argument', `Item at index ${idx} has invalid name (must be 2–100 chars).`);
    }

    const lowerName = name.toLowerCase();
    if (seenNames.has(lowerName)) {
      throw new HttpsError('invalid-argument', `Duplicate item name "${name}" in import batch.`);
    }
    seenNames.add(lowerName);

    const price = Number(raw.price);
    if (!Number.isFinite(price) || price <= 0 || price > 10000) {
      throw new HttpsError('invalid-argument', `Item "${name}" has invalid price ₹${price} (must be > 0 and <= ₹10,000).`);
    }

    const category = String(raw.category || 'General').trim().slice(0, 50);
    const parentCategory: ParentCategory = ['FOOD', 'SNACKS', 'BEVERAGES', 'DESSERTS'].includes(raw.parentCategory as any)
      ? (raw.parentCategory as ParentCategory)
      : (['drinks', 'beverage'].includes(category.toLowerCase()) ? 'BEVERAGES' : 'FOOD');

    const subCategory = String(raw.subCategory || category).trim().slice(0, 50);
    const dietaryType: DietaryType = ['VEG', 'NON_VEG', 'EGG', 'JAIN_AVAILABLE'].includes(raw.dietaryType as any)
      ? (raw.dietaryType as DietaryType)
      : 'VEG';

    const type = raw.type === 'instant' ? 'instant' : 'cooked';
    const isInstant = type === 'instant';
    const stockCount = isInstant ? Math.max(0, Number(raw.stockCount || 50)) : 100;
    const docId = (raw.id || name.toLowerCase().replace(/[^a-z0-9]/g, '_')).slice(0, 128);

    const itemRef = db.collection('menuItems').doc(docId);
    batch.set(itemRef, {
      id: docId,
      name,
      normalizedName: lowerName,
      price,
      parentCategory,
      category,
      subCategory,
      dietaryType,
      description: String(raw.description || '').trim().slice(0, 500),
      type,
      prepMinutes: Math.max(0, Math.min(180, Number(raw.prepMinutes) || (isInstant ? 0 : 8))),
      available: raw.available !== undefined ? Boolean(raw.available) : true,
      isArchived: false,
      availabilityStatus: 'AVAILABLE',
      stockOnHand: stockCount,
      reservedStock: 0,
      availableStock: stockCount,
      stockCount,
      imageUrl: String(raw.imageUrl || '').slice(0, 500),
      iconKey: String(raw.iconKey || category).slice(0, 50),
      displayOrder: typeof raw.displayOrder === 'number' ? raw.displayOrder : idx * 10,
      createdAt: now,
      updatedAt: now,
      updatedBy: request.auth.uid,
    }, { merge: !overwriteExisting });

    processedIds.push(docId);
  }

  await batch.commit();

  await logSecurityEvent({
    eventType: 'MENU_BULK_IMPORTED',
    severity: 'INFO',
    actorUid: request.auth.uid,
    details: { count: processedIds.length, role: actorRole },
  });

  return { success: true, count: processedIds.length, itemIds: processedIds };
});

/**
 * 6. Authoritative Menu Item Deletion (Retained with deprecation warning)
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
