// Firebase JS SDK Configuration & Real-Time Firestore Service for Staff Dashboard
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot, 
  getDocFromServer,
  writeBatch,
  query, 
  orderBy, 
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { publicConfig } from './publicConfig.js';

// Project credentials matching Flutter app
const firebaseConfig = {
  apiKey: "AIzaSyBK6j2OYH2WdBC2c4HrOvAmqeBzG0ZkGbc",
  authDomain: "adi-thakur-bite.firebaseapp.com",
  projectId: "adi-thakur-bite",
  storageBucket: "adi-thakur-bite.firebasestorage.app",
  messagingSenderId: "391012293021",
  appId: "1:391012293021:web:72dfeb37658ab087c97774",
  measurementId: "G-XRRX9EBZQ8"
};

const emulatorConfig = publicConfig.functionsEmulator;
const useLocalFunctionsEmulator = emulatorConfig !== null && emulatorConfig !== undefined;
const isLocalDev = typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
if (useLocalFunctionsEmulator && (!isLocalDev || typeof emulatorConfig !== 'object' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(emulatorConfig.host) ||
    !Number.isInteger(emulatorConfig.port) || emulatorConfig.port < 1 || emulatorConfig.port > 65535)) {
  throw new Error('FUNCTIONS_EMULATOR_CONFIGURATION_INVALID: Explicit loopback host/port and a local browser are required.');
}
const appCheckSiteKey = typeof publicConfig.appCheckSiteKey === 'string' ? publicConfig.appCheckSiteKey.trim() : '';
if (!appCheckSiteKey && !useLocalFunctionsEmulator) {
  throw new Error('APP_CHECK_PUBLIC_SITE_KEY_REQUIRED: Configure js/publicConfig.js before deploying the staff/enrolment portal.');
}

// App Check must initialize before Auth/Firestore/Functions so the SDK attaches
// verified app tokens to both authenticated staff and unauthenticated enrolment.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const appCheck = appCheckSiteKey ? initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(appCheckSiteKey),
  isTokenAutoRefreshEnabled: true,
}) : null;
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');
export const storage = getStorage(app);
export { ref, uploadBytes, getDownloadURL };

if (useLocalFunctionsEmulator) {
  connectFunctionsEmulator(functions, emulatorConfig.host, emulatorConfig.port);
}


// ─── Staff Authentication & Role Management ─────────────────────────

const STAFF_ROLES = new Set([
  'kitchen', 'pickup', 'cashier', 'manager', 'admin', 'developer', 'security_admin', 'system'
]);

async function resolveStaffRole(user) {
  const tokenResult = await user.getIdTokenResult(true);
  const claims = tokenResult.claims || {};
  // A present customer/invalid role must not be replaced by an older staff record.
  if (Object.prototype.hasOwnProperty.call(claims, 'role')) {
    return STAFF_ROLES.has(claims.role) ? claims.role : null;
  }
  // This server-owned record supports staff awaiting initial custom claims.
  // Never authorize from a cached profile, accountType, email or browser storage.
  const staffSnap = await getDocFromServer(doc(db, 'staffUsers', user.uid));
  const role = staffSnap.exists() ? staffSnap.data()?.role : null;
  return STAFF_ROLES.has(role) ? role : null;
}

/**
 * Sign in staff with email and password
 */
export async function staffLogin(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const role = await resolveStaffRole(cred.user);
  if (!role) {
    throw new Error('Unauthorized: This account does not possess staff or administrative authorization.');
  }
  return { user: cred.user, role };
}

export async function staffQuickAuth() {
  throw new Error('Quick authorization has been disabled in production for security.');
}

export async function staffLogout() {
  try {
    sessionStorage.removeItem('tb_session_role');
    localStorage.removeItem('tb_privileged_session');
    localStorage.removeItem('tb_privileged_session_sig');
  } catch (_) {}
  await fbSignOut(auth);
}

export function subscribeStaffAuth(callback, onError = error => console.error('Staff authorization failed:', error)) {
  let revision = 0;
  return onAuthStateChanged(auth, async (user) => {
    const currentRevision = ++revision;
    if (!user) {
      callback({ user: null, role: null, isAuthenticated: false });
      return;
    }
    let role;
    try {
      role = await resolveStaffRole(user);
    } catch (error) {
      if (currentRevision !== revision) return;
      callback({ user: null, role: null, isAuthenticated: false });
      onError(error);
      return;
    }
    // An old token/profile response must not restore a signed-out user's role.
    if (currentRevision !== revision) return;
    callback(role
      ? { user, role, isAuthenticated: true }
      : { user: null, role: null, isAuthenticated: false });
  });
}

