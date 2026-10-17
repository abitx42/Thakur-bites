'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
let environment;
before(async () => {
  const address = new URL(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199'}`);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname), 'Only a local Storage emulator is allowed');
  environment = await initializeTestEnvironment({ projectId: 'demo-storage-security', storage: {
    host: address.hostname, port: Number(address.port), rules: fs.readFileSync(path.resolve(__dirname, '../../../storage.rules'), 'utf8'),
  } });
});
after(async () => { if (environment) await environment.cleanup(); });
const reference = (uid, role, name) => (uid ? environment.authenticatedContext(uid, { role }) : environment.unauthenticatedContext()).storage().ref(name);
const upload = (ref, size = 8, contentType = 'image/png') => ref.put(new Uint8Array(size), { contentType });

for (const name of ['menu_images/meal.png', 'menu_images/meal/photo.png']) {
  test(`current administrative claims can create, update and DELETE ${name}`, async () => {
    const admin = reference('admin', 'admin', name);
    await assertSucceeds(upload(admin));
    await assertSucceeds(upload(admin, 10, 'image/webp'));
    await assertSucceeds(reference(null, null, name).getMetadata());
    await assertFails(upload(reference('customer', 'student', name)));
    await assertFails(reference('customer', 'student', name).delete());
    await assertSucceeds(admin.delete());
  });
}
test('menu image writes enforce MIME, nonempty content and 2MiB on both creation and replacement', async () => {
  const ref = reference('manager', 'manager', 'menu_images/bounded.png');
  await assertSucceeds(upload(ref));
  for (const [size, mime] of [[8, 'text/html'], [8, 'image/svg+xml'], [0, 'image/png'], [2 * 1024 * 1024 + 1, 'image/png']]) {
    await assertFails(upload(ref, size, mime));
    await assertFails(upload(reference('manager', 'manager', `menu_images/new-${size}-${mime.replace('/', '-')}.png`), size, mime));
  }
});
test('verification proofs remain private and only owners create; updates require valid administrative uploads', async () => {
  const name = 'verification_proofs/customer/proof.pdf';
  const owner = reference('customer', 'student', name);
  const admin = reference('reviewer', 'manager', name);
  await assertSucceeds(upload(owner, 10, 'application/pdf'));
  await assertSucceeds(owner.getMetadata());
  await assertSucceeds(admin.getMetadata());
  await assertFails(reference(null, null, name).getMetadata());
  await assertFails(reference('other', 'student', name).getMetadata());
  await assertFails(upload(owner, 12, 'application/pdf'));
  await assertFails(upload(reference('other', 'student', 'verification_proofs/customer/other.pdf'), 8, 'application/pdf'));
  await assertSucceeds(upload(admin, 12, 'application/pdf'));
  await assertFails(owner.updateMetadata({ contentType: 'text/html' }));
  await assertFails(admin.updateMetadata({ contentType: 'text/html' }));
  await assertSucceeds(admin.updateMetadata({ contentType: 'image/png' }));
  await assertFails(upload(admin, 8, 'text/html'));
  await assertFails(upload(admin, 5 * 1024 * 1024 + 1, 'application/pdf'));
  await assertFails(owner.delete());
  await assertSucceeds(admin.delete());
});
test('email addresses, workstation markers and unknown paths cannot grant Storage authority', async () => {
  const context = environment.authenticatedContext('pretend-admin', { email: 'admin.person@tcetmumbai.in', isWorkstationSession: true });
  await assertFails(upload(context.storage().ref('menu_images/forged.png')));
  await assertFails(upload(reference('admin', 'admin', 'private/unknown.png')));
});
