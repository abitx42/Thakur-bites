'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const orderId = 'pickup-view-regression-order';
const tokenNumber = 'TB-042';
const customerPin = '7391';
const qrPayload = `${orderId}.customer.nonce.9999999999.${'a'.repeat(64)}`;

class Element {
  constructor(attributes = {}) {
    this.attributes = attributes;
    this.id = attributes.id;
    this.tagName = attributes.tagName || 'BUTTON';
    this.value = attributes.value || '';
    this.listeners = new Map();
    this.classList = { add() {} };
    this.disabled = false;
  }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }
  async trigger(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) await callback(event);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  closest() { return new Element(); }
}

// Minimal rendered-DOM fixture: controls come from the real view's generated HTML,
// and tests dispatch their actual event listeners. This is not a source-pattern test.
class Scope {
  set innerHTML(html) {
    this.html = html;
    this.buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => {
      const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => [entry[1], entry[2]]));
      const button = new Element(attributes);
      button.innerHTML = match[2];
      return button;
    });
  }
  get innerHTML() { return this.html; }
  querySelector(selector) {
    return selector.startsWith('#') ? this.buttons.find(button => button.id === selector.slice(1)) || null : null;
  }
  querySelectorAll(selector) {
    return this.buttons.filter(button => (button.attributes.class || '').split(' ').includes(selector.slice(1)));
  }
}

class Container extends Scope {
  set innerHTML(html) {
    super.innerHTML = html;
    this.orders = new Scope();
    this.orders.innerHTML = html;
    this.filter = new Element({ id: 'pickup-filter-input', tagName: 'INPUT' });
    this.clearWrapper = new Scope();
    this.clearWrapper.innerHTML = '';
  }
  get innerHTML() { return super.innerHTML; }
  querySelector(selector) {
    if (selector === '#pickup-orders-container') return this.orders || null;
    if (selector === '#pickup-filter-input') return this.filter || null;
    if (selector === '#filter-clear-wrapper') return this.clearWrapper || null;
    return super.querySelector(selector);
  }
}

async function drain() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function viewHarness(options = {}) {
  const calls = [];
  const fallbackWrites = [];
  const prompts = [];
  const orders = [{
    orderId,
    tokenNumber,
    studentName: 'Customer',
    status: 'ready',
    paymentStatus: 'paid',
    isOnlyReadyMade: false,
    items: [{ name: 'Meal', quantity: 1 }],
    pinCode: '8462', // A readable order field is not proof presented by the customer.
    ...options.order,
  }];
  const windowListeners = new Map();
  const window = {
    addEventListener(name, callback) { windowListeners.set(name, callback); },
    removeEventListener(name, callback) {
      if (windowListeners.get(name) === callback) windowListeners.delete(name);
    },
  };
  const firebase = {
    db: {}, functions: {},
    async fetchPickupOrders() { return orders.map(order => ({ ...order })); },
    async updateOrderStatus(id, status) { fallbackWrites.push({ id, status }); },
    async unlockOrder() {}, async cancelStaffOrder() {}, async processStaffRefund() {},
  };
  const firestore = {
    collection() {}, query() {}, where() {}, limit() {},
    onSnapshot() { return () => {}; },
  };
  const cloudFunctions = {
    httpsCallable(_functions, name) {
      return async (data) => {
        calls.push({ name, data: JSON.parse(JSON.stringify(data)) });
        if (options.waitForVerify) await options.waitForVerify;
        if (options.verifyError) throw options.verifyError;
        const order = orders.find(item => item.orderId === data.orderId);
        if (order) order.status = 'collected';
        return { data: { success: true, orderId: data.orderId, status: 'collected', tokenNumber } };
      };
    },
  };
  const sourcePath = path.resolve(__dirname, '../../js/views/pickupView.js');
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    fileName: sourcePath,
  }).outputText;
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require(specifier) {
      if (specifier.startsWith('../firebase.js')) return firebase;
      if (specifier.includes('firebase-firestore.js')) return firestore;
      if (specifier.includes('firebase-functions.js')) return cloudFunctions;
      if (specifier === './escapeHtml.js') return { escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) };
      if (specifier === '../networkSentinel.js') return { getFriendlyErrorMessage: error => error.message };
      throw new Error(`Unexpected view dependency: ${specifier}`);
    },
    window,
    document: { activeElement: null },
    prompt(message) { prompts.push(message); return options.enteredPin === undefined ? customerPin : options.enteredPin; },
    alert() {}, confirm() { return false; },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    console: { warn() {}, error() {} },
  };
  vm.runInNewContext(compiled, sandbox, { filename: sourcePath });
  const container = new Container();
  mod.exports.renderPickupView(container);
  await drain();

  async function scan(payload, inFilter = false) {
    const target = inFilter ? container.filter : { tagName: 'DIV' };
    let typed = '';
    for (const key of payload) {
      typed += key;
      if (inFilter) target.value = typed;
      windowListeners.get('keydown')?.({ key, target });
    }
    const event = {
      key: 'Enter', target, propagationStopped: false,
      preventDefault() {}, stopPropagation() { this.propagationStopped = true; },
    };
    if (inFilter) await target.trigger('keydown', event);
    if (!event.propagationStopped) windowListeners.get('keydown')?.(event);
    await drain();
  }
  return { container, calls, fallbackWrites, prompts, scan };
}

