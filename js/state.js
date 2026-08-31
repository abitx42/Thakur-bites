// Central Reactive State Store for Thakur Bites
import { MENU_ITEMS, STATIONS } from './data/menu.js';

class StateStore {
  constructor() {
    this.listeners = [];
    this.currentRole = 'student'; // 'student' | 'kitchen' | 'tv_display' | 'admin'
    this.activeCategory = 'all';
    this.searchQuery = '';
    this.vegOnlyFilter = false;
    
    // Today's Canteen Board State
    this.todaysBoard = {
      sabji1: 'Paneer Butter Masala',
      sabji2: 'Aloo Methi Sukha Gravy',
      canteenSpecial: 'Special Pav Bhaji + Gulab Jamun',
      rotiAvailable: true,
      puriAvailable: true,
      announcement: 'Morning Break slots open! Order from class to skip the counter line.',
      isRushHour: true
    };

    // Out of stock item IDs (86ed)
    this.outOfStockItems = new Set();

    // Student Cart
    this.cart = [];
    this.selectedPickupSlot = 'Next Available (~12 mins)';
    this.currentStudent = {
      name: 'Aditya Sharma',
      rollNo: 'TCET-IT-042',
      phone: '98201XXXXX'
    };

    // Active Orders in System
    this.orders = this.loadInitialOrders();
    this.lastPlacedOrder = this.orders[this.orders.length - 1] || null;

    // Station Capacity Configuration
    this.stations = [...STATIONS];
  }

  loadInitialOrders() {
    const now = Date.now();
    return [
      {
        id: 'ord_101',
        tokenNumber: 'TK-41',
        pinCode: '4821',
        studentName: 'Rohan Mehta',
        studentRoll: 'TCET-CS-019',
        tierHighest: 'tier3_cook',
        primaryStation: 'dosa_tawa',
        status: 'ready', // 'ordered' | 'cooking' | 'ready' | 'served'
        createdAt: new Date(now - 12 * 60 * 1000).toISOString(),
        readyAt: new Date(now - 2 * 60 * 1000).toISOString(),
        pickupSlot: '11:00 AM - 11:15 AM',
        paymentMethod: 'UPI (GPay)',
        paymentStatus: 'PAID',
        totalAmount: 140,
        items: [
          { menuItemId: 'masala_dosa', name: 'Crispy Butter Masala Dosa', quantity: 2, price: 65, variant: 'Regular' },
          { menuItemId: 'cutting_chai', name: 'Special Cutting Chai', quantity: 1, price: 12, variant: 'Regular' }
        ]
      },
      {
        id: 'ord_102',
        tokenNumber: 'TK-42',
        pinCode: '7193',
        studentName: 'Priya Nair',
        studentRoll: 'TSA-ARCH-088',
        tierHighest: 'tier2_batch',
        primaryStation: 'thali_station',
        status: 'ready',
        createdAt: new Date(now - 8 * 60 * 1000).toISOString(),
        readyAt: new Date(now - 1 * 60 * 1000).toISOString(),
        pickupSlot: '11:00 AM - 11:15 AM',
        paymentMethod: 'Campus Card',
        paymentStatus: 'PAID',
        totalAmount: 110,
        items: [
          { menuItemId: 'thali_deluxe', name: 'Thakur Special Deluxe Thali', quantity: 1, price: 110, customOptions: { bread: '4 Puris' } }
        ]
      },
      {
        id: 'ord_103',
        tokenNumber: 'TK-43',
        pinCode: '3204',
        studentName: 'Karan Joshi',
        studentRoll: 'TCET-EXTC-102',
        tierHighest: 'tier3_cook',
        primaryStation: 'chinese_wok',
        status: 'cooking',
        createdAt: new Date(now - 6 * 60 * 1000).toISOString(),
        readyAt: null,
        pickupSlot: '11:15 AM - 11:30 AM',
        paymentMethod: 'UPI (Paytm)',
        paymentStatus: 'PAID',
        totalAmount: 165,
        items: [
          { menuItemId: 'schezwan_fried_rice', name: 'Veg Schezwan Fried Rice', quantity: 1, price: 85, variant: 'Full Plate' },
          { menuItemId: 'veg_manchurian_dry', name: 'Veg Manchurian Dry', quantity: 1, price: 80, variant: 'Full (8 pcs)' }
        ]
      },
      {
        id: 'ord_104',
        tokenNumber: 'TK-44',
        pinCode: '9012',
        studentName: 'Sneha Patel',
        studentRoll: 'TCET-AI-015',
        tierHighest: 'tier3_cook',
        primaryStation: 'grill_chaat',
        status: 'cooking',
        createdAt: new Date(now - 4 * 60 * 1000).toISOString(),
        readyAt: null,
        pickupSlot: '11:15 AM - 11:30 AM',
        paymentMethod: 'UPI (PhonePe)',
        paymentStatus: 'PAID',
        totalAmount: 135,
        items: [
          { menuItemId: 'veg_cheese_grill_sw', name: 'Mumbai Veg Cheese Grill Sandwich', quantity: 1, price: 75 },
          { menuItemId: 'cold_coffee_icecream', name: 'Cold Coffee with Vanilla Ice Cream', quantity: 1, price: 60 }
        ]
      },
      {
        id: 'ord_105',
        tokenNumber: 'TK-45',
        pinCode: '6458',
        studentName: 'Vikas Gupta',
        studentRoll: 'TCET-MECH-055',
        tierHighest: 'tier2_batch',
        primaryStation: 'snack_counter',
        status: 'ordered',
        createdAt: new Date(now - 2 * 60 * 1000).toISOString(),
        readyAt: null,
        pickupSlot: '11:15 AM - 11:30 AM',
        paymentMethod: 'Cash at Counter',
        paymentStatus: 'UNPAID',
        totalAmount: 58,
        items: [
          { menuItemId: 'vada_pav', name: 'Mumbai Ghati Vada Pav', quantity: 2, price: 18 },
          { menuItemId: 'special_full_chai', name: 'Full Cup Masala Chai', quantity: 1, price: 20 }
        ]
      }
    ];
  }