async function callStaffCommand(name, payload) {
  const command = httpsCallable(functions, name);
  const result = await command(payload);
  if (result?.data?.success !== true) {
    throw new Error(`${name} did not confirm success.`);
  }
  return result.data;
}

async function fetchOperationalOrders(name) {
  const fetchOrders = httpsCallable(functions, name);
  const result = await fetchOrders();
  if (!Array.isArray(result?.data)) {
    throw new Error(`Invalid ${name} response: expected an array of orders.`);
  }
  return result.data;
}

// ─── Orders Subscriptions & Actions ──────────────────────────────────

/**
 * Real-time subscription to orders collection.
 * @param {Function} callback - Called with array of order objects on every update
 * @returns {Function} Unsubscribe function
 */
export function subscribeOrders(callback) {
  const ordersRef = collection(db, 'orders');
  const q = query(ordersRef, orderBy('createdAt', 'desc'));

  return onSnapshot(q, (snapshot) => {
    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
        readyAt: data.readyAt ? data.readyAt.toDate() : null,
        collectedAt: data.collectedAt ? data.collectedAt.toDate() : null,
        items: data.items || []
      };
    });
    callback(orders);
  }, (error) => {
    console.error("Error subscribing to orders:", error);
  });
}

/**
 * Compatibility hook for older kitchen dashboards. Order Cloud Functions own
 * /publicLiveQueue/current; a browser must never recompute or publish it.
 */
export function syncPublicLiveQueue() {}

/**
 * Updates order status via authoritative Cloud Function.
 * @param {string} orderId 
 * @param {string} newStatus - Operational transitions validated by the backend.
 */
export async function updateOrderStatusInDb(orderId, newStatus) {
  return callStaffCommand('updateOrderStatus', { orderId, nextStatus: newStatus });
}

export const updateOrderStatus = updateOrderStatusInDb;

// ─── Menu Items Subscriptions & Actions ──────────────────────────────

/**
 * Real-time subscription to menu items collection.
 * @param {Function} callback - Called with array of menu items
 * @returns {Function} Unsubscribe function
 */
export function subscribeMenuItems(callback) {
  const menuRef = collection(db, 'menuItems');

  return onSnapshot(menuRef, (snapshot) => {
    const items = snapshot.docs.map(doc => {
      const data = doc.data();
      const isInstant = data.type === 'instant';
      const isExplicitlyAvail = data.available !== false && data.availabilityStatus !== 'OUT_OF_STOCK' && data.isOrderable !== false;
      
      const rawStockOnHand = data.stockOnHand !== undefined 
        ? Number(data.stockOnHand) 
        : (data.stockCount !== undefined ? Number(data.stockCount) : (isInstant ? 0 : 100));
      const reserved = Number(data.reservedStock || 0);
      const netAvailable = isInstant ? Math.max(0, rawStockOnHand - reserved) : (isExplicitlyAvail ? 100 : 0);

      // Invariant: An item is sold out if explicitly marked unavailable OR if net available units are <= 0
      const isSoldOut = !isExplicitlyAvail || (isInstant && netAvailable <= 0);
      const effectiveStock = isSoldOut ? 0 : (isInstant ? netAvailable : 100);

      return {
        id: doc.id,
        ...data,
        price: Number(data.price || 0),
        prepMinutes: Number(data.prepMinutes || 0),
        // Availability does not change the server's physical stock balance.
        stockOnHand: rawStockOnHand,
        reservedStock: reserved,
        stockCount: effectiveStock,
        batchDate: data.batchDate || '',
        available: !isSoldOut,
        isOrderable: !isSoldOut,
        availabilityStatus: isSoldOut ? 'OUT_OF_STOCK' : 'AVAILABLE'
      };
    });
    callback(items);
  }, (error) => {
    console.error("Error subscribing to menu items:", error);
  });
}

/**
 * Fetch Kitchen Operational Orders via the least-privilege Cloud Function.
 */
export async function fetchKitchenOrders() {
  return fetchOperationalOrders('getKitchenOrders');
}

/**
 * Fetch Pickup Operational Orders via the least-privilege Cloud Function.
 */
export async function fetchPickupOrders() {
  return fetchOperationalOrders('getPickupOrders');
}

