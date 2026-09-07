#!/usr/bin/env node

/**
 * 🛡️ Thakur Bites Platform 2.0 — App Check Attestation Health Audit
 * 
 * Verifies live App Check provider configurations across Web, Android, and iOS,
 * checking provider readiness before toggling enforcement mode in production.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'adi-thakur-bite';
const PROJECT_NUMBER = '391012293021';
const ROOT_DIR = path.resolve(__dirname, '..');

const APPS = {
  android: '1:391012293021:android:3928767c76769bc6c97774',
  ios: '1:391012293021:ios:8df854cb214c126fc97774',
  web: '1:391012293021:web:72dfeb37658ab087c97774',
};

async function getAccessToken() {
  const p = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.tokens?.access_token || null;
  } catch (e) {
    return null;
  }
}

function apiGet(url, token) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'ThakurBites-AppCheckAudit/1.0',
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
    }).on('error', err => resolve({ error: err.message }));
  });
}

async function verifyAppCheck() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🛡️  THAKUR BITES — APP CHECK ATTESTATION HEALTH AUDIT');
  console.log(`   Target Project: ${PROJECT_ID} (${PROJECT_NUMBER})`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const token = await getAccessToken();
  if (!token) {
    console.error('❌ Firebase CLI token not found. Run `firebase login` first.');
    process.exit(1);
  }

  // 1. Android Play Integrity
  console.log('▶ 1. Checking Android Play Integrity Provider...');
  const androidRes = await apiGet(
    `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_NUMBER}/apps/${APPS.android}/playIntegrityConfig`,
    token
  );
  if (androidRes.status === 200) {
    console.log('   ✓ Android Play Integrity is REGISTERED.');
    console.log(`     Token TTL: ${androidRes.data.tokenTtl || 'Default'}`);
  } else {
    console.log('   ⚠️ Android Play Integrity is NOT registered:', androidRes.data?.error?.message || androidRes.status);
  }

  // 2. iOS App Attest
  console.log('\n▶ 2. Checking iOS App Attest Provider...');
  const iosRes = await apiGet(
    `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_NUMBER}/apps/${APPS.ios}/appAttestConfig`,
    token
  );
  if (iosRes.status === 200) {
    console.log('   ✓ iOS App Attest is REGISTERED.');
    console.log(`     Token TTL: ${iosRes.data.tokenTtl || 'Default'}`);
  } else {
    console.log('   ⚠️ iOS App Attest is NOT registered:', iosRes.data?.error?.message || iosRes.status);
  }

  // 3. Web reCAPTCHA v3
  console.log('\n▶ 3. Checking Web reCAPTCHA v3 Provider...');
  const webRes = await apiGet(
    `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_NUMBER}/apps/${APPS.web}/recaptchaV3Config`,
    token
  );
  if (webRes.status === 200) {
    console.log('   ✓ Web reCAPTCHA v3 is REGISTERED.');
    console.log(`     Min Valid Score: ${webRes.data.minValidScore}`);
    console.log(`     Token TTL: ${webRes.data.tokenTtl || 'Default'}`);
  } else {
    console.log('   ⚠️ Web reCAPTCHA v3 is NOT registered:', webRes.data?.error?.message || webRes.status);
  }

  // 4. Service Enforcement Status
  console.log('\n▶ 4. Evaluating Service Enforcement Status...');
  const servicesRes = await apiGet(
    `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT_NUMBER}/services`,
    token
  );
  if (servicesRes.status === 200 && servicesRes.data.services) {
    servicesRes.data.services.forEach(svc => {
      const svcName = svc.name.split('/').pop();
      const mode = svc.enforcementMode;
      const icon = mode === 'ENFORCED' ? '🔒' : '👁️';
      console.log(`   ${icon} ${svcName}: ${mode}`);
    });
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('💡 RECOMMENDATION: Keep services in UNENFORCED (Monitoring) mode until');
  console.log('   production web and mobile apps report 100% valid attestation token metrics');
  console.log('   in Firebase Console, then toggle to ENFORCED to avoid locking out users.');
  console.log('══════════════════════════════════════════════════════════════════════');
}

verifyAppCheck().catch(console.error);