  // Subscribe to changes
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(fn => fn(this));
  }

  // Role switching
  setRole(role) {
    this.currentRole = role;
    this.notify();
  }

  setCategory(catId) {
    this.activeCategory = catId;
    this.notify();
  }

  setSearchQuery(q) {
    this.searchQuery = q;
    this.notify();
  }

  toggleVegOnly() {
    this.vegOnlyFilter = !this.vegOnlyFilter;
    this.notify();
  }

  // Cart operations
  addToCart(item, variant = null, customOptions = {}) {
    const price = variant ? variant.price : item.basePrice;
    const variantName = variant ? variant.name : 'Regular';
    const key = `${item.id}_${variantName}_${JSON.stringify(customOptions)}`;
    
    const existing = this.cart.find(ci => ci.key === key);
    if (existing) {
      existing.quantity += 1;
    } else {
      this.cart.push({
        key,
        menuItemId: item.id,
        item,
        name: item.name,
        variantName,
        price,
        tier: item.tier,
        station: item.station,
        quantity: 1,
        customOptions
      });
    }
    this.notify();
  }

  updateCartQty(key, delta) {
    const item = this.cart.find(ci => ci.key === key);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      this.cart = this.cart.filter(ci => ci.key !== key);
    }
    this.notify();
  }

  getItemQtyInCart(itemId) {
    return this.cart
      .filter(ci => ci.menuItemId === itemId)
      .reduce((sum, ci) => sum + ci.quantity, 0);
  }

  clearCart() {
    this.cart = [];
    this.notify();
  }

  getCartTotal() {
    return this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  getCartEstimatedWaitTime() {
    if (this.cart.length === 0) return 0;
    // Calculate station load for items in cart
    let maxStationWait = 2; // base
    const hasCookTier = this.cart.some(ci => ci.tier === 'tier3_cook');
    const hasBatchTier = this.cart.some(ci => ci.tier === 'tier2_batch');

    if (hasCookTier) {
      // Find queue depth for stations in cart
      const stationsInCart = new Set(this.cart.map(ci => ci.station));
      const activeCookOrders = this.orders.filter(o => o.status === 'cooking' || o.status === 'ordered');
      const stationOrderCount = activeCookOrders.filter(o => stationsInCart.has(o.primaryStation)).length;
      maxStationWait = 6 + (stationOrderCount * 2);
    } else if (hasBatchTier) {
      maxStationWait = 3;
    } else {
      maxStationWait = 1;
    }
    return maxStationWait;
  }

  // Place Order
  placeOrder(paymentMethod = 'UPI (GPay)') {
    if (this.cart.length === 0) return null;

    const nextTokenNum = `TK-${this.orders.length + 42}`;
    const cryptoArr = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(cryptoArr);
    const pin = (1000 + (cryptoArr[0] % 9000)).toString();

    // Determine highest tier and primary station
    let highestTier = 'tier1_instant';
    if (this.cart.some(c => c.tier === 'tier3_cook')) {
      highestTier = 'tier3_cook';
    } else if (this.cart.some(c => c.tier === 'tier2_batch')) {
      highestTier = 'tier2_batch';
    }

    const primaryStation = this.cart.find(c => c.tier === highestTier)?.station || 'thali_station';

    const newOrder = {
      id: `ord_${Date.now()}`,
      tokenNumber: nextTokenNum,
      pinCode: pin,
      studentName: this.currentStudent.name,
      studentRoll: this.currentStudent.rollNo,
      tierHighest: highestTier,
      primaryStation,
      status: highestTier === 'tier1_instant' ? 'ready' : 'ordered',
      createdAt: new Date().toISOString(),
      readyAt: highestTier === 'tier1_instant' ? new Date().toISOString() : null,
      pickupSlot: this.selectedPickupSlot,
      paymentMethod,
      paymentStatus: paymentMethod === 'Cash at Counter' ? 'UNPAID' : 'PAID',
      totalAmount: this.getCartTotal(),
      items: this.cart.map(c => ({
        menuItemId: c.menuItemId,
        name: c.name,
        quantity: c.quantity,
        price: c.price,
        variant: c.variantName,
        customOptions: c.customOptions
      }))
    };

    this.orders.push(newOrder);
    this.lastPlacedOrder = newOrder;
    this.cart = [];
    
    // Play chime sound
    this.playAudioNotification('order_placed');
    this.notify();
    return newOrder;
  }

  // Order status management (Kitchen / Counter)
  updateOrderStatus(orderId, newStatus) {
    const order = this.orders.find(o => o.id === orderId);
    if (!order) return;
    
    order.status = newStatus;
    if (newStatus === 'ready') {
      order.readyAt = new Date().toISOString();
      this.playAudioNotification('token_ready');
    }
    this.notify();
  }

  // Today's Board management
  updateTodaysBoard(updates) {
    this.todaysBoard = { ...this.todaysBoard, ...updates };
    this.notify();
  }

  toggleItemStock(itemId) {
    if (this.outOfStockItems.has(itemId)) {
      this.outOfStockItems.delete(itemId);
    } else {
      this.outOfStockItems.add(itemId);
    }
    this.notify();
  }

  // Pleasant Web Audio Chime generator
  playAudioNotification(type = 'token_ready') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      if (type === 'token_ready') {
        // Canteen Token Bell (Dual tone Ding-Dong)
        const playTone = (freq, start, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        };
        playTone(587.33, 0, 0.4); // D5
        playTone(880.00, 0.25, 0.6); // A5
      } else if (type === 'order_placed') {
        // Crisp success sound
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15); // E5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {
      console.log('Web audio unavailable or blocked by user gesture:', e);
    }
  }
}

export const appState = new StateStore();
