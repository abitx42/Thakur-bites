// Firebase JS SDK Configuration & Real-Time Firestore Service for Staff Dashboard
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot, 
  getDoc,
  updateDoc, 
  setDoc,
  deleteDoc, 
  query, 
  orderBy, 
  Timestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut as fbSignOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');
export const storage = getStorage(app);
export { ref, uploadBytes, getDownloadURL };

if (typeof window !== 'undefined') {
  const host = window.location.hostname;
  const port = window.location.port ? Number(window.location.port) : (window.location.protocol === 'https:' ? 443 : 80);
  try {
    connectFunctionsEmulator(functions, host, port);
  } catch (e) {
    console.warn("connectFunctionsEmulator notice:", e);
  }
}

// ─── Staff Authentication & Role Management ─────────────────────────

/**
 * Sign in staff with email and password
 */
export async function staffLogin(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const tokenResult = await cred.user.getIdTokenResult(true);
  const role = tokenResult.claims.role || 'staff';

  return { user: cred.user, role };
}

export async function staffQuickAuth() {
  throw new Error('Quick authorization has been disabled in production for security.');
}

export async function staffLogout() {
  await fbSignOut(auth);
}

export function subscribeStaffAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      let role = null;
      try {
        const tokenResult = await user.getIdTokenResult();
        role = tokenResult.claims?.role;
      } catch (_) {}

      if (!role) {
        try {
          const staffSnap = await getDoc(doc(db, 'staffUsers', user.uid));
          if (staffSnap.exists()) role = staffSnap.data()?.role;
        } catch (_) {}
      }

      if (!role) {
        try {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (userSnap.exists()) role = userSnap.data()?.role;
        } catch (_) {}
      }

      if (!role) {
        // Token has no role claim: treat as unauthenticated for RBAC purposes
        callback({ user: null, role: null, isAuthenticated: false });
      } else {
        callback({ user, role, isAuthenticated: true });
      }
    } else {
      callback({ user: null, role: null, isAuthenticated: false });
    }
  });
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
 * Updates order status via authoritative Cloud Function.
 * @param {string} orderId 
 * @param {string} newStatus - 'placed' | 'preparing' | 'ready' | 'collected' | 'cancelled'
 */
export async function updateOrderStatusInDb(orderId, newStatus) {
  const updateStatusFn = httpsCallable(functions, 'updateOrderStatus');
  await updateStatusFn({ orderId, status: newStatus });
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
      const isAvail = data.available !== false;
      const isInstant = data.type === 'instant';
      const rawStock = data.stockCount !== undefined ? Number(data.stockCount) : (isInstant ? 0 : 100);
      const stock = Math.max(0, isNaN(rawStock) ? 0 : rawStock);

      // Self-heal negative stock in database if found
      if (data.stockCount !== undefined && data.stockCount < 0) {
        updateDoc(doc.ref, { stockCount: 0, available: false }).catch(console.error);
      }

      return {
        id: doc.id,
        ...data,
        price: Number(data.price || 0),
        prepMinutes: Number(data.prepMinutes || 0),
        stockCount: stock,
        batchDate: data.batchDate || '',
        available: isAvail && (!isInstant || stock > 0)
      };
    });
    callback(items);
  }, (error) => {
    console.error("Error subscribing to menu items:", error);
  });
}

/**
 * Fetch Kitchen Operational Orders via least-privilege Cloud Function
 */
export async function fetchKitchenOrders() {
  const fn = httpsCallable(functions, 'getKitchenOrders');
  const res = await fn();
  return res.data || [];
}

/**
 * Fetch Pickup Operational Orders via least-privilege Cloud Function
 */
export async function fetchPickupOrders() {
  const fn = httpsCallable(functions, 'getPickupOrders');
  const res = await fn();
  return res.data || [];
}

/**
 * Fetch Cashier Operational Orders via least-privilege Cloud Function
 */
export async function fetchCashierOrders() {
  const fn = httpsCallable(functions, 'getCashierOrders');
  const res = await fn();
  return res.data || [];
}

/**
 * Toggle availability of a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function toggleItemAvailability(itemId, isAvailable) {
  const available = Boolean(isAvailable);
  try {
    const itemRef = doc(db, 'menuItems', itemId);
    await updateDoc(itemRef, {
      available,
      isOrderable: available,
      updatedAt: Timestamp.now()
    });
  } catch (fsErr) {
    console.warn("Direct Firestore toggle notice:", fsErr);
  }

  try {
    const toggleFn = httpsCallable(functions, 'toggleMenuItemAvailability');
    await toggleFn({ itemId, available });
  } catch (fnErr) {
    console.warn("Cloud function toggleMenuItemAvailability notice:", fnErr);
  }
}

/**
 * Update quantity / stock count for packaged/store items via Cloud Function with Firestore fallback
 */
