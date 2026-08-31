// Firebase JS SDK Configuration & Real-Time Firestore Service for Staff Dashboard
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  onSnapshot, 
  updateDoc, 
  setDoc,
  deleteDoc,
  query, 
  orderBy, 
  Timestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
        createdAtDate: data.createdAt ? data.createdAt.toDate() : new Date(),
        readyAtDate: data.readyAt ? data.readyAt.toDate() : null,
        collectedAtDate: data.collectedAt ? data.collectedAt.toDate() : null
      };
    });
    callback(orders);
  }, (error) => {
    console.error("Error subscribing to orders:", error);
  });
}

/**
 * Update the status of an order in Firestore
 * @param {string} orderId 
 * @param {'placed'|'preparing'|'ready'|'collected'} newStatus 
 */
export async function updateOrderStatus(orderId, newStatus) {
  const orderRef = doc(db, 'orders', orderId);
  const updateData = { status: newStatus };
  
  if (newStatus === 'ready') {
    updateData.readyAt = Timestamp.now();
  }
  if (newStatus === 'collected') {
    updateData.collectedAt = Timestamp.now();
  }

  await updateDoc(orderRef, updateData);
}

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
 * Toggle availability of a cooked menu item in Firestore
 * @param {string} itemId 
 * @param {boolean} isAvailable 
 */
export async function toggleItemAvailability(itemId, isAvailable) {
  const itemRef = doc(db, 'menuItems', itemId);
  await updateDoc(itemRef, { available: isAvailable });
}

/**
 * Update quantity / stock count for packaged/store items in Firestore
 * Automatically sets available = true if count > 0, or false if count <= 0.
 * @param {string} itemId 
 * @param {number} count 
 */
export async function updateItemStockCount(itemId, count) {
  const newCount = Math.max(0, Number(count));
  const itemRef = doc(db, 'menuItems', itemId);
  await updateDoc(itemRef, { 
    stockCount: newCount,
    available: newCount > 0 
  });
}

/**
 * Update details of a menu item (name, price, category, batchDate, prepMinutes)
 * @param {string} itemId 
 * @param {Object} details 
 */
export async function updateItemDetails(itemId, details) {
  const itemRef = doc(db, 'menuItems', itemId);
  const updateData = {};

  if (details.name !== undefined) updateData.name = details.name.trim();
  if (details.price !== undefined) updateData.price = Number(details.price);
  if (details.category !== undefined) updateData.category = details.category;
  if (details.prepMinutes !== undefined) updateData.prepMinutes = Number(details.prepMinutes);
  if (details.batchDate !== undefined) updateData.batchDate = details.batchDate.trim();
  if (details.type !== undefined) updateData.type = details.type;

  await updateDoc(itemRef, updateData);
}

/**
 * Add or overwrite a menu item in Firestore
 * @param {Object} itemData 
 */
export async function saveMenuItem(itemData) {
  const docId = itemData.id || itemData.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const itemRef = doc(db, 'menuItems', docId);
  const isInstant = itemData.type === 'instant';
  const initialStock = itemData.stockCount !== undefined ? Number(itemData.stockCount) : 50;
  
  await setDoc(itemRef, {
    name: itemData.name.trim(),
    price: Number(itemData.price),
    category: itemData.category,
    type: itemData.type,
    prepMinutes: Number(itemData.prepMinutes || 0),
    stockCount: isInstant ? initialStock : 100,
    batchDate: itemData.batchDate || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    available: isInstant ? initialStock > 0 : (itemData.available !== undefined ? itemData.available : true),
    imageUrl: itemData.imageUrl || '',
    iconKey: itemData.iconKey || itemData.category || ''
  }, { merge: true });
}

/**
 * Delete a menu item from Firestore
 * @param {string} itemId 
 */
export async function deleteMenuItem(itemId) {
  const itemRef = doc(db, 'menuItems', itemId);
  await deleteDoc(itemRef);
}
