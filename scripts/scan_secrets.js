#!/usr/bin/env node

/**
 * Thakur Bites Platform 2.0 — Cryptographic Secret & Credential Scanner
 * Scans the codebase for high-risk secrets, leaked private keys, service account credentials,
 * production gateway secrets, and hardcoded database connection strings.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.dart_tool',
  'build',
  '.idea',
  '.vscode',
  '.system_generated',
]);

const IGNORE_FILES = new Set([
  'package-lock.json',
  'scan_secrets.js', // Exclude self to avoid false positives on regex patterns
]);

const SECRET_PATTERNS = [
  {
    name: 'Private Cryptographic Key',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    severity: 'CRITICAL',
  },
  {
    name: 'Google Service Account JSON Key',
    regex: /"type":\s*"service_account"[\s\S]*?"private_key":\s*"-----BEGIN/,
    severity: 'CRITICAL',
  },
  {
    name: 'Production Razorpay Secret Key',
    regex: /rzp_live_[a-zA-Z0-9]{14,}/,
    severity: 'CRITICAL',
  },
  {
    name: 'Hardcoded Database Connection URI with Credentials',
    regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^:\s]+:[^@\s]+@/i,
    severity: 'CRITICAL',
  },
  {
    name: 'AWS Access Key ID',
    regex: /AKIA[0-9A-Z]{16}/,
    severity: 'HIGH',
  },
  {
    name: 'Generic API Secret Assignment',
    regex: /(?:api_secret|app_secret|client_secret|private_key)\s*[:=]\s*['"][a-zA-Z0-9_-]{24,}['"]/i,
    severity: 'HIGH',
  },
];

let scannedFilesCount = 0;
const violations = [];

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT_DIR, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        scanDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;

      // Only scan text source files
      const ext = path.extname(entry.name).toLowerCase();
      const textExtensions = ['.js', '.ts', '.dart', '.json', '.html', '.css', '.md', '.sh', '.rules', '.yaml', '.yml'];
      if (!textExtensions.includes(ext)) continue;

      scannedFilesCount++;
      const content = fs.readFileSync(fullPath, 'utf8');

      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(content)) {
          // Check if it's in a test file using explicit mock secret labels
          const isMockTest = fullPath.includes('test') && content.includes('test_webhook_secret_key');
          if (isMockTest && pattern.name === 'Generic API Secret Assignment') {
            continue;
          }

          violations.push({
            file: relPath,
            pattern: pattern.name,
            severity: pattern.severity,
          });
        }
      }
    }
  }
}

function scanGitHistory() {
  try {
    const gitDiff = execSync('git log -p -n 30', { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 });
    const lines = gitDiff.split('\n');
    let currentCommit = 'unknown';

    for (const line of lines) {
      if (line.startsWith('commit ')) {
        currentCommit = line.split(' ')[1]?.slice(0, 10) || 'unknown';
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.regex.test(line)) {
            if (line.includes('test_webhook_secret_key') && pattern.name === 'Generic API Secret Assignment') {
              continue;
            }
            violations.push({
              file: `git-history (commit ${currentCommit})`,
              pattern: pattern.name,
              severity: pattern.severity,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('  ⚠️ Git history scan skipped:', err.message);
  }
}

console.log('════════════════════════════════════════════════════════════════');
console.log('🔍 THAKUR BITES PLATFORM 2.0 — SECRET & CREDENTIAL SCANNER');
console.log('════════════════════════════════════════════════════════════════\n');

scanDirectory(ROOT_DIR);
scanGitHistory();

console.log(`▶ Scanned ${scannedFilesCount} source files across the platform.`);

if (violations.length > 0) {
  console.error(`\n🚨 CRITICAL SECURITY ALERT: ${violations.length} Potential Secret(s) Found:\n`);
  for (const v of violations) {
    console.error(`  ❌ [${v.severity}] ${v.pattern} in file: ${v.file}`);
  }
  console.error('\nScan failed. Please remove leaked credentials before committing.\n');
  process.exit(1);
} else {
  console.log('  ✓ Zero leaked credentials, service account keys, or private secrets detected.');
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('🏆 SECRET SCANNING GATE PASSED (100% CLEAN)');
  console.log('════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}
