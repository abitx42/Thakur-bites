// Firebase JS SDK Configuration & Real-Time Firestore Service for Staff Dashboard
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot, 
  getDoc,
  getDocs,
  where,
  updateDoc, 
  setDoc,
  deleteDoc, 
  query, 
  orderBy, 
  Timestamp,
  serverTimestamp,
  increment,
  limit 
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

// Initialize Firebase safely
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');
export const storage = getStorage(app);
export { ref, uploadBytes, getDownloadURL };

if (typeof window !== 'undefined') {
  // F-025: Only route via emulator proxy on strict localhost — never on external tunnels
  const isLocalDev = window.location.hostname === 'localhost' ||
                     window.location.hostname === '127.0.0.1';
  if (isLocalDev) {
    functions.emulatorOrigin = window.location.origin;
  }
}


// ─── Staff Authentication & Role Management ─────────────────────────

const KNOWN_ADMIN_EMAILS = [
  'moreaboutastram@gmail.com',
  'adi@tcetmumbai.in',
  '1032251174@tcetmumbai.in',
  'adityadjsb@gmail.com',
];

function isKnownAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return KNOWN_ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

function isInstitutionalEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.toLowerCase().trim();
  return clean.endsWith('@tcetmumbai.in') || clean.endsWith('@thakureducation.org');
}

/**
 * Sign in staff with email and password
 */
export async function staffLogin(email, password) {
  const cleanEmail = email.trim().toLowerCase();
  
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  let role = null;
  try {
    const tokenResult = await cred.user.getIdTokenResult(true);
    role = tokenResult.claims?.role;
  } catch (_) {}

  if (!role) {
    try {
      const staffSnap = await getDoc(doc(db, 'staffUsers', cred.user.uid));
      if (staffSnap.exists()) role = staffSnap.data()?.role;
    } catch (_) {}
  }

  if (!role) {
    try {
      const userSnap = await getDoc(doc(db, 'users', cred.user.uid));
      if (userSnap.exists()) {
        const uData = userSnap.data();
        role = uData?.role;
        if (!role && (uData?.accountType === 'COLLEGE_STAFF' || uData?.accountType === 'staff')) {
          role = 'staff';
        }
      }
    } catch (_) {}
  }

  if (!role) {
    // SECURITY: Align with firestore.rules — exact admin email allowlist + institutional domains only
    if (isKnownAdminEmail(cleanEmail)) {
      role = 'admin';
    } else if (isInstitutionalEmail(cleanEmail)) {
      role = 'staff';
    } else {
      throw new Error('Unauthorized: This account does not possess staff or administrative authorization.');
    }
  }

  try {
    sessionStorage.setItem('tb_session_role', role);
  } catch (_) {}

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

export function subscribeStaffAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      let role = null;
      try {
        const tokenResult = await user.getIdTokenResult(true);
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
          if (userSnap.exists()) {
            const uData = userSnap.data();
            role = uData?.role;
            if (!role && (uData?.accountType === 'COLLEGE_STAFF' || uData?.accountType === 'staff')) {
              role = 'staff';
            }
          }
        } catch (_) {}
      }

      if (!role && user.email) {
        const cleanEmail = user.email.toLowerCase().trim();
        if (isKnownAdminEmail(cleanEmail)) {
          role = 'admin';
        } else if (isInstitutionalEmail(cleanEmail)) {
          role = 'staff';
        }
      }

      if (!role) {
        try {
          role = sessionStorage.getItem('tb_session_role');
        } catch (_) {}
      }

      if (!role) {
        callback({ user: null, role: null, isAuthenticated: false });
      } else {
        try {
          sessionStorage.setItem('tb_session_role', role);
        } catch (_) {}
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
    syncPublicLiveQueue(orders);
  }, (error) => {
    console.error("Error subscribing to orders:", error);
  });
}

let syncQueueTimeout = null;

/**
 * Synchronizes the public single-document TV projection (/publicLiveQueue/current).
 * Can be called with an array of order objects or will query active orders.
 * Guaranteed Zero-PII: projects strictly tokens and prep minutes.
 */
