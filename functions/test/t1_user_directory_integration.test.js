const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

class Element {
  constructor(tag, attributes, body = '') {
    this.tagName = tag.toUpperCase();
    this.attributes = attributes;
    this.listeners = new Map();
    this.disabled = Object.hasOwn(attributes, 'disabled');
    this.value = attributes.value || '';
    if (tag === 'select') {
      const options = [...body.matchAll(/<option\b([^>]*)>/g)];
      const selected = options.find(option => /\bselected\b/.test(option[1])) || options[0];
      this.value = selected?.[1].match(/value="([^"]*)"/)?.[1] || '';
    }
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  async trigger(type, event = {}, force = false) {
    if (this.disabled && !force) return;
    await this.listeners.get(type)?.({ target: this, preventDefault() {}, ...event });
    await new Promise(resolve => setImmediate(resolve));
  }
  focus() {}
  setSelectionRange() {}
}

// Controls are discovered from the real rendered HTML and their real event
// listeners are dispatched. This fixture implements only the DOM used here.
class Container {
  set innerHTML(html) {
    this.html = html;
    this.controls = [...html.matchAll(/<(button|select|input|form)\b([^>]*)>/g)].map(match => {
      const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
      if (/(?:^|\s)disabled(?:\s|$)/.test(match[2])) attributes.disabled = '';
      const end = html.indexOf(`</${match[1]}>`, match.index);
      return new Element(match[1], attributes, end < 0 ? '' : html.slice(match.index, end));
    });
    for (const form of this.controls.filter(control => control.tagName === 'FORM')) {
      form.identifier = this.controls.find(control => control.attributes.name === 'identifier');
      form.role = this.controls.find(control => control.attributes.name === 'role');
    }
  }
  get innerHTML() { return this.html || ''; }
  querySelector(selector) {
    return this.controls.find(control => selector.startsWith('#')
      ? control.attributes.id === selector.slice(1)
      : (control.attributes.class || '').split(/\s+/).includes(selector.slice(1))) || null;
  }
  querySelectorAll(selector) { return this.controls.filter(control => (control.attributes.class || '').split(/\s+/).includes(selector.slice(1))); }
}

const file = path.resolve(__dirname, '../../js/views/userProfilesView.js');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function harness(options = {}) {
  const calls = [];
  const writes = [];
  const queries = [];
  const subscriptions = [];
  const authListeners = new Set();
  const timers = [];
  const auth = { currentUser: options.unauthenticated ? null : { uid: 'admin-A' } };
  let actorRole = options.actorRole || 'admin';
  const authModule = {
    staffAuth: { isAuthenticated: () => Boolean(auth.currentUser), getRole: () => actorRole },
    getPrivilegedSession: () => options.noSession ? null : { sessionId: 'psess_test-authority', userId: auth.currentUser?.uid },
    onStaffAuthStateChanged(listener) { authListeners.add(listener); return () => authListeners.delete(listener); },
  };
  const firestore = {
    collection: (_db, name) => ({ path: name }), doc: (_db, name, id) => ({ path: `${name}/${id}` }),
    query: (reference, filter) => ({ ...reference, filter }), where: (...filter) => filter,
    onSnapshot(reference, next, error) {
      const subscription = { reference, next, error, stopped: false };
      subscriptions.push(subscription);
      return () => { subscription.stopped = true; };
    },
    async getDocsFromServer(reference) {
      queries.push(reference);
      if (options.queryError) throw options.queryError;
      const docs = options.queryResults?.[reference.path] || [];
      return { empty: docs.length === 0, docs: docs.map(([id, data]) => ({ id, data: () => data })) };
    },
    async setDoc(...args) { writes.push(args); }, async updateDoc(...args) { writes.push(args); },
    async deleteDoc(...args) { writes.push(args); }, serverTimestamp: () => ({}),
  };
  firestore.getDocs = firestore.getDocsFromServer;
  const functions = {
    httpsCallable(_functions, name) {
      return async payload => {
        calls.push({ name, payload });
        if (options.wait) await options.wait;
        if (options.callError) throw options.callError;
        return { data: Object.hasOwn(options, 'response') ? options.response : { success: true, targetUid: payload.targetUid, assignedRole: payload.newRole, permissionsVersion: 2 } };
      };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name.startsWith('../firebase.js')) return { db: {}, auth, functions: {} };
      if (name.startsWith('../auth.js')) return authModule;
      if (name.includes('firebase-firestore.js')) return firestore;
      if (name.includes('firebase-functions.js')) return functions;
      if (name === './escapeHtml.js') return { escapeHtml };
      throw new Error(`Unexpected user directory dependency: ${name}`);
    },
    console: { error() {}, warn() {}, log() {} },
    setTimeout(callback) { const timer = { callback, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cancelled = true; },
  }, { filename: file });
  const container = new Container();
  module.exports.renderUserProfilesView(container);
  return {
    api: module.exports, container, calls, writes, queries, subscriptions, authListeners, timers, auth,
    snapshot(name, entries) {
      const docs = entries.map(([id, data]) => ({ id, data: () => data }));
      subscriptions.filter(subscription => subscription.reference.path === name && !subscription.stopped)
        .forEach(subscription => subscription.next({ docs, docChanges: () => docs.map(doc => ({ type: 'added', doc })) }));
    },
    switchAccount(uid, role = 'admin') {
      auth.currentUser = uid ? { uid } : null;
      actorRole = role;
      [...authListeners].forEach(listener => listener({ user: auth.currentUser, role, isAuthenticated: Boolean(uid) }));
    },
  };
}

