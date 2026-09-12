import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

test('real Pi SDK initializes configured auth offline without a model call', async t => {
  const sdkRoot = resolve(process.env.PI_PACKAGE_ROOT ?? (process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules/@earendil-works/pi-coding-agent')
    : join(dirname(process.execPath), '../lib/node_modules/@earendil-works/pi-coding-agent')));
  const root = await mkdtemp(join(tmpdir(), 'plain-sdk-startup-'));
  const env = process.env, originalFetch = globalThis.fetch;
  let networkCalls = 0;
  process.env = { PATH: env.PATH, HOME: root, PI_CODING_AGENT_DIR: root, AWS_EC2_METADATA_DISABLED: 'true' };
  globalThis.fetch = async () => { networkCalls++; throw new Error('Network forbidden in SDK startup test'); };
  t.after(async () => { process.env = env; globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); });
  const authPath = join(root, 'auth.json');
  await writeFile(authPath, JSON.stringify({ openai: { type: 'api_key', key: 'fixture-only-not-a-real-key' } }));
  const { ModelRuntime, ModelRegistry } = await import(pathToFileURL(join(sdkRoot, 'dist/index.js')).href);
  const options = { authPath, modelsPath: null, allowModelNetwork: false, signal: AbortSignal.timeout(5000) };
  const uninitialized = await ModelRuntime.create({ ...options, refreshOnCreate: false });
  assert.equal(new ModelRegistry(uninitialized).hasConfiguredAuth({ provider: 'openai' }), false);
  const ready = await ModelRuntime.create(options);
  assert.equal(new ModelRegistry(ready).hasConfiguredAuth({ provider: 'openai' }), true);
  assert.equal(networkCalls, 0);
});
