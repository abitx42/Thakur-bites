#!/usr/bin/env node

/**
 * Thakur Bites Platform 2.0 — Interactive Demo Data Seeder
 * Seeds realistic campus canteen data into Firestore for live UI testing:
 * - Menu Items (Kitchen Cooked + Packaged Store)
 * - Active Orders across KDS & TV (Preparing, Ready with Faculty Priority)
 * - Faculty Verification Applications
 * - Workstation Shift PINs
 * - Global Feature Flags
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  // Use default project credentials
  admin.initializeApp({
    projectId: 'adi-thakur-bite',
  });
}

const db = admin.firestore();

function hashPin(pin, salt) {
  return crypto.createHash('sha256').update(`${pin.trim()}_${salt}`).digest('hex');
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function seedDemoData() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🌱 THAKUR BITES PLATFORM 2.0 — DEMO DATA SEEDER');
  console.log('════════════════════════════════════════════════════════════════\n');

  const todayStr = getTodayStr();
  const now = admin.firestore.Timestamp.now();

  // 1. Seed Feature Flags
  console.log('▶ Step 1: Seeding Campus Feature Flags...');
  await db.collection('featureFlags').doc('global').set({
    onlineOrderingEnabled: true,
    priorityQueueEnabled: true,
    rushMultiplier: 1.0,
    cashCounterEnabled: true,
    maxActivePriorityOrdersPerFaculty: 1,
    updatedAt: now,
    updatedBy: 'seed_script',
  }, { merge: true });
  console.log('  ✓ featureFlags/global set.\n');

  // 2. Seed Shift PINs for Today
  console.log('▶ Step 2: Seeding Today Workstation Shift PINs...');
  const testSalt = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
  const defaultPin = '123456';
  const pinHash = hashPin(defaultPin, testSalt);

  const shiftRoles = ['kitchen', 'pickup', 'cashier'];
  for (const role of shiftRoles) {
    const pinId = `${role}_${todayStr}_FULL_DAY`;
    await db.collection('shiftPins').doc(pinId).set({
      pinId,
      role,
      shiftDate: todayStr,
      shiftWindow: 'FULL_DAY',
      pinHash,
      salt: testSalt,
      boundDevices: [],
      maxDevices: 3,
      failedAttempts: 0,
      lockedUntil: null,
      status: 'ACTIVE',
      createdBy: 'seed_manager',
      createdAt: now,
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    }, { merge: true });
    console.log(`  ✓ Shift PIN for ${role.toUpperCase()} created: PIN = ${defaultPin} (ID: ${pinId})`);
  }
  console.log('');

  // 3. Seed Menu Items
  console.log('▶ Step 3: Seeding Campus Menu Catalog...');
  const menuItems = [
    {
      id: 'masala_dosa_01',
      name: 'Mysore Masala Dosa',
      price: 70,
      type: 'cooked',
      category: 'dosa',
      station: 'dosa',
      available: true,
      stockOnHand: 0,
      reservedStock: 0,
      description: 'Crispy butter dosa layered with spicy red garlic chutney and spiced potato masala.',
    },
    {
      id: 'punjabi_samosa_01',
      name: 'Punjabi Samosa (2 pcs)',
      price: 30,
      type: 'instant',
      category: 'snack',
      station: 'counter',
      available: true,
      stockOnHand: 25,
      reservedStock: 2,
      description: 'Golden flaky pastry stuffed with seasoned potatoes, green peas, and whole spices.',
    },
    {
      id: 'cold_coffee_01',
      name: 'Cold Coffee Thick Shake',
      price: 45,
      type: 'instant',
      category: 'beverage',
      station: 'beverage',
      available: true,
      stockOnHand: 18,
      reservedStock: 1,
      description: 'Chilled blended brew with creamy dairy and cocoa drizzle.',
    },
    {
      id: 'veg_grilled_sandwich_01',
      name: 'Bombay Veg Cheese Grill',
      price: 80,
      type: 'cooked',
      category: 'sandwich',
      station: 'sandwich',
      available: true,
      stockOnHand: 0,
      reservedStock: 0,
      description: 'Triple-layer sandwich with beetroot, cucumber, mint chutney, and melted cheese.',
    },
    {
      id: 'amul_buttermilk_01',
      name: 'Amul Masala Buttermilk (200ml)',
      price: 15,
      type: 'instant',
      category: 'beverage',
      station: 'beverage',
      available: true,
      stockOnHand: 40,
      reservedStock: 0,
      description: 'Refreshing spiced buttermilk pouch.',
    }
  ];

  for (const item of menuItems) {
    await db.collection('menuItems').doc(item.id).set({
      ...item,
      updatedAt: now,
    }, { merge: true });
    console.log(`  ✓ Menu item: ${item.name} (₹${item.price}) [${item.type}]`);
  }
  console.log('');

  // 4. Seed Faculty Verification Applications
  console.log('▶ Step 4: Seeding Faculty Verification Applications...');
  const facultyApps = [
    {
      applicationId: 'app_prof_sharma_01',
      userId: 'prof_ramesh_sharma_uid',
      applicationType: 'TEACHER',
      employeeId: 'TCET-FAC-1048',
      department: 'Information Technology',
      designation: 'Associate Professor',
      officialEmail: 'ramesh.sharma@thakureducation.org',
      status: 'SUBMITTED',
      submittedAt: now,
    },
    {
      applicationId: 'app_dr_patil_02',
      userId: 'dr_sneha_patil_uid',
      applicationType: 'TEACHER',
      employeeId: 'TCET-FAC-2091',
      department: 'Computer Engineering',
      designation: 'Assistant Professor',
      officialEmail: 'sneha.patil@thakureducation.org',
      status: 'UNDER_REVIEW',
      submittedAt: now,
    }
  ];

  for (const app of facultyApps) {
    await db.collection('verificationApplications').doc(app.applicationId).set(app, { merge: true });
    console.log(`  ✓ Faculty App: ${app.employeeId} (${app.department}) -> ${app.status}`);
  }
  console.log('');

  // 5. Seed Active Orders
  console.log('▶ Step 5: Seeding Live Active Tickets for Kitchen KDS & TV Display...');
  const demoOrders = [
    {
      orderId: 'demo_order_tb001',
      tokenNumber: 'TB-001',
      studentId: 'student_101',
      studentName: 'Aarav Patel',
      status: 'ready',
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      priorityLevel: 1,
      totalAmountPaise: 7000,
      pinCode: '4920',
      items: [{ name: 'Mysore Masala Dosa', quantity: 1, price: 70 }],
      createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 15 * 60000)),
      updatedAt: now,
    },
    {
      orderId: 'demo_order_tb002',
      tokenNumber: 'TB-002',
      studentId: 'prof_ramesh_sharma_uid',
      studentName: 'Prof. Ramesh Sharma (Faculty)',
      status: 'preparing',
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      priorityLevel: 2,
      priorityReason: 'FACULTY_PRIORITY_APPLIED',
      totalAmountPaise: 8000,
      pinCode: '7154',
      items: [{ name: 'Bombay Veg Cheese Grill', quantity: 1, price: 80 }],
      createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 8 * 60000)),
      updatedAt: now,
    },
    {
      orderId: 'demo_order_tb003',
      tokenNumber: 'TB-003',
      studentId: 'student_103',
      studentName: 'Riya Sen',
      status: 'placed',
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      priorityLevel: 1,
      totalAmountPaise: 6000,
      pinCode: '1839',
      items: [
        { name: 'Punjabi Samosa (2 pcs)', quantity: 1, price: 30 },
        { name: 'Cold Coffee Thick Shake', quantity: 1, price: 45 },
      ],
      createdAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 4 * 60000)),
      updatedAt: now,
    }
  ];

  for (const ord of demoOrders) {
    await db.collection('orders').doc(ord.orderId).set(ord, { merge: true });
    console.log(`  ✓ Order ${ord.tokenNumber} (${ord.status.toUpperCase()}) [Priority Level ${ord.priorityLevel}] seeded.`);
  }

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🏆 DEMO DATA SEEDING COMPLETE! ALL SYSTEMS POPULATED.');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('\n🔑 TEST SHIFT PIN FOR WORKSTATIONS (KITCHEN/PICKUP/CASHIER): 123456');
  console.log('🌐 TV Display: open web_tv/index.html');
  console.log('🖥️ Staff Hub:  open index.html\n');
}

if (require.main === module) {
  seedDemoData().then(() => process.exit(0)).catch(err => {
    console.error('Seeding Error:', err);
    process.exit(1);
  });
}

module.exports = { seedDemoData };
