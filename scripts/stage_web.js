'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { PUBLIC_FILES, PUBLIC_TREES, isPublicPath } = require('../web-public');

function stageWeb({ root = path.resolve(__dirname, '..'), appCheckSiteKey = '' } = {}) {
  const destination = path.join(root, 'dist/site');
  const flutterBuild = path.join(root, 'thakur_bites/build/web');
  if (typeof appCheckSiteKey !== 'string' || (appCheckSiteKey && !/^[A-Za-z0-9_-]{10,200}$/.test(appCheckSiteKey))) {
    throw new Error('Invalid PUBLIC App Check site key format.');
  }
  for (const relative of ['thakur_bites', 'thakur_bites/build', 'thakur_bites/build/web']) {
    const stat = fs.lstatSync(path.join(root, relative));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe Flutter build directory: ${relative}`);
  }
  for (const required of ['index.html', 'main.dart.js', 'flutter_bootstrap.js']) {
    const stat = fs.lstatSync(path.join(flutterBuild, required));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing regular rebuilt Flutter output: ${required}`);
  }
  // Refuse a symlinked parent before any recursive removal or write. Build into
  // a fresh directory so rejected inputs cannot destroy a previous good bundle.
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) fs.mkdirSync(dist);
  if (!fs.lstatSync(dist).isDirectory() || fs.lstatSync(dist).isSymbolicLink()) throw new Error('Unsafe dist directory.');
  const staged = fs.mkdtempSync(path.join(dist, '.stage-'));
  function copy(sourceRoot, relative) {
    let parent = sourceRoot;
    for (const segment of relative.split('/').slice(0, -1)) {
      parent = path.join(parent, segment);
      if (fs.lstatSync(parent).isSymbolicLink()) throw new Error(`Symlinks are not deployable asset parents: ${relative}`);
    }
    const source = path.join(sourceRoot, relative);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not deployable assets: ${relative}`);
    if (stat.isDirectory()) {
      if (relative.split('/').some(segment => segment.startsWith('.') || segment === 'node_modules')) return;
      for (const name of fs.readdirSync(source)) copy(sourceRoot, `${relative}/${name}`);
    } else if (stat.isFile() && isPublicPath(relative)) {
      const output = path.join(staged, relative);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(source, output);
    }
  }
  try {
    for (const relative of [...PUBLIC_FILES, ...PUBLIC_TREES]) {
      if (fs.existsSync(path.join(root, relative))) copy(root, relative);
    }
    for (const name of fs.readdirSync(flutterBuild)) copy(flutterBuild, name);
    // Supply one public site key consistently to both student and staff bundles.
    if (appCheckSiteKey) {
      fs.mkdirSync(path.join(staged, 'js'), { recursive: true });
      fs.writeFileSync(path.join(staged, 'js/publicConfig.js'),
        `export const publicConfig = Object.freeze(${JSON.stringify({ appCheckSiteKey, functionsEmulator: null })});\n`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(staged, destination);
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
  console.log('Staged allowlisted web output: dist/site');
  return destination;
}
if (require.main === module) stageWeb({ appCheckSiteKey: (process.env.FIREBASE_APP_CHECK_WEB_KEY || '').trim() });
module.exports = { stageWeb };
