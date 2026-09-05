#!/usr/bin/env node

/**
 * Thakur Bites Platform 2.0 — Static Application Security Testing (SAST) Analyzer
 * Performs static code analysis across JavaScript, TypeScript, and Dart codebases
 * checking for common OWASP security antipatterns, injection vectors, and unsafe crypto.
 */

const fs = require('fs');
const path = require('path');

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
  'sast_analyzer.js', // Exclude self
]);

const SAST_RULES = [
  {
    id: 'SEC-SAST-01',
    name: 'Dangerous Dynamic Code Execution (eval / new Function)',
    regex: /\b(?:eval|Function)\s*\(.*?\)/,
    severity: 'CRITICAL',
    fileExts: ['.js', '.ts', '.dart'],
  },
  {
    id: 'SEC-SAST-02',
    name: 'Unsafe Insecure Pseudo-Random Token Generation (Math.random in Crypto)',
    regex: /const\s+(?:pin|token|secret|nonce)\s*=\s*.*?Math\.random\(\)/i,
    severity: 'HIGH',
    fileExts: ['.js', '.ts'],
  },
  {
    id: 'SEC-SAST-03',
    name: 'Direct Client-Controlled Role Assignment',
    regex: /(?:role|accountType|priorityLevel)\s*:\s*request\.data\.(?:role|accountType|priorityLevel)/,
    severity: 'CRITICAL',
    fileExts: ['.ts'],
  },
  {
    id: 'SEC-SAST-04',
    name: 'Hardcoded Production Bypass or Static Admin Credentials',
    regex: /if\s*\(\s*.*?(?:admin@tcet\.com|bypass_auth|disable_security).*?\)/i,
    severity: 'CRITICAL',
    fileExts: ['.js', '.ts', '.dart'],
  },
  {
    id: 'SEC-SAST-05',
    name: 'Hardcoded Demo Authentication or PIN Bypass in Client Code',
    regex: /(?:cleanPass\.length\s*>=|pin\s*===?\s*['"]123456['"]|staff_demo_|localStorage\.(?:getItem|setItem)\(['"]tb_staff_)/i,
    severity: 'CRITICAL',
    fileExts: ['.js', '.dart'],
  },
  {
    id: 'SEC-SAST-06',
    name: 'Direct Firestore Mutation on Core Collections in Client Code',
    regex: /(?:updateDoc|setDoc|deleteDoc|addDoc)\s*\(\s*(?:doc|collection)\s*\(\s*(?:db|firestore)\s*,\s*['"](?:menu_items|transactions)['"]/,
    severity: 'HIGH',
    fileExts: ['.js'],
  },
];

let scannedCount = 0;
const findings = [];

function scanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const relPath = path.relative(ROOT_DIR, filePath);

  // Skip test files for mock-specific patterns
  const isTestFile = filePath.includes('test') || filePath.includes('mock');

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (const rule of SAST_RULES) {
    if (!rule.fileExts.includes(ext)) continue;
    if (isTestFile && rule.id === 'SEC-SAST-02') continue;

    lines.forEach((line, index) => {
      // Skip comment lines
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

      if (rule.regex.test(line)) {
        findings.push({
          ruleId: rule.id,
          name: rule.name,
          severity: rule.severity,
          file: relPath,
          line: index + 1,
          snippet: trimmed.slice(0, 100),
        });
      }
    });
  }
}

function traverseDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        traverseDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (['.js', '.ts', '.dart'].includes(ext)) {
        scannedCount++;
        scanFile(fullPath);
      }
    }
  }
}

console.log('════════════════════════════════════════════════════════════════');
console.log('🛡️  THAKUR BITES PLATFORM 2.0 — SAST SECURITY CODE ANALYZER');
console.log('════════════════════════════════════════════════════════════════\n');

traverseDirectory(ROOT_DIR);

console.log(`▶ Analyzed ${scannedCount} executable code source files.`);

if (findings.length > 0) {
  console.error(`\n🚨 SAST VIOLATIONS DETECTED (${findings.length} findings):\n`);
  for (const f of findings) {
    console.error(`  ❌ [${f.severity}] ${f.ruleId}: ${f.name}`);
    console.error(`     File: ${f.file}:${f.line}`);
    console.error(`     Code: ${f.snippet}\n`);
  }
  process.exit(1);
} else {
  console.log('  ✓ Zero dangerous eval(), insecure token generators, client role injections, or demo auth bypasses detected.');
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`🏆 CUSTOM SAST GUARDRAILS: ${SAST_RULES.length}/${SAST_RULES.length} PASSED (100% CLEAN)`);
  console.log('════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}
