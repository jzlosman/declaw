import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isolatedRequest } from '../../src/adapters/pi.ts';

const root = resolve(process.env.PI_PACKAGE_ROOT ?? join(dirname(process.execPath),
  '../lib/node_modules/@earendil-works/pi-coding-agent'));
const requirePi = createRequire(join(root, 'package.json'));
const aiRoot = (requirePi.resolve.paths('@earendil-works/pi-ai') ?? [])
  .map((path) => join(path, '@earendil-works/pi-ai'))
  .find((path) => existsSync(join(path, 'package.json')));
assert.ok(aiRoot, 'Pi AI package is installed');
const codex = await import(join(aiRoot, 'dist/api/openai-codex-responses.js'));
const anthropic = await import(join(aiRoot, 'dist/api/anthropic-messages.js'));
const token = `offline.${Buffer.from(JSON.stringify({
  'https://api.openai.com/auth': { chatgpt_account_id: 'offline-only' },
})).toString('base64url')}.offline`;
const base = {
  id: 'offline-model', name: 'Offline model', baseUrl: 'https://example.invalid',
  reasoning: true, input: ['text'], maxTokens: 32768, contextWindow: 200000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

// Exercise Pi's real provider serializers. Stop before sending anything; no real credentials.
test('provider adapters serialize the separate low-thinking request correctly', async (t) => {
  for (const variant of ['codex', 'adaptive', 'budget', 'managed']) {
    await t.test(variant, { timeout: 2000 }, async () => {
      const isCodex = variant === 'codex';
      const model: any = { ...base, provider: isCodex ? 'openai-codex' : 'anthropic',
        api: isCodex ? 'openai-codex-responses' : 'anthropic-messages',
        compat: { forceAdaptiveThinking: variant !== 'budget', supportsMidConvoEffort: variant === 'managed' },
      };
      const { context, options } = isolatedRequest('Only this answer.', model, new AbortController().signal);
      let payload: any;
      let requests = 0;
      const response = await (isCodex ? codex : anthropic).streamSimple(model, context, {
        ...options,
        apiKey: isCodex ? token : 'offline-test-key',
        transport: 'sse',
        fetch: async () => { requests++; throw new Error('Network disabled in test'); },
        onPayload: (body: unknown) => { payload = body; throw new Error('Stopped before network'); },
      }).result();
      assert.equal(requests, 0);
      assert.equal(response.stopReason, 'error');
      assert.ok(payload, response.errorMessage);
      if (isCodex) assert.equal(payload.reasoning.effort, 'low');
      else if (variant === 'budget') assert.equal(payload.thinking.budget_tokens, 2048);
      else if (variant === 'managed') assert.equal(payload.messages.at(-1).output_config.effort, 'low');
      else assert.equal(payload.output_config.effort, 'low');
      assert.ok(!payload.tools?.length, 'no agent tools in serialized request');
    });
  }
});