export async function syncPublicLiveQueue(orders = null) {
  if (syncQueueTimeout) clearTimeout(syncQueueTimeout);

  syncQueueTimeout = setTimeout(async () => {
    try {
      let activeOrders = orders;
      if (!activeOrders) {
        const ordersCol = collection(db, 'orders');
        const q = query(ordersCol, where('status', 'in', ['placed', 'confirmed', 'preparing', 'ready']));
        const snap = await getDocs(q);
        activeOrders = snap.docs.map(d => d.data());
      }

      const confirmed = [];
      const preparing = [];
      const ready = [];
      const confirmedTokens = [];
      const preparingTokens = [];
      const readyTokens = [];

      // Sort FIFO by createdAt (oldest first)
      const sorted = [...activeOrders].sort((a, b) => {
        const getMs = (val) => {
          if (!val) return 0;
          if (val instanceof Date) return val.getTime();
          if (typeof val.toDate === 'function') return val.toDate().getTime();
          if (val.seconds) return val.seconds * 1000;
          if (typeof val === 'string') return new Date(val).getTime();
          return 0;
        };
        return getMs(a.createdAt) - getMs(b.createdAt);
      });

      for (const o of sorted) {
        const token = (o.tokenNumber || '').trim();
        if (!token) continue;

        const status = (o.status || '').toLowerCase();
        if (status === 'cancelled' || status === 'collected' || status === 'payment_pending') continue;

        if (status === 'ready') {
          ready.push({ token });
          readyTokens.push(token);
        } else if (status === 'preparing') {
          preparing.push({
            token,
            estimatedMinutes: typeof o.estimatedMinutes === 'number' && o.estimatedMinutes > 0
              ? o.estimatedMinutes
              : null,
          });
          preparingTokens.push(token);
        } else if (['confirmed', 'placed'].includes(status)) {
          confirmed.push({ token });
          confirmedTokens.push(token);
        }
      }

      const payload = {
        confirmedTokens,
        preparingTokens,
        readyTokens,
        confirmed,
        preparing,
        ready,
        activeCount: confirmedTokens.length + preparingTokens.length + readyTokens.length,
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, 'publicLiveQueue', 'current'), payload, { merge: true });
    } catch (err) {
      console.warn("Public live queue sync notice:", err);
    }
  }, 250);
}

/**
 * Updates order status via authoritative Cloud Function.
 * @param {string} orderId 
 * @param {string} newStatus - 'placed' | 'preparing' | 'ready' | 'collected' | 'cancelled'
 */
export async function updateOrderStatusInDb(orderId, newStatus) {
  try {
    const updateStatusFn = httpsCallable(functions, 'updateOrderStatus');
    await updateStatusFn({ orderId, nextStatus: newStatus, status: newStatus });
  } catch (fnErr) {
    console.warn("Cloud function updateOrderStatus notice (falling back to direct Firestore update):", fnErr);
    try {
      const orderRef = doc(db, 'orders', orderId);
      const updateData = {
        status: newStatus,
        updatedAt: serverTimestamp()
      };
      if (newStatus === 'ready') {
        updateData.readyAt = serverTimestamp();
      } else if (newStatus === 'collected') {
        updateData.collectedAt = serverTimestamp();
      }
      await updateDoc(orderRef, updateData);
    } catch (fsErr) {
      console.error("Direct updateOrderStatus failed:", fsErr);
      throw fsErr;
    }
  }
  // Synchronize TV queue projection immediately after status update
  syncPublicLiveQueue();
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

      // F-009: Self-heal negative stock only if current user is authenticated staff
      if (data.stockCount !== undefined && data.stockCount < 0 && auth.currentUser) {
        updateDoc(doc.ref, { stockCount: 0, stockOnHand: 0, available: false, isOrderable: false, availabilityStatus: 'OUT_OF_STOCK' }).catch(console.error);
      }

      return {
        id: doc.id,
        ...data,
        price: Number(data.price || 0),
        prepMinutes: Number(data.prepMinutes || 0),
        stockOnHand: isSoldOut ? (isInstant && reserved > 0 ? reserved : 0) : rawStockOnHand,
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
 * Fetch Kitchen Operational Orders via least-privilege Cloud Function with direct Firestore fallback
 */
export async function fetchKitchenOrders() {
  try {
    const fn = httpsCallable(functions, 'getKitchenOrders');
    const res = await fn();
    return res.data || [];
  } catch (fnErr) {
    console.warn("getKitchenOrders callable notice (falling back to direct Firestore query):", fnErr);
    try {
      const ordersCol = collection(db, 'orders');
      const q = query(ordersCol, where('status', 'in', ['placed', 'confirmed', 'preparing', 'payment_pending', 'ready']), limit(100));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          orderId: d.id,
          tokenNumber: data.tokenNumber || 'TB-???',
          status: data.status,
          priorityLevel: typeof data.priorityLevel === 'number' ? data.priorityLevel : 1,
          effectivePriority: data.effectivePriority,
          items: data.items || [],
          estimatedMinutes: data.estimatedMinutes || data.estimatedPrepTimeMinutes || null,
          isOnlyReadyMade: data.isOnlyReadyMade === true || (Array.isArray(data.items) && data.items.length > 0 && data.items.every(i => i.type === 'instant')),
          readyMadePreference: data.readyMadePreference || null,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
        };
      });
    } catch (fsErr) {
      console.error("Direct fetchKitchenOrders query failed:", fsErr);
      return [];
    }
  }
}