export async function updateItemStockCount(itemId, count) {
  const newCount = Math.max(0, Math.round(Number(count) || 0));
  const reason = 'Staff dashboard stock count update';

  // 1. Authoritative Firestore update directly (permitted for managers/admins)
  try {
    const itemRef = doc(db, 'menuItems', itemId);
    await updateDoc(itemRef, {
      stockOnHand: newCount,
      stockCount: newCount,
      isOrderable: newCount > 0,
      available: newCount > 0,
      updatedAt: Timestamp.now()
    });
  } catch (fsErr) {
    console.warn("Direct Firestore stock update notice:", fsErr);
  }

  // 2. Also invoke Cloud Function for ledger logging if available
  try {
    const adjustFn = httpsCallable(functions, 'adjustInventoryStock');
    await adjustFn({
      itemId,
      newStock: newCount,
      changeType: 'MANUAL_CORRECTION',
      deltaUnits: 1,
      reason
    });
  } catch (fnErr) {
    console.warn("Cloud function adjustInventoryStock notice:", fnErr);
  }
}

/**
 * Update details of a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function updateItemDetails(itemId, details) {
  try {
    const itemRef = doc(db, 'menuItems', itemId);
    await updateDoc(itemRef, {
      ...details,
      updatedAt: Timestamp.now()
    });
  } catch (fsErr) {
    console.warn("Direct Firestore update details notice:", fsErr);
  }

  try {
    const updateFn = httpsCallable(functions, 'updateMenuItemDetails');
    await updateFn({ itemId, details });
  } catch (fnErr) {
    console.warn("Cloud function updateMenuItemDetails notice:", fnErr);
  }
}

/**
 * Add or overwrite a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function saveMenuItem(itemData) {
  try {
    const menuRef = collection(db, 'menuItems');
    const newDoc = itemData.id ? doc(db, 'menuItems', itemData.id) : doc(menuRef);
    const stockVal = itemData.stockCount !== undefined ? Number(itemData.stockCount) : 100;
    await setDoc(newDoc, {
      ...itemData,
      id: newDoc.id,
      stockOnHand: stockVal,
      stockCount: stockVal,
      available: itemData.available !== false,
      isOrderable: itemData.available !== false,
      createdAt: itemData.createdAt || Timestamp.now(),
      updatedAt: Timestamp.now()
    }, { merge: true });
  } catch (fsErr) {
    console.warn("Direct Firestore saveMenuItem notice:", fsErr);
  }

  try {
    const upsertFn = httpsCallable(functions, 'upsertMenuItem');
    await upsertFn({ itemData });
  } catch (fnErr) {
    console.warn("Cloud function upsertMenuItem notice:", fnErr);
  }
}

/**
 * Soft-archive a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function archiveMenuItem(itemId, reason = 'Archived by manager') {
  try {
    const itemRef = doc(db, 'menuItems', itemId);
    await updateDoc(itemRef, {
      archived: true,
      available: false,
      isOrderable: false,
      archiveReason: reason,
      updatedAt: Timestamp.now()
    });
  } catch (fsErr) {
    console.warn("Direct Firestore archive notice:", fsErr);
  }

  try {
    const archiveFn = httpsCallable(functions, 'archiveMenuItem');
    await archiveFn({ itemId, reason });
  } catch (fnErr) {
    console.warn("Cloud function archiveMenuItem notice:", fnErr);
  }
}

/**
 * Delete a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function deleteMenuItem(itemId) {
  try {
    const itemRef = doc(db, 'menuItems', itemId);
    await deleteDoc(itemRef);
  } catch (fsErr) {
    console.warn("Direct Firestore delete notice:", fsErr);
  }

  try {
    const deleteFn = httpsCallable(functions, 'deleteMenuItemAdmin');
    await deleteFn({ itemId });
  } catch (fnErr) {
    console.warn("Cloud function deleteMenuItemAdmin notice:", fnErr);
  }
}

/**
 * Manager Unlock for PIN-locked orders via Cloud Function
 */
export async function unlockOrder(orderId, reason = 'Student presented physical ID') {
  const unlockFn = httpsCallable(functions, 'unlockOrderPickupVerification');
  await unlockFn({ orderId, reason });
}

/**
 * Record Counter Cash Payment via Cloud Function
 */
export async function recordCashPayment(orderId) {
  const cashFn = httpsCallable(functions, 'recordCashPayment');
  await cashFn({ orderId });
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