function populate(h, user = {}) {
  h.snapshot('users', [['customer-1', { displayName: 'Fixture Customer', email: 'customer@example.test', role: 'student', priorityLevel: 1, ...user }]]);
  h.snapshot('staffUsers', []);
}

async function changeRole(h, role = 'manager') {
  const select = h.container.querySelectorAll('.user-role-select')[0];
  select.value = role;
  await select.trigger('change');
}

async function quickAssign(h, identifier, role = 'kitchen') {
  const form = h.container.querySelector('#quick-assign-form');
  form.identifier.value = identifier;
  form.role.value = role;
  await form.trigger('submit');
}

describe('T1 real user-directory UI action regressions', () => {
  it('assigns roles only with the real callable and current privileged-session ID', async () => {
    const h = harness(); populate(h);
    await changeRole(h);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, 'assignStaffRole');
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].payload)), { targetUid: 'customer-1', newRole: 'manager', privilegedSessionId: 'psess_test-authority' });
    assert.equal(h.writes.length, 0);
    assert.match(h.container.innerHTML, /Successfully updated role/);
  });

  for (const code of ['permission-denied', 'not-found', 'unauthenticated', 'unavailable']) {
    it(`does not present ${code} role-assignment errors as local success`, async () => {
      const h = harness({ callError: Object.assign(new Error(`Server ${code}`), { code }) }); populate(h);
      await changeRole(h);
      assert.equal(h.calls.length, 1);
      assert.equal(h.writes.length, 0);
      assert.match(h.container.innerHTML, new RegExp(`Server ${code}`));
      assert.doesNotMatch(h.container.innerHTML, /Successfully updated role/);
    });
  }

  it('requires MFA and a complete matching role-assignment receipt', async () => {
    const noSession = harness({ noSession: true }); populate(noSession);
    await changeRole(noSession);
    assert.equal(noSession.calls.length, 0);
    assert.match(noSession.container.innerHTML, /MFA privileged session/);
    for (const response of [undefined, {}, { success: false }, { success: true, targetUid: 'another-user', assignedRole: 'manager' }]) {
      const h = harness({ response }); populate(h);
      await changeRole(h);
      assert.doesNotMatch(h.container.innerHTML, /Successfully updated role/);
      assert.match(h.container.innerHTML, /did not confirm/);
      assert.equal(h.writes.length, 0);
    }
  });

  it('disables unsupported priority/account/self-master changes and explains the supported flows', async () => {
    const h = harness(); populate(h);
    for (const selector of ['.toggle-priority-btn', '.toggle-disable-btn', '#dev-verify-self-btn', '#quick-dev-admin-btn']) {
      const element = h.container.querySelector(selector);
      if (element) {
        assert.equal(element.disabled, true, selector);
        await element.trigger('click', {}, true);
      }
    }
    assert.match(h.container.innerHTML, /verified application flow/);
    assert.match(h.container.innerHTML, /trusted account administration/);
    assert.match(h.container.innerHTML, /cannot grant master access/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.writes.length, 0);
  });

  it('does not infer engineering authority from an email address or legacy isDeveloper field', () => {
    const h = harness(); populate(h, { email: 'adi@tcetmumbai.in', isDeveloper: true });
    assert.doesNotMatch(h.container.innerHTML, /LEAD DEVELOPER/);
  });

  it('does not manufacture a Firebase UID when an email lookup finds no account', async () => {
    const h = harness();
    await quickAssign(h, 'missing@tcetmumbai.in');
    assert.equal(h.calls.length, 0);
    assert.equal(h.writes.length, 0);
    assert.match(h.container.innerHTML, /No registered account/);
    assert.equal(h.queries.length, 2);
  });

  it('propagates failed email lookups without inventing an account', async () => {
    const h = harness({ queryError: new Error('Directory unavailable') });
    await quickAssign(h, 'missing@example.test');
    assert.equal(h.calls.length, 0);
    assert.equal(h.writes.length, 0);
    assert.match(h.container.innerHTML, /Account lookup failed.*Directory unavailable/);
  });

  it('refuses ambiguous email lookup results instead of selecting an arbitrary account', async () => {
    const h = harness({ queryResults: { users: [['first-uid', {}], ['second-uid', {}]] } });
    await quickAssign(h, 'ambiguous@example.test');
    assert.equal(h.calls.length, 0);
    assert.equal(h.writes.length, 0);
    assert.match(h.container.innerHTML, /Multiple accounts match/);
  });

  it('uses server-query document IDs and explicit UIDs without sanitizing emails into accounts', async () => {
    const h = harness({ queryResults: { users: [['actual-uid', { uid: 'forged-uid', email: 'known@example.test' }]] } });
    await quickAssign(h, 'KNOWN@example.test');
    assert.equal(h.calls[0].payload.targetUid, 'actual-uid');
    assert.equal(h.queries[0].filter[2], 'known@example.test');
    const direct = harness();
    await quickAssign(direct, 'verified-auth-uid');
    assert.equal(direct.calls[0].payload.targetUid, 'verified-auth-uid');
    const invalid = harness();
    await quickAssign(invalid, 'invalid/uid');
    assert.equal(invalid.calls.length, 0);
  });

  it('row actions use the actual document ID even if its data has a conflicting uid', async () => {
    const h = harness(); populate(h, { uid: 'forged-uid', id: 'forged-id' });
    await changeRole(h);
    assert.equal(h.calls[0].payload.targetUid, 'customer-1');
  });

  it('clears all data, listeners, filters and delayed feedback across account switches', async () => {
    const h = harness(); populate(h);
    await changeRole(h);
    const search = h.container.querySelector('#profiles-search-input');
    search.value = 'Fixture';
    await search.trigger('input');
    await h.container.querySelectorAll('.profile-filter-btn').find(button => button.getAttribute('data-filter') === 'STUDENTS').trigger('click');
    const previousSubscriptions = [...h.subscriptions];
    const previousTimers = [...h.timers];
    h.switchAccount('admin-B');
    assert.doesNotMatch(h.container.innerHTML, /Fixture Customer/);
    assert.equal(h.authListeners.size, 0);
    assert.ok(previousSubscriptions.every(subscription => subscription.stopped));
    h.api.renderUserProfilesView(h.container);
    h.snapshot('users', [['new-customer', { displayName: 'New Account Customer', role: 'manager' }]]);
    assert.equal(h.container.querySelector('#profiles-search-input').value, '');
    assert.match(h.container.innerHTML, /New Account Customer/);
    const newContent = h.container.innerHTML;
    for (const subscription of previousSubscriptions) subscription.next({ docs: [{ id: 'stale', data: () => ({ displayName: 'Stale Private Customer' }) }], docChanges: () => [] });
    for (const timer of previousTimers) timer.callback();
    assert.equal(h.container.innerHTML, newContent);
    assert.doesNotMatch(h.container.innerHTML, /Fixture Customer|Stale Private Customer|Successfully updated/);
  });

  it('does not republish stale records or success after an account switch during assignment', async () => {
    let finish;
    const h = harness({ wait: new Promise(resolve => { finish = resolve; }) }); populate(h);
    const pending = changeRole(h);
    h.switchAccount('admin-B');
    h.api.renderUserProfilesView(h.container);
    const content = h.container.innerHTML;
    finish(); await pending;
    assert.equal(h.container.innerHTML, content);
    assert.equal(h.writes.length, 0);
  });

  it('read errors clear sensitive rows and show an explicit load failure', () => {
    const h = harness(); populate(h);
    h.subscriptions[0].error(new Error('permission denied'));
    assert.doesNotMatch(h.container.innerHTML, /Fixture Customer/);
    assert.match(h.container.innerHTML, /Unable to load user records/);
    assert.ok(h.subscriptions.every(subscription => subscription.stopped));
  });

  it('cleanup invalidates detached controls and unauthorized actors cannot start the directory', async () => {
    const h = harness(); populate(h);
    const oldButton = h.container.querySelectorAll('.btn-action-role')[0];
    h.api.cleanupUserProfilesView();
    await oldButton.trigger('click');
    assert.equal(h.calls.length, 0);
    assert.equal(h.container.innerHTML, '');
    for (const options of [{ unauthenticated: true }, { actorRole: 'student' }]) {
      const denied = harness(options);
      assert.equal(denied.subscriptions.length, 0);
      assert.match(denied.container.innerHTML, /administrative sign-in/);
    }
  });
});
