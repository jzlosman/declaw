import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('extension install has no GEPA or Python setup requirement', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    assert.ok(Object.keys(manifest[field] ?? {}).every(name => !/gepa|python/i.test(name)), `${field} must not require the private optimizer`);
  }
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(manifest.scripts?.[hook], undefined, 'Pi installation must not run optimizer setup');
  }
  assert.deepEqual(manifest.pi.extensions, ['./index.ts']);
  assert.doesNotMatch(JSON.stringify(manifest.files), /gepa|\.venv|private\/declaw-lab/i);
});
