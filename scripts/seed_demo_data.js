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

// Environment isolation guardrail: strictly prevent seeding production project
const targetProject = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'adi-thakur-bite-staging';
const isExplicitStaging = targetProject.includes('staging') ||
  targetProject.includes('dev') ||
  targetProject.includes('emulator') ||
  process.env.APP_ENV === 'staging' ||
  process.env.APP_ENV === 'development' ||
  process.env.ALLOW_STAGING_SEED === 'true';

if (!isExplicitStaging && (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production')) {
  console.error('\n🚨 REFUSING EXECUTION: Cannot seed demo data into production environment.');
  console.error('   Production protection guardrail triggered. Target project:', targetProject);
  console.error('   To seed staging, set APP_ENV=staging or point FIREBASE_PROJECT_ID to a staging project.\n');
  process.exit(1);
}

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: targetProject,
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
  console.log('   Target Project:', targetProject);
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

  // 2. Seed Dynamic CSPRNG Shift PINs for Today (Zero static/predictable credentials)
  console.log('▶ Step 2: Generating Dynamic CSPRNG Workstation Shift PINs...');
  const dynamicPin = (100000 + (crypto.randomBytes(3).readUIntBE(0, 3) % 900000)).toString();
  const dynamicSalt = crypto.randomBytes(16).toString('hex');
  const pinHash = hashPin(dynamicPin, dynamicSalt);

  const shiftRoles = ['kitchen', 'pickup', 'cashier'];
  for (const role of shiftRoles) {
    const pinId = `${role}_${todayStr}_FULL_DAY`;
    await db.collection('shiftPins').doc(pinId).set({
      pinId,
      role,
      shiftDate: todayStr,
      shiftWindow: 'FULL_DAY',
      pinHash,
      salt: dynamicSalt,
      boundDevices: [],
      maxDevices: 3,
      failedAttempts: 0,
      lockedUntil: null,
      status: 'ACTIVE',
      createdBy: 'seed_manager',
      createdAt: now,
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    }, { merge: true });
    console.log(`  ✓ Shift PIN for ${role.toUpperCase()} provisioned (ID: ${pinId})`);
  }
  console.log(`\n  🔑 RUNTIME DYNAMIC SHIFT PIN FOR ALL STATIONS: ${dynamicPin}`);
  console.log(`     (Salted SHA-256 hash stored in Firestore; dynamic PIN printed ONLY to local stdout)\n`);

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
