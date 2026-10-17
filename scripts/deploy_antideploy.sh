#!/usr/bin/env bash
# Disable inherited tracing before handling credentials, including `bash -x` callers.
set +x
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR=''

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
cleanup() { if [[ -n "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  printf '%s\n' \
    'Usage: scripts/deploy_antideploy.sh [--deploy]' \
    '       scripts/deploy_antideploy.sh --package-only OUTPUT.tar.gz' \
    '       scripts/deploy_antideploy.sh --dry-run OUTPUT.tar.gz' \
    '' \
    'Deploy requires ANTIDEPLOY_APPLICATION_ID, ANTIDEPLOY_TOKEN and FIREBASE_APP_CHECK_WEB_KEY.' \
    'Deploy builds with npm run build:web, uploads once, and polls with a deadline.' \
    'Package-only/dry-run archives an EXISTING dist/site; it does not build, authenticate or deploy.' \
    'Only dist/site, server.js, web-public.js and generated dependency-free runtime metadata are packaged.' \
    'The output must not already exist. GNU tar, gzip and Node are required.' \
    '' \
    'Optional positive-integer bounds (seconds; default / maximum):' \
    '  ANTIDEPLOY_BUILD_TIMEOUT_SECONDS    900 / 3600' \
    '  ANTIDEPLOY_DEPLOY_TIMEOUT_SECONDS   600 / 3600 (upload and polling together)' \
    '  ANTIDEPLOY_REQUEST_TIMEOUT_SECONDS   60 / 300' \
    '  ANTIDEPLOY_CONNECT_TIMEOUT_SECONDS   10 / 60' \
    '  ANTIDEPLOY_POLL_INTERVAL_SECONDS      3 / 60' \
    'SOURCE_DATE_EPOCH defaults to 0 for a reproducible archive.'
}

MODE=deploy
OUTPUT=''
case "${1:-}" in
  '') [[ $# -eq 0 ]] || die 'Unexpected arguments.' ;;
  --deploy) [[ $# -eq 1 ]] || die '--deploy does not take arguments.' ;;
  --package-only|--dry-run)
    [[ $# -eq 2 && -n "$2" ]] || die 'Package-only/dry-run requires one output archive path.'
    MODE=package
    OUTPUT="$2"
    [[ "$OUTPUT" == *.tar.gz || "$OUTPUT" == *.tgz ]] || die 'Output must end in .tar.gz or .tgz.'
    [[ ! -e "$OUTPUT" && ! -L "$OUTPUT" ]] || die 'Output already exists; refusing to overwrite it.'
    [[ -d "$(dirname "$OUTPUT")" ]] || die 'Output parent directory does not exist.'
    ;;
  -h|--help) usage; exit 0 ;;
  *) die 'Unknown argument. Use --help for usage.' ;;
esac

for tool in node tar gzip mktemp; do
  command -v "$tool" >/dev/null 2>&1 || die "Required tool is missing: $tool"
done
SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"
[[ "$SOURCE_DATE_EPOCH" =~ ^[0-9]{1,10}$ ]] || die 'SOURCE_DATE_EPOCH must be a nonnegative integer of at most 10 digits.'

validate_bound() {
  local name="$1" value="$2" maximum="$3"
  [[ "$value" =~ ^[1-9][0-9]{0,3}$ ]] && (( value <= maximum )) || die "$name must be an integer from 1 to $maximum."
}

if [[ "$MODE" == deploy ]]; then
  [[ "${ANTIDEPLOY_APPLICATION_ID:-}" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || die 'Set a valid ANTIDEPLOY_APPLICATION_ID (letters, digits, underscore or hyphen; at most 128 characters).'
  [[ "${ANTIDEPLOY_TOKEN:-}" =~ ^[A-Za-z0-9._~+/-]+=*$ ]] || die 'Set ANTIDEPLOY_TOKEN to a nonempty Bearer token without whitespace or control characters.'
  [[ "${FIREBASE_APP_CHECK_WEB_KEY:-}" =~ ^[A-Za-z0-9_-]{10,200}$ ]] || die 'Set FIREBASE_APP_CHECK_WEB_KEY to the public App Check site key before deployment.'
  BUILD_TIMEOUT="${ANTIDEPLOY_BUILD_TIMEOUT_SECONDS:-900}"
  DEPLOY_TIMEOUT="${ANTIDEPLOY_DEPLOY_TIMEOUT_SECONDS:-600}"
  REQUEST_TIMEOUT="${ANTIDEPLOY_REQUEST_TIMEOUT_SECONDS:-60}"
  CONNECT_TIMEOUT="${ANTIDEPLOY_CONNECT_TIMEOUT_SECONDS:-10}"
  POLL_INTERVAL="${ANTIDEPLOY_POLL_INTERVAL_SECONDS:-3}"
  validate_bound ANTIDEPLOY_BUILD_TIMEOUT_SECONDS "$BUILD_TIMEOUT" 3600
  validate_bound ANTIDEPLOY_DEPLOY_TIMEOUT_SECONDS "$DEPLOY_TIMEOUT" 3600
  validate_bound ANTIDEPLOY_REQUEST_TIMEOUT_SECONDS "$REQUEST_TIMEOUT" 300
  validate_bound ANTIDEPLOY_CONNECT_TIMEOUT_SECONDS "$CONNECT_TIMEOUT" 60
  validate_bound ANTIDEPLOY_POLL_INTERVAL_SECONDS "$POLL_INTERVAL" 60
  for tool in npm curl timeout; do
    command -v "$tool" >/dev/null 2>&1 || die "Required tool is missing: $tool"
  done
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/thakur-bites-deploy.XXXXXXXX")"
PAYLOAD="$WORK_DIR/payload"
ARCHIVE="$WORK_DIR/runtime.tar.gz"

if [[ "$MODE" == deploy ]]; then
  # Keep the token out of argv, child environments, the payload and all logs.
  printf 'Authorization: Bearer %s\n' "$ANTIDEPLOY_TOKEN" > "$WORK_DIR/auth.header"
  unset ANTIDEPLOY_TOKEN
  printf '%s\n' 'Building the staged web site with npm run build:web...'
  if (cd "$ROOT_DIR" && timeout --signal=TERM --kill-after=10s "${BUILD_TIMEOUT}s" npm run build:web); then
    :
  else
    status=$?
    printf 'Error: Web build failed (exit %s); nothing was uploaded.\n' "$status" >&2
    exit "$status"
  fi
fi

# Validate and copy an allowlist, rather than excluding a few private files from the repository.
# Every symlink, hardlink, special file, dotfile (except the public security contact), and node_modules tree
# is rejected even if it was accidentally placed in dist/site. No local CLI configuration is read.
node - "$ROOT_DIR" "$PAYLOAD" <<'NODE'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [root, payload] = process.argv.slice(2);
function fail(message) { throw new Error(message); }
function regular(filename, directory = false) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    fail('Deploy inputs must be regular files and directories, without symlinks.');
  }
  if (stat.isFile() && stat.nlink > 1) fail('Hardlinked files are not deployable inputs.');
  return stat;
}
for (const name of ['server.js', 'web-public.js', '.nvmrc', 'package.json']) regular(path.join(root, name));
regular(path.join(root, 'dist'), true);
const site = path.join(root, 'dist/site');
regular(site, true);
const { isPublicPath, PUBLIC_TREES } = require(path.join(root, 'web-public.js'));
for (const name of ['index.html', 'main.dart.js', 'flutter_bootstrap.js']) regular(path.join(site, name));
const nodeVersion = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
const npmVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager;
if (!/^\d+\.\d+\.\d+$/.test(nodeVersion) || !/^npm@\d+\.\d+\.\d+$/.test(npmVersion || '')) {
  fail('Exact Node and npm pins are required for the runtime package.');
}
fs.mkdirSync(path.join(payload, 'dist/site'), { recursive: true, mode: 0o755 });
function copy(relative) {
  const parts = relative.split('/');
  if (parts.some(part => part === 'node_modules' || /[\x00-\x1f\x7f\\]/.test(part) ||
      (part.startsWith('.') && !(parts[0] === '.well-known' && parts.length <= 2 && part === '.well-known')))) {
    fail('Unsafe path found in staged web output.');
  }
  const source = path.join(site, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) fail('Symlinks are not deployable assets.');
  if (stat.isFile() && stat.nlink > 1) fail('Hardlinked files are not deployable assets.');
  const destination = path.join(payload, 'dist/site', relative);
  if (stat.isDirectory()) {
    if (!PUBLIC_TREES.has(parts[0]) && relative !== '.well-known') fail('Unallowlisted directory found in staged web output.');
    fs.mkdirSync(destination, { recursive: true, mode: 0o755 });
    for (const name of fs.readdirSync(source).sort()) copy(`${relative}/${name}`);
  } else if (stat.isFile() && isPublicPath(relative)) {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o644);
  } else {
    fail('Non-public or special file found in staged web output.');
  }
}
for (const name of fs.readdirSync(site).sort()) copy(name);
for (const name of ['server.js', 'web-public.js']) {
  fs.copyFileSync(path.join(root, name), path.join(payload, name), fs.constants.COPYFILE_EXCL);
  fs.chmodSync(path.join(payload, name), 0o644);
}
const manifest = {
  name: 'thakur-bites-runtime', version: '1.0.0', private: true,
  engines: { node: nodeVersion }, packageManager: npmVersion,
  scripts: { start: 'HOST=0.0.0.0 node server.js' },
};
const lock = {
  name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
  packages: { '': { name: manifest.name, version: manifest.version, engines: manifest.engines } },
};
for (const [name, contents] of Object.entries({
  'package.json': JSON.stringify(manifest, null, 2) + '\n',
  'package-lock.json': JSON.stringify(lock, null, 2) + '\n',
  '.nvmrc': nodeVersion + '\n',
})) {
  const filename = path.join(payload, name);
  fs.writeFileSync(filename, contents, { mode: 0o644, flag: 'wx' });
  fs.chmodSync(filename, 0o644);
}
// umask may remove public read/execute bits during mkdir; normalize all directory modes.
function directoryModes(directory) {
  fs.chmodSync(directory, 0o755);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) directoryModes(path.join(directory, entry.name));
  }
}
directoryModes(payload);
NODE

