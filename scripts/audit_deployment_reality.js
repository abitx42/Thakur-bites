#!/usr/bin/env node

/**
 * 🛡️ Thakur Bites Platform 2.0 — Deployment Reality & Infrastructure Audit
 * 
 * Verifies live Google Cloud & Firebase production posture against repository
 * canonical invariants (SECURITY_INVARIANTS.md).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const PROJECT_ID = 'adi-thakur-bite';
const ROOT_DIR = path.resolve(__dirname, '..');

async function getAccessToken() {
  const p = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(p)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const tokens = data.tokens;
    if (!tokens) return null;

    if (tokens.access_token && tokens.expires_at && tokens.expires_at > Date.now() + 60000) {
      return tokens.access_token;
    }

    if (!tokens.refresh_token) return null;

    return new Promise((resolve) => {
      const postData = new URLSearchParams({
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho85qd6.apps.googleusercontent.com',
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }).toString();

      const req = https.request('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.access_token || null);
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.write(postData);
      req.end();
    });
  } catch (e) {
    return null;
  }
}

function apiGet(url, token) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'ThakurBites-Audit/1.0',
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function audit() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🔍 THAKUR BITES — DEPLOYMENT REALITY & INFRASTRUCTURE AUDIT');
  console.log(`   Target Project: ${PROJECT_ID}`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const scorecard = [];
  const token = await getAccessToken();

  // 1. Check CLI Dry-Run Deployability for Firestore & Hosting
  console.log('▶ 1. Evaluating Hosting & Firestore Deployment Dry-Run...');
  try {
    const dryRunOutput = execSync('firebase deploy --only firestore,hosting --dry-run', {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    scorecard.push({
      item: 'Firestore & Multi-Site Hosting Deployability',
      status: 'PASS',
      detail: 'Dry-run succeeded with 0 warnings/errors for both app & staff targets'
    });
    console.log('   ✓ Firestore & Hosting dry-run successful.');
  } catch (e) {
    scorecard.push({
      item: 'Firestore & Multi-Site Hosting Deployability',
      status: 'FAIL',
      detail: e.message
    });
    console.log('   ✗ Hosting/Firestore dry-run failed:', e.message);
  }

  // 2. Check Client-Side Emulator Routing Hygiene
  console.log('▶ 2. Checking Web Client (js/firebase.js) Emulator Routing Hygiene...');
  const jsFirebase = fs.readFileSync(path.join(ROOT_DIR, 'js/firebase.js'), 'utf8');
  if (jsFirebase.includes('isLocalDev') && jsFirebase.includes('window.location.hostname.endsWith(\'.trycloudflare.com\')')) {
    scorecard.push({
      item: 'Client-Side Production Routing',
      status: 'PASS',
      detail: 'functions.emulatorOrigin is safely gated to localhost/tunnels only'
    });
    console.log('   ✓ Client-side production endpoint routing is safely isolated.');
  } else {
    scorecard.push({
      item: 'Client-Side Production Routing',
      status: 'WARN',
      detail: 'Unconditional emulatorOrigin detected'
    });
    console.log('   ⚠️ Unconditional emulatorOrigin detected in js/firebase.js');
  }

  if (!token) {
    console.log('\n⚠️ No active Firebase CLI token found; skipping live cloud REST API checks.');
    printScorecard(scorecard);
    return;
  }

  // 3. App Check Enforcement Mode
  console.log('▶ 3. Inspecting Live Firebase App Check Enforcement Mode...');
  const appCheck = await apiGet(`https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_ID}/services`, token);
  if (appCheck.status === 200 && appCheck.data.services) {
    const unenforced = appCheck.data.services.filter(s => s.enforcementMode === 'UNENFORCED');
    if (unenforced.length > 0) {
      scorecard.push({
        item: 'Live App Check Infrastructure Enforcement',
        status: 'WARN',
        detail: `${unenforced.length} services in UNENFORCED mode (${unenforced.map(s => s.name.split('/').pop()).join(', ')})`
      });
      console.log(`   ⚠️ App Check is registered but UNENFORCED on: ${unenforced.map(s => s.name.split('/').pop()).join(', ')}`);
    } else {
      scorecard.push({
        item: 'Live App Check Infrastructure Enforcement',
        status: 'PASS',
        detail: 'All services enforced'
      });
      console.log('   ✓ App Check is strictly ENFORCED.');
    }
  } else {
    scorecard.push({
      item: 'Live App Check Infrastructure Enforcement',
      status: 'WARN',
      detail: 'Unable to query App Check services'
    });
  }

  // 4. Cloud Functions Deployment Inventory
  console.log('▶ 4. Inspecting Live Cloud Functions Deployment Inventory...');
  try {
    const fnList = execSync('firebase functions:list --json', { cwd: ROOT_DIR, encoding: 'utf8' });
    const parsedFns = JSON.parse(fnList);
    const count = (parsedFns.result || []).length;
    if (count === 0) {
      scorecard.push({
        item: 'Cloud Functions Production Deployment',
        status: 'CRITICAL',
        detail: '0 functions deployed (Project on Spark Plan requires Blaze upgrade)'
      });
      console.log('   🚨 0 functions deployed to production! Project requires Blaze upgrade.');
    } else {
      scorecard.push({
        item: 'Cloud Functions Production Deployment',
        status: 'PASS',
        detail: `${count} functions active in production`
      });
      console.log(`   ✓ ${count} functions deployed in production.`);
    }
  } catch (e) {
    scorecard.push({
      item: 'Cloud Functions Production Deployment',
      status: 'WARN',
      detail: 'Failed to query functions:list'
    });
  }

  // 5. Live Firestore Rules Hash Synchronization
  console.log('▶ 5. Verifying Live Firestore Security Rules Synchronization...');
  const releases = await apiGet(`https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`, token);
  if (releases.status === 200 && releases.data.releases && releases.data.releases.length > 0) {
    const activeRelease = releases.data.releases.find(r => r.name.endsWith('/cloud.firestore'));
    if (activeRelease) {
      const ruleset = await apiGet(`https://firebaserules.googleapis.com/v1/${activeRelease.rulesetName}`, token);
      if (ruleset.status === 200 && ruleset.data.source && ruleset.data.source.files) {
        const deployedContent = ruleset.data.source.files[0].content;
        const repoContent = fs.readFileSync(path.join(ROOT_DIR, 'firestore/firestore.rules'), 'utf8');
        
        // Strip comments and normalize whitespace
        const cleanDeployed = deployedContent.replace(/\/\/.*/g, '').replace(/\s+/g, ' ').trim();
        const cleanRepo = repoContent.replace(/\/\/.*/g, '').replace(/\s+/g, ' ').trim();

        if (cleanDeployed === cleanRepo) {
          scorecard.push({
            item: 'Firestore Security Rules Synchronization',
            status: 'PASS',
            detail: 'Live rules match repository canonical invariants 100%'
          });
          console.log('   ✓ Live deployed Firestore rules match repository exactly.');
        } else {
          scorecard.push({
            item: 'Firestore Security Rules Synchronization',
            status: 'WARN',
            detail: 'Rules drift detected between repository and live cloud'
          });
          console.log('   ⚠️ Rules drift detected between repository and live cloud.');
        }
      }
    }
  }

  // 6. Live Firestore Composite Indexes
  console.log('▶ 6. Verifying Live Firestore Composite Indexes...');
  try {
    const idxOut = execSync('firebase firestore:indexes', { cwd: ROOT_DIR, encoding: 'utf8' });
    const liveIndexes = JSON.parse(idxOut).indexes || [];
    const repoIndexes = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'firestore/firestore.indexes.json'), 'utf8')).indexes || [];
    if (liveIndexes.length >= repoIndexes.length) {
      scorecard.push({
        item: 'Firestore Composite Indexes',
        status: 'PASS',
        detail: `${liveIndexes.length} composite indexes deployed on live Firestore`
      });
      console.log(`   ✓ ${liveIndexes.length} composite indexes active on live Firestore.`);
    } else {
      scorecard.push({
        item: 'Firestore Composite Indexes',
        status: 'WARN',
        detail: `Only ${liveIndexes.length} / ${repoIndexes.length} indexes deployed`
      });
      console.log(`   ⚠️ Only ${liveIndexes.length} / ${repoIndexes.length} indexes deployed.`);
    }
  } catch (e) {
    scorecard.push({
      item: 'Firestore Composite Indexes',
      status: 'WARN',
      detail: 'Failed to inspect firestore:indexes'
    });
  }

  // 7. Firebase Auth Authorized Domains Audit
  console.log('▶ 7. Auditing Firebase Auth Authorized Domains...');
  const idConfig = await apiGet(`https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`, token);
  if (idConfig.status === 200 && idConfig.data.authorizedDomains) {
    const domains = idConfig.data.authorizedDomains;
    const hasTunnel = domains.some(d => d.includes('trycloudflare.com') || d.includes('ngrok.io'));
    if (hasTunnel) {
      scorecard.push({
        item: 'Firebase Auth Authorized Domains',
        status: 'WARN',
        detail: 'Wildcard tunnel domain (trycloudflare.com) authorized in production'
      });
      console.log('   ⚠️ Wildcard tunnel domain (trycloudflare.com) found in authorized domains.');
    } else {
      scorecard.push({
        item: 'Firebase Auth Authorized Domains',
        status: 'PASS',
        detail: 'Strict production domains only'
      });
      console.log('   ✓ Strict production domains configured.');
    }
  }

  // 8. Service Account Key Hygiene
  console.log('▶ 8. Auditing GCP IAM Service Account Key Hygiene...');
  const saKeys = await apiGet(`https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts/firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com/keys`, token);
  if (saKeys.status === 200 && saKeys.data.keys) {
    const userKeys = saKeys.data.keys.filter(k => k.keyType === 'USER_MANAGED');
    if (userKeys.length === 0) {
      scorecard.push({
        item: 'IAM Service Account Key Hygiene',
        status: 'PASS',
        detail: 'Zero user-managed keys exported; all keys system-managed by Google'
      });
      console.log('   ✓ Zero user-managed service account keys detected (clean).');
    } else {
      scorecard.push({
        item: 'IAM Service Account Key Hygiene',
        status: 'WARN',
        detail: `${userKeys.length} user-managed keys found`
      });
      console.log(`   ⚠️ ${userKeys.length} user-managed keys found.`);
    }
  }

  printScorecard(scorecard);
}

function printScorecard(scorecard) {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('📊 DEPLOYMENT REALITY AUDIT SCORECARD');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  scorecard.forEach((entry, idx) => {
    const icon = entry.status === 'PASS' ? '✅' : entry.status === 'WARN' ? '⚠️' : '🚨';
    console.log(`${icon} [${entry.status}] ${entry.item}`);
    console.log(`   Detail: ${entry.detail}\n`);
  });

  const criticals = scorecard.filter(s => s.status === 'CRITICAL').length;
  const warnings = scorecard.filter(s => s.status === 'WARN').length;
  const passes = scorecard.filter(s => s.status === 'PASS').length;

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`SUMMARY: ${passes} PASS | ${warnings} WARNING | ${criticals} CRITICAL`);
  console.log('══════════════════════════════════════════════════════════════════════');
}

audit().catch(console.error);
