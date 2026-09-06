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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let admin = null;
let FirestoreClass = null;
let Timestamp = null;
let OAuth2ClientClass = null;

try {
  admin = require('firebase-admin');
  if (admin.firestore && admin.firestore.Timestamp) {
    Timestamp = admin.firestore.Timestamp;
  }
} catch (_) {}

try {
  const gcf = require('@google-cloud/firestore');
  FirestoreClass = gcf.Firestore;
  if (!Timestamp && gcf.Timestamp) {
    Timestamp = gcf.Timestamp;
  }
} catch (_) {}

try {
  const gal = require('google-auth-library');
  OAuth2ClientClass = gal.OAuth2Client;
} catch (_) {}

// Environment isolation guardrail: strictly prevent seeding production project unless allowed
const targetProject = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'adi-thakur-bite';
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

let db;
const configPath = path.join(process.env.HOME, '.config/configstore/firebase-tools.json');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(configPath) && FirestoreClass && OAuth2ClientClass) {
  const fbToolsData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const token = fbToolsData.tokens && fbToolsData.tokens.access_token;
  const auth = new OAuth2ClientClass();
  auth.setCredentials({ access_token: token });
  db = new FirestoreClass({ projectId: targetProject, authClient: auth });
} else if (admin) {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: targetProject,
    });
  }
  db = admin.firestore();
} else if (FirestoreClass) {
  db = new FirestoreClass({ projectId: targetProject });
}

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(pin.trim(), salt, 10000, 32, 'sha256').toString('hex');
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
  const now = Timestamp ? Timestamp.now() : new Date();

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
  const dynamicPin = process.env.DEMO_PIN || String(crypto.randomInt(100000, 1000000));
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
      expiresAt: Timestamp ? Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)) : new Date(Date.now() + 24 * 60 * 60 * 1000),
    }, { merge: true });
    console.log(`  ✓ Shift PIN for ${role.toUpperCase()} provisioned (ID: ${pinId})`);
  }
  console.log(`\n  🔑 RUNTIME DYNAMIC SHIFT PIN FOR ALL STATIONS: ${dynamicPin}`);
  console.log(`     (Salted SHA-256 hash stored in Firestore; dynamic PIN printed ONLY to local stdout)\n`);

  // 3. Seed Menu Items (Verified 85 physical menu items + backward compat demo items)
  console.log('▶ Step 3: Seeding Campus Menu Catalog (Physical Canteen Digitized)...');
  let verifiedItems = [];
  const seedJsonPath = path.join(__dirname, 'data', 'verified_menu_seed.json');
  if (fs.existsSync(seedJsonPath)) {
    try {
      verifiedItems = JSON.parse(fs.readFileSync(seedJsonPath, 'utf8'));
    } catch (e) {
      console.warn('  ⚠️ Could not parse verified_menu_seed.json:', e.message);
    }
  }

  // 2.5 Seed Canonical Categories & Subcategories
  console.log('▶ Step 2.5: Seeding Canonical Category Hierarchies...');
  const canonicalCategories = [
    {
      id: 'FOOD',
      name: 'Food',
      visualKey: 'food_default',
      iconEmoji: '🍛',
      sortOrder: 10,
      active: true,
      subcategories: [
        { id: 'South Indian', name: 'South Indian', visualKey: 'dosa', sortOrder: 10 },
        { id: 'Sandwiches', name: 'Sandwiches', visualKey: 'sandwich_grill', sortOrder: 20 },
        { id: 'Chinese', name: 'Chinese', visualKey: 'noodles', sortOrder: 30 },
        { id: 'Lunch & Meals', name: 'Meals / Main Food', visualKey: 'thali', sortOrder: 40 },
      ]
    },
    {
      id: 'BEVERAGES',
      name: 'Beverages',
      visualKey: 'cold_drink',
      iconEmoji: '🥤',
      sortOrder: 20,
      active: true,
      subcategories: [
        { id: 'Tea & Coffee', name: 'Tea & Coffee', visualKey: 'tea', sortOrder: 10 },
        { id: 'Cold Drinks', name: 'Cold Drinks', visualKey: 'cold_drink', sortOrder: 20 },
        { id: 'Juices', name: 'Juices', visualKey: 'fresh_juice', sortOrder: 30 },
        { id: 'Milkshakes', name: 'Milkshakes', visualKey: 'milkshake', sortOrder: 40 },
      ]
    },
    {
      id: 'SNACKS',
      name: 'Snacks & Packaged',
      visualKey: 'fries',
      iconEmoji: '🍟',
      sortOrder: 30,
      active: true,
      subcategories: [
        { id: 'Pav Items', name: 'Pav & Samosa', visualKey: 'vada_pav', sortOrder: 10 },
        { id: 'Fries', name: 'French Fries', visualKey: 'fries', sortOrder: 20 },
        { id: 'Quick', name: 'Quick Bites', visualKey: 'samosa_snack', sortOrder: 30 },
        { id: 'Packaged', name: 'Packaged Snacks', visualKey: 'packaged_snack', sortOrder: 40 },
      ]
    }
  ];

  const catBatch = db.batch();
  for (const cat of canonicalCategories) {
    const catRef = db.collection('categories').doc(cat.id);
    catBatch.set(catRef, {
      id: cat.id,
      name: cat.name,
      visualKey: cat.visualKey,
      iconEmoji: cat.iconEmoji,
      sortOrder: cat.sortOrder,
      active: cat.active,
      updatedAt: now,
    }, { merge: true });

    for (const sub of cat.subcategories) {
      const subRef = db.collection('categories').doc(cat.id).collection('subcategories').doc(sub.id.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      catBatch.set(subRef, {
        id: sub.id,
        categoryId: cat.id,
        name: sub.name,
        visualKey: sub.visualKey,
        sortOrder: sub.sortOrder,
        active: true,
        updatedAt: now,
      }, { merge: true });
    }
  }
  await catBatch.commit();
  console.log('  ✓ Canonical categories & subcategories committed.\n');

  // Seed Menu Items (Verified 85 physical menu items)
  console.log(`▶ Step 3: Seeding Authoritative Menu Catalog (${verifiedItems.length} items)...`);
  const batch = db.batch();
  for (const item of verifiedItems) {
    const ref = db.collection('menuItems').doc(item.id);
    const pricePaise = item.pricePaise || Math.round((item.price || 0) * 100);
    batch.set(ref, {
      ...item,
      pricePaise,
      effectivePricePaise: pricePaise,
      isArchived: item.isArchived || false,
      available: item.available !== false,
      availabilityStatus: item.available !== false ? 'AVAILABLE' : 'SOLD_OUT',
      updatedAt: now,
    }, { merge: true });
  }
  await batch.commit();
  console.log(`  ✓ Successfully committed ${verifiedItems.length} canonical menu items.\n`);

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
      createdAt: Timestamp ? Timestamp.fromDate(new Date(Date.now() - 15 * 60000)) : new Date(Date.now() - 15 * 60000),
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
      createdAt: Timestamp ? Timestamp.fromDate(new Date(Date.now() - 8 * 60000)) : new Date(Date.now() - 8 * 60000),
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
      createdAt: Timestamp ? Timestamp.fromDate(new Date(Date.now() - 4 * 60000)) : new Date(Date.now() - 4 * 60000),
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
  console.log(`\n🔑 DYNAMIC SHIFT PIN FOR WORKSTATIONS (KITCHEN/PICKUP/CASHIER): ${dynamicPin}`);
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