# Stable order, ownership, timestamps and gzip headers make identical input byte-reproducible.
# Ignore workstation archive options, which could inject extra input files or alter the payload.
unset TAR_OPTIONS GZIP
LC_ALL=C tar --sort=name --format=posix --pax-option=delete=atime,delete=ctime \
  --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner \
  -C "$PAYLOAD" -cf - . | gzip -n > "$ARCHIVE"

if [[ "$MODE" == package ]]; then
  # COPYFILE_EXCL also closes the race with a newly created output or symlink.
  node - "$ARCHIVE" "$OUTPUT" <<'NODE'
require('node:fs').copyFileSync(process.argv[2], process.argv[3], require('node:fs').constants.COPYFILE_EXCL);
NODE
  printf 'Packaged existing dist/site into %s. No build or deployment was performed.\n' "$OUTPUT"
  exit 0
fi

DEADLINE=$((SECONDS + DEPLOY_TIMEOUT))
request() {
  local phase="$1" url="$2" remaining max_time http_status curl_status
  shift 2
  remaining=$((DEADLINE - SECONDS))
  (( remaining > 0 )) || die 'Deployment deadline exceeded; the remote task may still be running. Inspect Antideploy before retrying.'
  max_time="$REQUEST_TIMEOUT"
  if (( remaining < max_time )); then max_time="$remaining"; fi
  # -q is deliberately first: curl must not read a user's .curlrc or follow redirects.
  if http_status=$(curl -q --silent --show-error --proto '=https' --tlsv1.2 \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$max_time" --max-filesize 1048576 \
    --header "@$WORK_DIR/auth.header" --output "$WORK_DIR/response.json" \
    --write-out '%{http_code}' "$@" "$url" 2> "$WORK_DIR/curl-error"); then
    [[ "$http_status" =~ ^2[0-9]{2}$ ]] || die "$phase returned HTTP $http_status; no success confirmed. Inspect Antideploy before retrying."
  else
    curl_status=$?
    die "$phase request failed (curl exit $curl_status); the remote outcome is unknown. Inspect Antideploy before retrying."
  fi
}

printf '%s\n' 'Uploading the allowlisted runtime package to Antideploy...'
request Upload "https://antideploy.com/api/v1/deploy?applicationId=$ANTIDEPLOY_APPLICATION_ID" \
  --request POST --form "archive=@$ARCHIVE;type=application/gzip"
TASK_ID=$(node - "$WORK_DIR/response.json" <<'NODE'
let response;
try { response = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8')); }
catch { console.error('Error: Upload did not return valid JSON; no deployment success confirmed.'); process.exit(1); }
if (!response || typeof response.taskId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(response.taskId)) {
  console.error('Error: Upload did not return a valid taskId; no deployment success confirmed.'); process.exit(1);
}
process.stdout.write(response.taskId);
NODE
)
printf 'Watching Antideploy task %s (bounded by %s seconds)...\n' "$TASK_ID" "$DEPLOY_TIMEOUT"
while :; do
  request Poll "https://antideploy.com/api/v1/deployments/$TASK_ID"
  STATUS=$(node - "$WORK_DIR/response.json" <<'NODE'
let response;
try { response = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8')); }
catch { console.error('Error: Poll did not return valid JSON; no deployment success confirmed.'); process.exit(1); }
const statuses = new Set(['queued', 'pending', 'created', 'running', 'building', 'deploying', 'processing', 'in_progress', 'succeeded', 'failed', 'cancelled', 'canceled']);
if (!response || !statuses.has(response.status)) {
  console.error('Error: Poll returned a missing or unrecognized status; no deployment success confirmed.'); process.exit(1);
}
process.stdout.write(response.status);
NODE
  )
  printf 'Antideploy status: %s\n' "$STATUS"
  case "$STATUS" in
    succeeded) printf 'Antideploy reports deployment succeeded (task %s).\n' "$TASK_ID"; exit 0 ;;
    failed|cancelled|canceled) die "Antideploy reports deployment $STATUS (task $TASK_ID)." ;;
  esac
  remaining=$((DEADLINE - SECONDS))
  (( remaining > 0 )) || die "Timed out waiting for task $TASK_ID; it may still be running. Inspect Antideploy before retrying."
  pause="$POLL_INTERVAL"
  if (( remaining < pause )); then pause="$remaining"; fi
  sleep "$pause"
done