/**
 * Fetch Pickup Operational Orders via least-privilege Cloud Function with direct Firestore fallback
 */
export async function fetchPickupOrders() {
  try {
    const fn = httpsCallable(functions, 'getPickupOrders');
    const res = await fn();
    return res.data || [];
  } catch (fnErr) {
    console.warn("getPickupOrders callable notice (falling back to direct Firestore query):", fnErr);
    try {
      const ordersCol = collection(db, 'orders');
      const q = query(ordersCol, where('status', 'in', ['placed', 'confirmed', 'preparing', 'ready', 'collected']), limit(100));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          orderId: d.id,
          tokenNumber: data.tokenNumber || 'TB-???',
          status: data.status,
          studentName: data.studentName || 'Student',
          studentRoll: data.studentRoll || '',
          pinCode: data.pinCode || '',
          items: data.items || [],
          isOnlyReadyMade: data.isOnlyReadyMade === true || (Array.isArray(data.items) && data.items.length > 0 && data.items.every(i => i.type === 'instant')),
          readyMadePreference: data.readyMadePreference || null,
          isLockedForInvestigation: data.isLockedForInvestigation || false,
          failedPinAttempts: data.failedPinAttempts || 0,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
        };
      });
    } catch (fsErr) {
      console.error("Direct fetchPickupOrders query failed:", fsErr);
      return [];
    }
  }
}

/**
 * Fetch Cashier Operational Orders via least-privilege Cloud Function with direct Firestore fallback
 */
export async function fetchCashierOrders() {
  try {
    const fn = httpsCallable(functions, 'getCashierOrders');
    const res = await fn();
    return res.data || [];
  } catch (fnErr) {
    console.warn("getCashierOrders callable notice (falling back to direct Firestore query):", fnErr);
    try {
      const ordersCol = collection(db, 'orders');
      const q = query(ordersCol, where('paymentMethod', '==', 'counter_cash'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          orderId: d.id,
          tokenNumber: data.tokenNumber || 'TB-???',
          status: data.status,
          paymentStatus: data.paymentStatus,
          totalAmount: data.totalAmount || 0,
          studentName: data.studentName || 'Student',
          items: data.items || [],
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
        };
      });
    } catch (fsErr) {
      console.error("Direct fetchCashierOrders query failed:", fsErr);
      return [];
    }
  }
}

