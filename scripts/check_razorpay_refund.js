#!/usr/bin/env node
/**
 * Thakur Bites — Razorpay Payment & Refund Verification CLI Tool
 *
 * Usage:
 *   node scripts/check_razorpay_refund.js <paymentId>
 *   node scripts/check_razorpay_refund.js <paymentId> --refund
 *
 * Example:
 *   node scripts/check_razorpay_refund.js pay_Pl9qXYZ123
 */

const https = require('https');

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_GATEWAY_SECRET;

if (!KEY_ID) {
  console.error('\n❌ RAZORPAY_KEY_ID environment variable is required.\n   Set it: export RAZORPAY_KEY_ID="rzp_test_..." or export RAZORPAY_KEY_ID="rzp_live_..."\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const paymentId = args.find(a => a.startsWith('pay_'));
const shouldRefund = args.includes('--refund');

if (!paymentId) {
  console.log('\n❌ Please specify a Razorpay payment ID (e.g. pay_XXXXX)\n');
  console.log('Usage:');
  console.log('  node scripts/check_razorpay_refund.js <payment_id>');
  console.log('  node scripts/check_razorpay_refund.js <payment_id> --refund\n');
  process.exit(1);
}

function razorpayRequest(path, method, bodyData, keySecret) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${KEY_ID}:${keySecret}`).toString('base64');
    const postData = bodyData ? JSON.stringify(bodyData) : null;

    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🔍  RAZORPAY PAYMENT & REFUND AUDIT TOOL');
  console.log(`    Key ID     : ${KEY_ID}`);
  console.log(`    Payment ID : ${paymentId}`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (!KEY_SECRET) {
    console.log('ℹ️  Note: RAZORPAY_KEY_SECRET is not set in environment.');
    console.log('    To execute requests against Razorpay API, set:');
    console.log('    export RAZORPAY_KEY_SECRET="your_razorpay_secret_key"\n');
    console.log('    Without the secret, the Razorpay API returns 401 Unauthorized.');
    console.log('    This is why client apps (browsers/mobile) cannot issue refunds directly.\n');
  }

  console.log(`▶ Querying Razorpay status for ${paymentId}...`);
  try {
    const result = await razorpayRequest(`/v1/payments/${paymentId}`, 'GET', null, KEY_SECRET);

    if (result.status === 401) {
      console.log('❌ 401 Unauthorized: Razorpay rejected the request because the Secret Key was not provided.');
      console.log('   Run with secret: RAZORPAY_KEY_SECRET=xxx node scripts/check_razorpay_refund.js ' + paymentId);
      return;
    }

    if (result.status === 404) {
      console.log(`❌ 404 Not Found: Payment ${paymentId} was not found on Razorpay account.`);
      return;
    }

    const p = result.data;
    console.log('\n📊 Payment Gateway Record:');
    console.log(`   • ID             : ${p.id}`);
    console.log(`   • Status         : ${p.status?.toUpperCase()}`);
    console.log(`   • Amount         : ₹${(p.amount / 100).toFixed(2)}`);
    console.log(`   • Amount Refunded: ₹${((p.amount_refunded || 0) / 100).toFixed(2)}`);
    console.log(`   • Refund Status  : ${p.refund_status || 'NONE'}`);
    console.log(`   • Method         : ${p.method || 'N/A'}`);
    console.log(`   • Email / Phone  : ${p.email || 'N/A'} / ${p.contact || 'N/A'}`);
    console.log(`   • Created At     : ${new Date(p.created_at * 1000).toLocaleString()}`);

    if (p.refund_status === 'full') {
      console.log('\n✅ This payment has ALREADY been fully refunded by Razorpay.');
    } else if (p.amount_refunded > 0) {
      console.log('\n⚠️  This payment has been PARTIALLY refunded by Razorpay.');
    } else {
      console.log('\nℹ️  Razorpay Gateway Status: NO REFUND has been issued on Razorpay yet.');
      console.log('   The money is currently in CAPTURED state in your Razorpay merchant balance.');
    }

    if (shouldRefund && p.status === 'captured' && p.refund_status !== 'full') {
      console.log(`\n▶ Initiating real refund via Razorpay API...`);
      const refundablePaise = p.amount - (p.amount_refunded || 0);
      const refundRes = await razorpayRequest(`/v1/payments/${paymentId}/refund`, 'POST', {
        amount: refundablePaise,
        speed: 'optimum',
        notes: { reason: 'Student order cancelled via Thakur Bites' },
      }, KEY_SECRET);

      if (refundRes.status === 200) {
        console.log('🎉 REFUND SUCCESSFUL ON RAZORPAY GATEWAY!');
        console.log(`   • Official Refund ID : ${refundRes.data.id}`);
        console.log(`   • Refund Status      : ${refundRes.data.status}`);
        console.log(`   • Refunded Amount    : ₹${(refundRes.data.amount / 100).toFixed(2)}`);
      } else {
        console.log('❌ Refund failed on Razorpay:', refundRes.data);
      }
    }
  } catch (err) {
    console.error('Request error:', err.message);
  }
}

run();