/**
 * Fetch Cashier Operational Orders via the least-privilege Cloud Function.
 */
export async function fetchCashierOrders() {
  return fetchOperationalOrders('getCashierOrders');
}

/**
 * Toggle availability of a menu item via the authoritative Cloud Function.
 */
export async function toggleItemAvailability(itemId, isAvailable) {
  const available = Boolean(isAvailable);
  return callStaffCommand('toggleMenuItemAvailability', { itemId, available });
}

/**
 * Set physical stock via the absolute-stock contract in inventory.ts.
 */
export async function updateItemStockCount(itemId, count) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Stock count must be a non-negative safe integer.');
  }
  const reason = 'Staff dashboard stock count update';
  return callStaffCommand('adjustInventoryStock', { itemId, newStock: count, reason });
}

/**
 * Update details of a menu item via the authoritative Cloud Function.
 */
export async function updateItemDetails(itemId, details) {
  return callStaffCommand('updateMenuItemDetails', { itemId, details });
}


/**
 * Add or overwrite a menu item via the authoritative Cloud Function.
 */
export async function saveMenuItem(itemData) {
  return callStaffCommand('upsertMenuItem', { itemData });
}

/**
 * Soft-archive a menu item via the authoritative Cloud Function.
 */
export async function archiveMenuItem(itemId, reason = 'Archived by manager') {
  return callStaffCommand('archiveMenuItem', { itemId, reason });
}

/**
 * Delete a menu item via the authoritative Cloud Function.
 */
export async function deleteMenuItem(itemId) {
  return callStaffCommand('deleteMenuItemAdmin', { itemId });
}

/**
 * Manager Unlock for PIN-locked orders via the authoritative Cloud Function.
 */
export async function unlockOrder(orderId, reason = 'Student presented physical ID') {
  // F-008 Remediation: Order unlock is security-sensitive (bypasses PIN lockout).
  // Must go through Cloud Function for authorization check and security event logging.
  return callStaffCommand('unlockOrderPickupVerification', { orderId, reason });
}

/**
 * Record Counter Cash Payment via Authoritative Cloud Function
 */
export async function recordCashPayment(orderId) {
  // F-008 Remediation: Cash payments MUST go through the authoritative Cloud Function.
  // No direct Firestore fallback — the function handles ledger posting, inventory commitment, and audit trail.
  return callStaffCommand('recordCashPayment', { orderId });
}

/**
 * Upload Real Menu Image to Firebase Storage with size/MIME verification
 */
export async function uploadMenuImage(itemId, file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2MB limit.');
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimes.includes(file.type)) throw new Error('Only JPG, PNG, and WebP images are allowed.');

  const safeFileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const storageRef = ref(storage, `menu_images/${itemId}/${safeFileName}`);
  const snapshot = await uploadBytes(storageRef, file, { contentType: file.type });
  const downloadUrl = await getDownloadURL(snapshot.ref);
  return downloadUrl;
}

// ─── Daily Canteen Menu Board & Rotating Specials ───────────────────

export function subscribeDailyBoard(callback, onError = error => console.error('[Firebase] DailyBoard subscription failed:', error)) {
  const boardRef = doc(db, 'canteenConfig', 'dailyMenuBoard');
  return onSnapshot(boardRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data());
    } else {
      callback(null);
    }
  }, onError);
}

export async function saveDailyBoard(boardData) {
  if (!auth.currentUser) throw new Error('Staff authentication is required to publish the daily board.');
  const data = {
    ...boardData,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'canteenConfig', 'dailyMenuBoard'), data, { merge: true });
  batch.set(doc(db, 'dailyBoard', 'today'), data, { merge: true });
  await batch.commit();
}

/**
 * Authoritative Order Cancellation via Cloud Function.
 */
export async function cancelStaffOrder(orderId, reason) {
  return callStaffCommand('cancelOrder', { orderId, reason: reason || 'Cancelled by staff workstation' });
}

/**
 * Authoritative Order Refund via Cloud Function.
 */
export async function processStaffRefund({ orderId, reason, amountPaise }) {
  const idempotencyKey = `rfnd_${orderId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const payload = {
    orderId,
    reason: reason || 'Customer refund processed by staff',
    idempotencyKey,
  };
  if (amountPaise !== undefined) {
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new Error('Refund amount must be a positive safe integer in paise.');
    }
    payload.amountPaise = amountPaise;
  }
  return callStaffCommand('processOrderRefund', payload);
}
