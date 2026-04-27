#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx.cmd');
const cli = path.join(root, 'src', 'cli', 'index.ts');

const args = process.argv.slice(2).map(a => `"${a}"`).join(' ');
try {
  execSync(`"${tsx}" "${cli}" ${args}`, { stdio: 'inherit' });
} catch (e) {
  process.exit(e.status ?? 1);
}