describe('Pickup real view event regressions (offline callable/DOM fixtures)', () => {
  it('renders credential collection, without a one-tap bypass or readable PIN display', async () => {
    const h = await viewHarness();
    assert.equal(h.container.orders.querySelectorAll('.collect-action-btn').length, 0);
    assert.equal(h.container.orders.querySelectorAll('.verify-pin-btn').length, 1);
    assert.ok(!h.container.innerHTML.includes('8462'));
  });

  it('manual collection submits the customer-entered PIN, never an order field or staffVerified', async () => {
    const h = await viewHarness();
    await h.container.orders.querySelectorAll('.verify-pin-btn')[0].trigger('click');
    assert.equal(h.prompts.length, 1);
    assert.deepEqual(h.calls, [{ name: 'verifyPickup', data: { orderId, pinCode: customerPin } }]);
    assert.equal(h.fallbackWrites.length, 0);
  });

  it('a failed manual verification cannot fall back to a direct collection write', async () => {
    const h = await viewHarness({ order: { pinCode: undefined }, verifyError: new Error('internal verification outage') });
    await h.container.orders.querySelectorAll('.verify-pin-btn')[0].trigger('click');
    assert.equal(h.calls.length, 1);
    assert.equal(h.fallbackWrites.length, 0);
    assert.ok(h.container.innerHTML.includes('Verification Failed'));
  });

  it('cancelled or malformed manual PIN input never invokes the callable', async () => {
    for (const enteredPin of [null, '', 'x', '123456789']) {
      const h = await viewHarness({ enteredPin });
      await h.container.orders.querySelectorAll('.verify-pin-btn')[0].trigger('click');
      assert.equal(h.calls.length, 0);
      assert.equal(h.fallbackWrites.length, 0);
    }
  });

  it('preserves mobile TB: QR scans by forwarding their real customer PIN', async () => {
    const h = await viewHarness();
    await h.scan(`TB:${orderId}:${tokenNumber}:${customerPin}`);
    assert.deepEqual(h.calls, [{ name: 'verifyPickup', data: { orderId, pinCode: customerPin } }]);
    assert.equal(h.fallbackWrites.length, 0);
    assert.ok(h.container.innerHTML.includes('Verified &amp; Handed Over'));
  });

  it('preserves the rotating six-field mobile QR format used by the Flutter app', async () => {
    const timeBlock = Math.floor(Date.now() / 30000);
    const raw = `${orderId}:${customerPin}:${timeBlock}`;
    const digest = [...raw].reduce((hash, char) => BigInt.asUintN(32,
      (hash ^ BigInt(char.charCodeAt(0))) * 0x01000193n), 0x811c9dc5n);
    const hash = digest.toString(16).toUpperCase().padStart(8, '0');
    const h = await viewHarness();
    await h.scan(`TB:${orderId}:${tokenNumber}:${customerPin}:${timeBlock}:${hash}`);
    assert.deepEqual(h.calls, [{ name: 'verifyPickup', data: { orderId, pinCode: customerPin } }]);
  });

  it('rejects malformed or stale mobile QR passes without invoking collection', async () => {
    for (const payload of [
      `TB:${orderId}:${tokenNumber}:`,
      `TB:${orderId}:${tokenNumber}:${customerPin}:NaN:12345678`,
      `TB:${orderId}:${tokenNumber}:${customerPin}:1:12345678`,
    ]) {
      const h = await viewHarness();
      await h.scan(payload);
      assert.equal(h.calls.length, 0);
      assert.equal(h.fallbackWrites.length, 0);
    }
  });

  it('token and PIN-only scans cannot authorize collection', async () => {
    const token = await viewHarness();
    await token.scan(tokenNumber);
    assert.equal(token.calls.length, 0);
    assert.ok(token.container.innerHTML.includes(tokenNumber));
    const pin = await viewHarness();
    await pin.scan(customerPin);
    assert.equal(pin.calls.length, 0);
    assert.ok(pin.container.innerHTML.includes('PIN-only scan'));
  });

  it('mobile scan rejection cannot fall back to a direct collection write', async () => {
    const h = await viewHarness({ verifyError: new Error('internal verification outage') });
    await h.scan(`TB:${orderId}:${tokenNumber}:${customerPin}`);
    assert.equal(h.calls.length, 1);
    assert.equal(h.fallbackWrites.length, 0);
    assert.ok(h.container.innerHTML.includes('Verification Failed'));
  });

  it('preserves signed QR scans as complete tokens', async () => {
    const h = await viewHarness();
    await h.scan(qrPayload);
    assert.deepEqual(h.calls, [{ name: 'verifyPickup', data: { orderId, qrToken: qrPayload } }]);
    assert.equal(h.fallbackWrites.length, 0);
    assert.ok(h.container.innerHTML.includes('Verified &amp; Collected'));
  });

  it('signed QR rejection cannot fall back to a direct collection write', async () => {
    const h = await viewHarness({ verifyError: new Error('internal verification outage') });
    await h.scan(qrPayload);
    assert.equal(h.calls.length, 1);
    assert.equal(h.fallbackWrites.length, 0);
    assert.ok(h.container.innerHTML.includes('Scan Error'));
  });

  it('a filter-input Enter scan is dispatched once despite bubbling to the hardware listener', async () => {
    const h = await viewHarness();
    await h.scan(qrPayload, true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.fallbackWrites.length, 0);
  });

  it('repeated scans during an in-flight verification are coalesced per order', async () => {
    let finish;
    const waitForVerify = new Promise(resolve => { finish = resolve; });
    const h = await viewHarness({ waitForVerify });
    await h.scan(qrPayload);
    await h.scan(qrPayload);
    assert.equal(h.calls.length, 1);
    finish();
    await drain();
  });

  it('does not render handover actions for unpaid or unready cooked orders', async () => {
    for (const order of [{ paymentStatus: 'pending' }, { status: 'preparing' }, { status: 'confirmed' }]) {
      const h = await viewHarness({ order });
      assert.equal(h.container.orders.querySelectorAll('.collect-action-btn').length, 0);
      assert.equal(h.container.orders.querySelectorAll('.verify-pin-btn').length, 0);
    }
  });

  it('renders PIN collection for legitimate paid ready-made orders before kitchen preparation', async () => {
    const h = await viewHarness({ order: { status: 'confirmed', isOnlyReadyMade: true } });
    assert.equal(h.container.orders.querySelectorAll('.verify-pin-btn').length, 1);
    await h.container.orders.querySelectorAll('.verify-pin-btn')[0].trigger('click');
    assert.deepEqual(h.calls, [{ name: 'verifyPickup', data: { orderId, pinCode: customerPin } }]);
  });
});
