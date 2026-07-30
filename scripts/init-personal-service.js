#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PersonalAuthStore, parseMasterKey } from '../src/personal-store.js';
import { PERSONAL_SCOPES } from '../src/personal-server.js';

async function main() {
  const requested = process.argv[2];
  if (!requested) {
    throw new Error('用法：npm run init:personal -- /absolute/state/directory');
  }
  const stateDirectory = resolve(requested);
  const keyPath = resolve(stateDirectory, 'master.key');
  const storePath = resolve(stateDirectory, 'auth.json');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(stateDirectory, 0o700);

  let key;
  try {
    key = (await readFile(keyPath, 'utf8')).trim();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    key = randomBytes(32).toString('hex');
    await writeFile(keyPath, `${key}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  if (process.platform !== 'win32') await chmod(keyPath, 0o600);

  const store = new PersonalAuthStore({
    filePath: storePath,
    masterKey: parseMasterKey(key),
    allowedScopes: PERSONAL_SCOPES,
  });
  try {
    await store.initialize();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  console.log(`State directory initialized: ${stateDirectory}`);
  console.log(`NETEASE_PERSONAL_MASTER_KEY_FILE=${keyPath}`);
  console.log(`NETEASE_PERSONAL_STORE_FILE=${storePath}`);
  console.log('Keep both files out of Git and backups must remain encrypted.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