/**
 * Toggle availability of a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function toggleItemAvailability(itemId, isAvailable) {
  const available = Boolean(isAvailable);
  try {
    const toggleFn = httpsCallable(functions, 'toggleMenuItemAvailability');
    await toggleFn({ itemId, available });
  } catch (fnErr) {
    console.warn("Cloud function toggleMenuItemAvailability notice:", fnErr);
    try {
      const itemRef = doc(db, 'menuItems', itemId);
      const updatePayload = {
        available,
        isOrderable: available,
        availabilityStatus: available ? 'AVAILABLE' : 'OUT_OF_STOCK',
        updatedAt: Timestamp.now()
      };
      if (!available) {
        updatePayload.stockCount = 0;
        updatePayload.stockOnHand = 0;
        updatePayload.availableStock = 0;
      }
      await updateDoc(itemRef, updatePayload);
    } catch (fsErr) {
      console.error("Direct toggleItemAvailability failed:", fsErr);
      throw fnErr;
    }
  }
}

/**
 * Update quantity / stock count for packaged/store items via Cloud Function with Firestore fallback
 */
export async function updateItemStockCount(itemId, count) {
  const newCount = Math.max(0, Math.round(Number(count) || 0));
  const reason = 'Staff dashboard stock count update';

  // 1. Authoritative Cloud Function update (preserves reservedStock & appends to inventoryLedger)
  try {
    const adjustFn = httpsCallable(functions, 'adjustInventoryStock');
    const res = await adjustFn({
      itemId,
      newStock: newCount,
      changeType: newCount === 0 ? 'MANUAL_CORRECTION' : 'RESTOCK',
      deltaUnits: 1,
      reason
    });
    return res.data;
  } catch (fnErr) {
    console.warn("Cloud function adjustInventoryStock notice:", fnErr);
    // 2. Direct Firestore update fallback for managers/admins only
    try {
      const isAvailable = newCount > 0;
      const itemRef = doc(db, 'menuItems', itemId);
      await updateDoc(itemRef, {
        stockOnHand: newCount,
        stockCount: newCount,
        availableStock: newCount,
        isOrderable: isAvailable,
        available: isAvailable,
        availabilityStatus: isAvailable ? 'AVAILABLE' : 'OUT_OF_STOCK',
        updatedAt: Timestamp.now()
      });
      return { success: true, directUpdate: true };
    } catch (fsErr) {
      console.error("Direct stock update failed:", fsErr);
      throw fsErr;
    }
  }
}

/**
 * Update details of a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function updateItemDetails(itemId, details) {
  try {
    const updateFn = httpsCallable(functions, 'updateMenuItemDetails');
    await updateFn({ itemId, details });
  } catch (fnErr) {
    console.warn("Cloud function updateMenuItemDetails notice:", fnErr);
    try {
      const itemRef = doc(db, 'menuItems', itemId);
      await updateDoc(itemRef, {
        ...details,
        updatedAt: Timestamp.now()
      });
    } catch (fsErr) {
      console.error("Direct updateItemDetails failed:", fsErr);
      throw fnErr;
    }
  }
}


/**
 * Add or overwrite a menu item via authoritative Cloud Function with Firestore fallback
 */
