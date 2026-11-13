#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const required = manifest.engines.node.replace('>=', '');
const [needMajor, needMinor] = required.split('.').map(Number);
const [major, minor] = process.versions.node.split('.').map(Number);

if (major < needMajor || (major === needMajor && minor < needMinor)) {
  console.error(`ja2-node needs Node.js ${required} or newer, this is ${process.version}: https://nodejs.org`);
  process.exit(1);
}

import('../dist/server/player.js')
  .then(({ runPlayer }) => runPlayer(fileURLToPath(root), process.argv.slice(2)))
  .then((code) => {
    process.exitCode = code;
  });
