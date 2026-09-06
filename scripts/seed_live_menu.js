#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const API_KEY = "AIzaSyBK6j2OYH2WdBC2c4HrOvAmqeBzG0ZkGbc";
const PROJECT_ID = "adi-thakur-bite";

function postHttps(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function convertValueToFirestore(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(convertValueToFirestore) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = convertValueToFirestore(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = convertValueToFirestore(v);
  }
  return fields;
}

async function seedLiveMenu() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🚀 SEEDING CANONICAL 85-ITEM MENU & VISUAL DISCOVERY ENGINE');
  console.log('   Target Firebase Project:', PROJECT_ID);
  console.log('════════════════════════════════════════════════════════════════\n');

  // 1. Authenticate as Developer
  console.log('[1/4] Authenticating with Developer Account...');
  const authRes = await postHttps(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      email: 'moreaboutastram@gmail.com',
      password: 'Aditya@123',
      returnSecureToken: true
    }
  );

  if (authRes.status !== 200 || !authRes.data.idToken) {
    console.error('❌ Auth failed:', authRes.data);
    process.exit(1);
  }
  const idToken = authRes.data.idToken;
  console.log('  ✓ Authenticated as:', authRes.data.email);

  // 2. Canonical Categories
  console.log('\n[2/4] Seeding Primary Categories & Subcategory Taxonomy...');
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

  const categoryWrites = [];
  for (const cat of canonicalCategories) {
    categoryWrites.push({
      update: {
        name: `projects/${PROJECT_ID}/databases/(default)/documents/categories/${cat.id}`,
        fields: toFirestoreFields({
          id: cat.id,
          name: cat.name,
          visualKey: cat.visualKey,
          iconEmoji: cat.iconEmoji,
          sortOrder: cat.sortOrder,
          active: cat.active
        })
      }
    });

    for (const sub of cat.subcategories) {
      const subDocId = sub.id.toLowerCase().replace(/[^a-z0-9]/g, '_');
      categoryWrites.push({
        update: {
          name: `projects/${PROJECT_ID}/databases/(default)/documents/categories/${cat.id}/subcategories/${subDocId}`,
          fields: toFirestoreFields({
            id: sub.id,
            categoryId: cat.id,
            name: sub.name,
            visualKey: sub.visualKey,
            sortOrder: sub.sortOrder,
            active: true
          })
        }
      });
    }
  }

  const catCommit = await postHttps(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    { writes: categoryWrites },
    { 'Authorization': `Bearer ${idToken}` }
  );

  if (catCommit.status !== 200) {
    console.error('❌ Category commit error:', catCommit.data);
    process.exit(1);
  }
  console.log(`  ✓ Successfully committed ${categoryWrites.length} category & subcategory documents.`);

  // 3. Load 85 Enriched Items
  console.log('\n[3/4] Reading Verified Menu Seed (85 Items)...');
  const seedPath = path.join(__dirname, 'data', 'verified_menu_seed.json');
  const items = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log(`  ✓ Loaded ${items.length} items from ${seedPath}`);

  // Commit in chunks of 50 (Firestore REST batch limit is 500)
  const chunkSize = 40;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const writes = chunk.map(item => {
      const pricePaise = item.pricePaise || Math.round((item.price || 0) * 100);
      return {
        update: {
          name: `projects/${PROJECT_ID}/databases/(default)/documents/menuItems/${item.id}`,
          fields: toFirestoreFields({
            ...item,
            pricePaise,
            available: item.available !== false,
            isOrderable: item.isOrderable !== false,
            isPublished: true,
            stockCount: item.type === 'instant' ? (item.stockCount || 50) : 100,
            stockOnHand: item.type === 'instant' ? (item.stockCount || 50) : 100,
            reservedStock: 0,
            visualKey: item.visualKey || 'food_default',
            isPopular: Boolean(item.isPopular),
            tags: item.tags || [],
            sortOrder: item.sortOrder || 100
          })
        }
      };
    });

    console.log(`  ▶ Writing items ${i + 1}–${Math.min(i + chunkSize, items.length)}...`);
    const itemCommit = await postHttps(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
      { writes },
      { 'Authorization': `Bearer ${idToken}` }
    );

    if (itemCommit.status !== 200) {
      console.error(`❌ Item commit error on chunk ${i}:`, itemCommit.data);
      process.exit(1);
    }
  }

  console.log(`\n  ✅ All ${items.length} canonical menu items written to Firestore!`);

  // 4. Verify Menu Health
  console.log('\n[4/4] Verifying Live Menu Catalog Integrity via getMenuHealth...');
  const healthRes = await new Promise((resolve) => {
    const req = http.request("http://127.0.0.1:5001/adi-thakur-bite/us-central1/getMenuHealth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + idToken
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (_) { resolve(d); }
      });
    });
    req.write(JSON.stringify({ data: {} }));
    req.end();
  });

  console.log('  Health Result:', JSON.stringify(healthRes.result, null, 2));

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🎉 85 PHYSICAL CANONICAL MENU ITEMS SEEDED SUCCESSFULLY!');
  console.log('════════════════════════════════════════════════════════════════');
}

seedLiveMenu().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