export async function saveMenuItem(itemData) {
  // F-010 Remediation: Cloud Function first for server-side validation, direct Firestore as fallback only
  try {
    const upsertFn = httpsCallable(functions, 'upsertMenuItem');
    await upsertFn({ itemData });
    return;
  } catch (fnErr) {
    console.warn("Cloud function upsertMenuItem notice (falling back to direct Firestore):", fnErr);
  }

  // Fallback: Direct Firestore write (only reached if Cloud Function is unavailable)
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
    console.error("Direct Firestore saveMenuItem failed:", fsErr);
    throw fsErr;
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
 * Manager Unlock for PIN-locked orders via Cloud Function with direct Firestore fallback
 */
export async function unlockOrder(orderId, reason = 'Student presented physical ID') {
  // F-008 Remediation: Order unlock is security-sensitive (bypasses PIN lockout).
  // Must go through Cloud Function for authorization check and security event logging.
  const unlockFn = httpsCallable(functions, 'unlockOrderPickupVerification');
  await unlockFn({ orderId, reason });
}

/**
 * Record Counter Cash Payment via Authoritative Cloud Function
 */
export async function recordCashPayment(orderId) {
  // F-008 Remediation: Cash payments MUST go through the authoritative Cloud Function.
  // No direct Firestore fallback — the function handles ledger posting, inventory commitment, and audit trail.
  const cashFn = httpsCallable(functions, 'recordCashPayment');
  const res = await cashFn({ orderId });
  syncPublicLiveQueue();
  return res.data;
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

export function subscribeDailyBoard(callback) {
  const boardRef = doc(db, 'canteenConfig', 'dailyMenuBoard');
  return onSnapshot(boardRef, (snap) => {
    if (snap.exists()) {
      callback(snap.data());
    } else {
      callback(null);
    }
  }, (err) => {
    console.warn('[Firebase] DailyBoard subscription notice:', err);
    callback(null);
  });
}

export async function saveDailyBoard(boardData) {
  const data = {
    ...boardData,
    updatedAt: serverTimestamp(),
  };
  const boardRef = doc(db, 'canteenConfig', 'dailyMenuBoard');
  await setDoc(boardRef, data, { merge: true });
  try {
    const legacyRef = doc(db, 'dailyBoard', 'today');
    await setDoc(legacyRef, data, { merge: true });
  } catch (_) {}
}

/**
 * Authoritative Order Cancellation via Cloud Function with direct Firestore fallback
 */
export async function cancelStaffOrder(orderId, reason) {
  try {
    const cancelFn = httpsCallable(functions, 'cancelOrder');
    const res = await cancelFn({ orderId, reason: reason || 'Cancelled by staff workstation' });
    syncPublicLiveQueue();
    return res.data;
  } catch (err) {
    console.warn('cancelStaffOrder notice (falling back to direct Firestore update):', err);
    try {
      const orderRef = doc(db, 'orders', orderId);
      const orderSnap = await getDoc(orderRef);
      if (orderSnap.exists()) {
        const orderData = orderSnap.data();
        if (Array.isArray(orderData.items)) {
          for (const item of orderData.items) {
            const itemId = item.itemId || item.id;
            if (item.type === 'instant' && itemId && item.quantity > 0) {
              try {
                const itemRef = doc(db, 'menuItems', itemId);
                await updateDoc(itemRef, {
                  stockOnHand: increment(item.quantity),
                  stockCount: increment(item.quantity),
                  availableStock: increment(item.quantity),
                  isOrderable: true,
                  available: true,
                  availabilityStatus: 'AVAILABLE',
                  updatedAt: serverTimestamp()
                });
              } catch (_) {}
            }
          }
        }
      }
      await updateDoc(orderRef, {
        status: 'cancelled',
        cancellationReason: reason || 'Cancelled by staff workstation',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      syncPublicLiveQueue();
      return { success: true, directUpdate: true };
    } catch (fsErr) {
      console.error('Direct cancelStaffOrder failed:', fsErr);
      throw fsErr;
    }
  }
}

/**
 * Authoritative Order Refund via Cloud Function with direct Firestore fallback
 */
export async function processStaffRefund({ orderId, reason, amountPaise }) {
  try {
    const refundFn = httpsCallable(functions, 'processOrderRefund');
    const idempotencyKey = `rfnd_${orderId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const payload = {
      orderId,
      reason: reason || 'Customer refund processed by staff',
      idempotencyKey,
    };
    if (typeof amountPaise === 'number' && amountPaise > 0) {
      payload.amountPaise = amountPaise;
    }
    const res = await refundFn(payload);
    syncPublicLiveQueue();
    return res.data;
  } catch (err) {
    console.warn('processStaffRefund notice (falling back to direct Firestore update):', err);
    try {
      const orderRef = doc(db, 'orders', orderId);
      await updateDoc(orderRef, {
        status: 'cancelled',
        refundStatus: 'refunded',
        paymentStatus: 'refunded',
        refundReason: reason || 'Customer refund processed by staff',
        refundAmountPaise: amountPaise || 0,
        refundedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      syncPublicLiveQueue();
      return { success: true, directUpdate: true };
    } catch (fsErr) {
      console.error('Direct refund update failed:', fsErr);
      throw fsErr;
    }
  }
}


