#!/usr/bin/env node
/**
 * Parses every source file without executing it.
 *
 * A cheap stand-in for a linter: it catches syntax errors in files that no test
 * happens to require, which is exactly how a broken module reaches production.
 * Replace with ESLint when you want style and correctness rules too.
 */
const { execFileSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'coverage', 'dist']);

function collect(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return collect(full);
    return entry.endsWith('.js') ? [full] : [];
  });
}

const files = collect(ROOT);
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures.push(`${path.relative(ROOT, file)}\n${err.stderr?.toString().trim()}`);
  }
}

if (failures.length > 0) {
  console.error(`❌ ${failures.length} file(s) failed to parse:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}

console.log(`✅ ${files.length} files parse cleanly.`);
