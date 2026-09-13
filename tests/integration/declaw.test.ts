import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readModelChoice, saveModelChoice, DEFAULT_MODEL, readStyleChoice, saveStyleChoice } from '../../src/adapters/settings.ts';
import { buildStyleRequest, DEFAULT_REWRITE_GUIDANCE, DEFAULT_STYLE_ID, STYLE_IDS, REWRITE_POLICY_VERSION } from '../../src/domain/styles.ts';
import { BUILTIN_CATALOG, STYLES } from '../../src/plugins/built-in/catalog.ts';
import { supportsLowThinking } from '../../src/adapters/model.ts';
import { prepareRewrite, finalizeRewrite,
  MAX_INPUT_CHARS, MAX_OUTPUT_CHARS, ENTRY_TYPE, REWRITE_PROVIDER, REWRITE_MODEL, REWRITE_THINKING, POLICY_VERSION } from '../../src/domain/rewrite.ts';
import { REWRITE_TIMEOUT_MS as TIMEOUT_MS } from '../../src/application/rewrite.ts';
import { completedText, latestAnswer, isolatedRequest, SYSTEM_PROMPT } from '../../src/adapters/pi.ts';
import { registerDeclawPlugin, clearDeclawPluginBridgeForTests } from '../../src/plugin-api.ts';

// Override when Pi is installed outside this Node executable's global prefix.
const packagePath = join(resolve(process.env.PI_PACKAGE_ROOT ?? join(dirname(process.execPath),
  '../lib/node_modules/@earendil-works/pi-coding-agent')), 'package.json');
const requirePi = createRequire(packagePath);
const root = dirname(packagePath);
const { loadExtensions } = await import(requirePi.resolve(join(root, 'dist/core/extensions/loader.js')));
const { SessionManager } = await import(requirePi.resolve(join(root, 'dist/core/session-manager.js')));
const { initTheme, getThemeByName } = await import(requirePi.resolve(join(root, 'dist/modes/interactive/theme/theme.js')));
initTheme('dark', false);
const theme = getThemeByName('dark');
const cwd = fileURLToPath(new URL('../..', import.meta.url));
const model: any = { id: REWRITE_MODEL, provider: REWRITE_PROVIDER, api: 'openai-codex-responses', maxTokens: 8192, reasoning: true };
const mainModel = { ...model, id: 'gpt-6-astra' };
const rewrittenMock = (text: string) => text.replace(/^The service uses /, 'This service uses ');
const requestTarget = (context: any): string => {
  const payload = context.messages[0].content;
  if (payload.startsWith('Context:\n\n\nTarget:\n')) return payload.slice('Context:\n\n\nTarget:\n'.length);
  return JSON.parse(payload).assistantMessage;
};
const answer = (text = 'The service uses `config.json` and waits 25 seconds.', extra = {}): any => ({
  role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop',
  api: model.api, provider: model.provider, model: model.id, timestamp: 1, ...extra,
});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const reload = (sm: any) => SessionManager.inMemory(cwd, undefined,
  JSON.parse(JSON.stringify([sm.getHeader(), ...sm.getEntries()])));

async function harness(t: any, seed = true, existingAgentDir?: string) {
  const agentDir = existingAgentDir ?? await mkdtemp(join(tmpdir(), 'plain-test-'));
  if (!existingAgentDir) t.after(() => rm(agentDir, { recursive: true, force: true }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  let loaded: any;
  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    loaded = await loadExtensions([join(cwd, 'index.ts')], cwd);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  assert.equal(process.env.PI_CODING_AGENT_DIR, previousAgentDir, 'restore agent-dir env immediately after loading');
  assert.deepEqual(loaded.errors, []);
  const ext = loaded.extensions[0];
  const sm = SessionManager.inMemory(cwd);
  if (seed) {
    sm.appendMessage({ role: 'user', content: 'PRIVATE_USER_HISTORY', timestamp: 1 });
    sm.appendMessage(answer('PRIVATE_OLD_ANSWER'));
    sm.appendMessage({ role: 'toolResult', toolCallId: 'secret', toolName: 'bash',
      content: [{ type: 'text', text: 'PRIVATE_TOOL_RESULT' }], isError: false, timestamp: 1 });
    sm.appendMessage(answer(undefined, { content: [
      { type: 'thinking', thinking: 'PRIVATE_REASONING', thinkingSignature: 'PRIVATE_SIGNATURE' },
      ...answer().content,
    ] }));
    sm.appendCustomEntry('other-extension', { text: 'PRIVATE_CUSTOM_ENTRY' });
  }
  const calls: any[] = [], notices: string[] = [], rendered: string[] = [], picks: any[] = [];
  const callWaiters = new Map<number, ReturnType<typeof deferred<any[]>>>();
  const authStarted = deferred();
  let loader: any;
  const h: any = { sm, ext, calls, notices, rendered, picks, auth: true, idle: true, rewriteModel: model,
    agentDir, settingsPath: join(agentDir, 'declaw', 'settings.json'), stylePath: join(agentDir, 'declaw', 'style.json'),
    available: [model], authCalls: [], loaderFrames: [],
    providerCalls: [], results: [], findCalls: [],
    authResult: { ok: true, apiKey: 'FAKE_API_KEY', headers: { 'x-test': 'fake' }, env: { TEST_ONLY: 'fake' } },
    resolveAuth: async () => h.authResult,
    complete: async (_model: any, context: any) => answer(rewrittenMock(requestTarget(context))),
    select: async () => undefined,
    waitForAuth: () => authStarted.promise,
    waitForCall: (index = 0) => {
      if (calls[index]) return Promise.resolve(calls[index]);
      if (!callWaiters.has(index)) callWaiters.set(index, deferred<any[]>());
      return callWaiters.get(index)!.promise;
    },
  };
  h.provider = { streamSimple: (...args: any[]) => {
    const index = calls.push(args) - 1;
    const result = Promise.resolve().then(() => h.complete(...args));
    h.results.push(result);
    callWaiters.get(index)?.resolve(args);
    return { result: () => result };
  } };
  const ctx: any = { mode: 'tui', hasUI: true, model: mainModel, thinkingLevel: 'high', sessionManager: sm,
    isIdle: () => h.idle,
    modelRegistry: { find: (provider: string, id: string) => {
      h.findCalls.push([provider, id]);
      return [h.rewriteModel, ...h.available.filter((m: any) => m.id !== model.id || m.provider !== model.provider)]
        .find((m: any) => m?.provider === provider && m.id === id);
    }, getAvailable: () => h.available,
      hasConfiguredAuth: (m: any) => h.auth && m.auth !== false,
      getProvider: (provider: string) => { h.providerCalls.push(provider); return h.provider; },
      getApiKeyAndHeaders: (m: any) => {
        h.authCalls.push(m);
        const result = h.resolveAuth(m);
        authStarted.resolve();
        return result;
      },
      complete: () => assert.fail('must use provider.streamSimple, not registry.complete'),
    },
    ui: { notify: (message: string) => notices.push(message),
      select: (...args: any[]) => { picks.push(args); return h.select(...args); },
      custom: async (factory: any) => {
      try {
        return await new Promise((resolve) => {
          loader = factory({ requestRender() {} }, theme, {}, resolve);
          h.loader = loader;
          h.loaderFrames.push(loader.render(200).join('\n'));
        });
      } finally { loader?.dispose(); loader = undefined; }
    } },
  };
  loaded.runtime.setModel = () => assert.fail('/declaw must not change the main model');
  loaded.runtime.setThinkingLevel = () => assert.fail('/declaw must not change main thinking');
  loaded.runtime.appendEntry = (customType: string, data: any) => {
    const id = ctx.sessionManager.appendCustomEntry(customType, data);
    const entry = ctx.sessionManager.getEntries().find((e: any) => e.id === id);
    const renderer = ext.entryRenderers.get(customType);
    assert.ok(renderer, 'custom entry has a registered renderer');
    rendered.push(renderer(entry, {}, theme).render(100).join('\n'));
  };
  h.ctx = ctx;
  h.run = (args = '') => ext.commands.get('declaw').handler(args, ctx);
  h.emit = async (type: string) => {
    for (const handler of ext.handlers.get(type) ?? []) await handler({ type }, ctx);
  };
  h.entries = () => ctx.sessionManager.getEntries().filter((e: any) => e.customType === ENTRY_TYPE);
  t.after(async () => { await h.emit('session_shutdown'); loader?.dispose(); loaded.runtime.invalidate(); });
  return h;
}

test('native envelopes receive raw literals, fences, CRLF and Unicode without masking or source mutation', async (t) => {
  const source = ['The service uses `a$&b` and ``a`b``.', '"exact words" “curly quotation”',
    '[guide](https://example.test/a)', 'https://example.test/x?q=1', '/tmp/a.txt ./src/file.ts',
    'C:\\work\\file.ts config.yaml', '25 seconds -3.5% npm test -- --run',
    '```ts\r\nconst x = "$&";\r\n```', '~~~sh\necho exact\n~~~',
    'Résumé ⟦KEEP_source_literal_0⟧', '```\nunclosed fence'].join('\r\n');
  for (const style of STYLE_IDS) {
    await t.test(style, async (t) => {
      const h = await harness(t);
      const sourceId = h.sm.appendMessage(answer(source));
      const before = structuredClone(h.sm.buildSessionContext().messages);
      h.complete = async (_m: any, context: any) => {
        assert.equal(requestTarget(context), source, 'plugin receives every source character');
        const expectedPayload = style === 'slye' ? `Context:\n\n\nTarget:\n${source}`
          : JSON.stringify({ assistantMessage: source });
        assert.equal(context.messages[0].content, expectedPayload);
        assert.doesNotMatch(JSON.stringify(context), /PRIVATE_/);
        return answer(rewrittenMock(source));
      };
      await h.run(style);
      assert.equal(h.calls.length, 1);
      assert.equal(h.entries().length, 1);
      assert.equal(h.entries()[0].data.sourceEntryId, sourceId);
      assert.equal(h.entries()[0].data.text, rewrittenMock(source));
      assert.deepEqual(h.sm.buildSessionContext().messages, before);
    });
  }
});

test('latest answer skips non-assistant entries but never falls back past a failed assistant', () => {
  const entry = (message: any, id = 'latest'): any => ({ type: 'message', id, message });
  const base: any[] = [entry(answer('Earlier.'), 'old'), entry(answer('Latest.')),
    { type: 'custom', data: { text: 'Not an answer.' } },
    entry({ role: 'user', content: 'Not an answer.' }),
    entry({ role: 'custom', content: 'Not an answer.' })];
  assert.deepEqual(latestAnswer(base), { id: 'latest', text: 'Latest.' });
  for (const failure of [answer('Partial', { stopReason: 'length' }), answer('Failed', { stopReason: 'error' }),
    answer('Cancelled', { stopReason: 'aborted' }), answer('', { content: [{ type: 'thinking', thinking: 'secret' }] }),
    answer('Text', { errorMessage: 'PRIVATE_PROVIDER_ERROR' }),
    answer('Text', { content: [...answer().content, { type: 'toolCall', id: 'x', name: 'bash', arguments: {} }] })]) {
    assert.equal(latestAnswer([...base, entry(failure)]), undefined);
    assert.equal(completedText(failure), undefined);
  }
});

test('isolated requests have fresh session IDs and no ambient context', () => {
  const signal = new AbortController().signal;
  const a = isolatedRequest('Raw `config.json` and 25 seconds.', model, signal), b = isolatedRequest('Raw `config.json` and 25 seconds.', model, signal);
  assert.notEqual(a.options.sessionId, b.options.sessionId);
  assert.equal(a.options.signal, signal);
  assert.equal(a.options.cacheRetention, 'none');
  assert.equal(a.options.reasoning, 'low');
  assert.equal('reasoningEffort' in a.options, false);
  assert.equal(a.options.maxTokens, model.maxTokens);
  assert.equal(a.context.systemPrompt, SYSTEM_PROMPT);
  assert.deepEqual(a.context.tools, []);
  assert.equal(a.context.messages.length, 1);
  assert.equal(a.context.messages[0].content, JSON.stringify({ assistantMessage: 'Raw `config.json` and 25 seconds.' }));
});

test('real command calls once with the raw answer and persists its result outside model context', async (t) => {
  const h = await harness(t);
  const before = structuredClone(h.sm.buildSessionContext().messages);
  const sourceId = latestAnswer(h.sm.getBranch())!.id;
  h.complete = async (_m: any, c: any) => {
    assert.equal(h.entries().length, 0, 'no rewrite is published before completion');
    return answer(rewrittenMock(requestTarget(c)));
  };
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.findCalls, [[model.provider, model.id]]);
  assert.deepEqual(h.providerCalls, [model.provider]);
  assert.deepEqual(h.authCalls, [model]);
  const [selected, context, options] = h.calls[0];
  assert.deepEqual(selected, model);
  assert.equal(selected.id, 'gpt-5.6-luna');
  assert.equal(options.reasoning, 'low');
  assert.equal(h.ctx.model, mainModel);
  assert.equal(h.ctx.thinkingLevel, 'high');
  assert.equal(context.systemPrompt, SYSTEM_PROMPT);
  assert.deepEqual(context.tools, []);
  assert.deepEqual(Object.keys(context).sort(), ['messages', 'systemPrompt', 'tools']);
  assert.equal(context.messages.length, 1);
  assert.equal(context.messages[0].role, 'user');
  const payload = JSON.parse(context.messages[0].content);
  assert.deepEqual(Object.keys(payload), ['assistantMessage']);
  assert.equal(payload.assistantMessage, answer().content[0].text);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_|FAKE/);
  assert.notEqual(options.sessionId, h.sm.getSessionId());
  assert.equal(h.entries().length, 1);
  assert.equal(h.entries()[0].data.sourceEntryId, sourceId);
  assert.equal(h.entries()[0].data.text, rewrittenMock(answer().content[0].text));
  assert.match(h.rendered.join(' '), /This service uses/);
  assert.equal(h.entries()[0].data.model, `${REWRITE_PROVIDER}/${REWRITE_MODEL}`);
  assert.equal(h.entries()[0].data.thinkingLevel, REWRITE_THINKING);
  assert.equal(h.entries()[0].data.version, REWRITE_POLICY_VERSION);
  assert.equal(h.entries()[0].data.style, DEFAULT_STYLE_ID);
  assert.match(h.rendered[0], /gpt-5\.6-luna/);
  assert.match(h.rendered[0], /low thinking/);
  assert.match(h.rendered[0], /Plain English/);
  assert.match(h.rendered[0], /config\.json/);
  assert.deepEqual(h.sm.buildSessionContext().messages, before);
  h.ctx.sessionManager = reload(h.sm);
  assert.deepEqual(h.ctx.sessionManager.buildSessionContext().messages, before);
  h.ctx.sessionManager.appendCompaction('Safe summary.', sourceId, 100);
  const compacted = h.ctx.sessionManager.buildSessionContext().messages;
  h.complete = async (_m: any, c: any) => answer(rewrittenMock(requestTarget(c)));
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(new Set(h.calls.map((call: any[]) => call[2].sessionId)).size, 2);
  assert.deepEqual(h.ctx.sessionManager.buildSessionContext().messages, compacted);
  assert.deepEqual(reload(h.ctx.sessionManager).buildSessionContext().messages, compacted);
  assert.equal(h.entries().length, 2);
});

test('guards prevent model calls in busy, non-TUI, no-answer, no-auth, no-model and oversize states', async (t) => {
  for (const scenario of ['busy', 'rpc', 'no-answer', 'failed-answer', 'no-auth', 'no-model', 'oversize', 'arguments']) {
    await t.test(scenario, async (t) => {
      const h = await harness(t, scenario !== 'no-answer');
      if (scenario === 'busy') h.idle = false;
      if (scenario === 'rpc') { h.ctx.mode = 'rpc'; h.ctx.hasUI = false; }
      if (scenario === 'no-auth') h.auth = false;
      if (scenario === 'no-model') h.rewriteModel = undefined;
      if (scenario === 'failed-answer') h.sm.appendMessage(answer('Partial', { stopReason: 'length' }));
      if (scenario === 'oversize') h.sm.appendMessage(answer('x'.repeat(MAX_INPUT_CHARS + 1)));
      await h.run(scenario === 'arguments' ? 'unexpected' : '');
      assert.equal(h.calls.length, 0);
      assert.equal(h.entries().length, 0);
    });
  }
});

test('non-terminal UI and malformed commands receive actionable notices without entering the rewrite flow', async (t) => {
  const h = await harness(t);
  h.ctx.mode = 'rpc';
  await h.run();
  assert.deepEqual(h.notices, ["/declaw currently requires Pi's terminal UI."]);
  h.ctx.mode = 'tui';
  await h.run('plain extra');
  assert.equal(h.notices.at(-1), 'Use /declaw to rewrite, /declaw style, /declaw model, /declaw list, or /declaw manage.');
  assert.equal(h.calls.length + h.authCalls.length + h.findCalls.length + h.picks.length + h.entries().length, 0);
  await h.run('plain');
  assert.equal(h.entries().length, 1, 'rejected commands do not reserve the next request');
});

test('input and output limits are inclusive operational bounds, not technical-content checks', async (t) => {
  assert.equal(MAX_INPUT_CHARS, 32_000);
  assert.equal(MAX_OUTPUT_CHARS, 64_000);
  const h = await harness(t);
  const source = 'x'.repeat(MAX_INPUT_CHARS);
  const output = 'y'.repeat(MAX_OUTPUT_CHARS);
  const sourceId = h.sm.appendMessage(answer(source));
  const before = structuredClone(h.sm.buildSessionContext().messages);
  h.complete = async () => answer(output);
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(requestTarget(h.calls[0][1]), source);
  assert.equal(h.entries().length, 1);
  assert.equal(h.entries()[0].data.sourceEntryId, sourceId);
  assert.equal(h.entries()[0].data.text, output);
  assert.deepEqual(h.sm.buildSessionContext().messages, before);
});

test('Luna selection works without a main model and never changes main thinking', async (t) => {
  const h = await harness(t);
  h.ctx.model = undefined;
  h.ctx.thinkingLevel = 'max';
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0][0], model);
  assert.equal(h.calls[0][2].reasoning, 'low');
  assert.equal(h.ctx.model, undefined);
  assert.equal(h.ctx.thinkingLevel, 'max');
});

test('model configuration cannot silently remap low thinking or fall back to Astra', async (t) => {
  for (const patch of [{ thinkingLevelMap: { low: 'high' } }, { thinkingLevelMap: { low: null } },
    { reasoning: false }]) {
    const h = await harness(t);
    h.rewriteModel = { ...model, ...patch };
    await h.run();
    assert.equal(h.calls.length, 0);
    assert.match(h.notices.join(' '), /low thinking support/);
    assert.equal(h.ctx.model, mainModel);
  }
});

test('unchanged model output is reported without adding a duplicate or automatically retrying', async (t) => {
  const h = await harness(t);
  h.complete = async (_m: any, c: any) => answer(requestTarget(c));
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.entries().length, 0);
  assert.match(h.notices.join(' '), /unchanged/);
  const prepared = prepareRewrite('Already clear.');
  assert.equal(prepared.kind, 'ready');
  if (prepared.kind === 'ready') assert.deepEqual(finalizeRewrite(prepared.plan, '\nAlready clear.\n'),
    { kind: 'rejected', reason: 'unchanged' });
});

test('malformed, incomplete, empty and oversized provider output fails without retries or source mutation', async (t) => {
  const failures: Record<string, () => any> = {
    throw: () => { throw new Error('PRIVATE_PROVIDER_PAYLOAD'); },
    null: () => null,
    malformed: () => ({}),
    'invalid-content': () => answer('', { content: null }),
    truncated: () => answer('PRIVATE_PARTIAL', { stopReason: 'length' }),
    aborted: () => answer('PRIVATE_PARTIAL', { stopReason: 'aborted' }),
    'tool-call': () => answer('PRIVATE_OUTPUT', { content: [...answer('PRIVATE_OUTPUT').content,
      { type: 'toolCall', id: 'x', name: 'bash', arguments: {} }] }),
    error: () => answer('PRIVATE_OUTPUT', { errorMessage: 'PRIVATE_ERROR' }),
    empty: () => answer(''),
    whitespace: () => answer('   '),
    oversize: () => answer('x'.repeat(MAX_OUTPUT_CHARS + 1)),
    'thinking-only': () => answer('', { content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }] }),
  };
  for (const [failure, response] of Object.entries(failures)) {
    await t.test(failure, async (t) => {
      const h = await harness(t);
      const source = 'PRIVATE_SOURCE uses `config.json` and waits 25 seconds.';
      const sourceId = h.sm.appendMessage(answer(source));
      const before = structuredClone(h.sm.buildSessionContext().messages);
      h.complete = async (_m: any, context: any) => {
        assert.equal(requestTarget(context), source);
        assert.equal(h.entries().length, 0);
        return response();
      };
      await h.run();
      assert.equal(h.calls.length, 1);
      assert.equal(requestTarget(h.calls[0][1]), source, 'failure still used the raw selected source');
      assert.equal(h.entries().length, 0);
      assert.equal(h.rendered.length, 0);
      assert.deepEqual(latestAnswer(h.sm.getBranch()), { id: sourceId, text: source });
      assert.deepEqual(h.sm.buildSessionContext().messages, before);
      assert.ok(h.notices.length > 0);
      assert.doesNotMatch(h.notices.join(' '), /PRIVATE_|config\.json|25/);
      assert.match(h.notices.join(' '), /original is unchanged/i);
    });
  }
  assert.deepEqual(prepareRewrite('x'.repeat(MAX_INPUT_CHARS + 1)), { kind: 'rejected', reason: 'source-too-long' });
});

test('publication failure hides storage diagnostics, preserves the source and releases the next command', async (t) => {
  const h = await harness(t);
  const before = structuredClone(h.sm.buildSessionContext().messages);
  const source = latestAnswer(h.sm.getBranch());
  // The real runtime append hook delegates to this session persistence boundary.
  const append = t.mock.method(h.sm, 'appendCustomEntry', () => {
    throw new Error('PRIVATE_STORAGE_FAILURE /private/session.jsonl FAKE_API_KEY');
  });
  await h.run();
  assert.equal(append.mock.callCount(), 1, 'a failed publication is not retried');
  assert.equal(append.mock.calls[0].arguments[0], ENTRY_TYPE);
  assert.equal(append.mock.calls[0].arguments[1].sourceEntryId, source!.id);
  assert.equal(append.mock.calls[0].arguments[1].text, rewrittenMock(source!.text));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][2].signal.aborted, true, 'the failed command cleans up its controller');
  assert.equal(h.entries().length + h.rendered.length, 0);
  assert.deepEqual(h.notices, ['The rewrite failed. The original is unchanged.']);
  assert.deepEqual(latestAnswer(h.sm.getBranch()), source);
  assert.deepEqual(h.sm.buildSessionContext().messages, before);
  append.mock.restore();
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.entries().length, 1, 'publication failure does not retain the active reservation');
  assert.deepEqual(h.sm.buildSessionContext().messages, before);
});

test('a UI setup failure is reported safely without calling the provider or retaining the command', async (t) => {
  const h = await harness(t);
  const before = structuredClone(h.sm.buildSessionContext().messages);
  const custom = t.mock.method(h.ctx.ui, 'custom', async () => {
    throw new Error('PRIVATE_TERMINAL_FAILURE FAKE_API_KEY');
  });
  await h.run();
  assert.equal(custom.mock.callCount(), 1);
  assert.equal(h.calls.length + h.authCalls.length + h.entries().length + h.rendered.length, 0);
  assert.deepEqual(h.notices, ['The /declaw request failed. The original is unchanged.']);
  assert.deepEqual(h.sm.buildSessionContext().messages, before);
  custom.mock.restore();
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.entries().length, 1);
});

test('cancellation and lifecycle events release active request and discard late provider results', async (t) => {
  for (const event of ['escape', 'session_shutdown', 'session_tree', 'agent_start']) {
    await t.test(event, async (t) => {
      const h = await harness(t);
      let finish: any;
      h.complete = () => new Promise((resolve) => { finish = resolve; });
      const pending = h.run();
      await h.waitForCall();
      assert.equal(h.calls.length, 1);
      await h.run();
      assert.equal(h.calls.length, 1, 'concurrent invocation is blocked');
      if (event === 'escape') h.loader.handleInput('\x1b');
      else await h.emit(event);
      await pending;
      assert.equal(h.calls[0][2].signal.aborted, true);
      assert.equal(h.calls.length, 1, 'cancellation does not trigger another request');
      assert.equal(h.entries().length, 0);
      h.complete = async (_m: any, c: any) => answer(rewrittenMock(requestTarget(c)));
      await h.run();
      assert.equal(h.entries().length, 1, 'next invocation succeeds even while old provider hangs');
      finish(answer(rewrittenMock(requestTarget(h.calls[0][1]))));
      await h.results[0];
      assert.equal(h.calls.length, 2, 'late results cannot trigger another request');
      assert.equal(h.entries().length, 1, 'late result was not published');
    });
  }
});

test('timeout discards late rejection, reports safe error, and releases the next request', async (t) => {
  const h = await harness(t);
  assert.equal(TIMEOUT_MS, 60_000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let rejectLate: any;
  h.complete = () => new Promise((_resolve, reject) => { rejectLate = reject; });
  const pending = h.run();
  await h.waitForCall();
  t.mock.timers.tick(TIMEOUT_MS - 1);
  assert.equal(h.calls[0][2].signal.aborted, false);
  assert.equal(h.entries().length, 0);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(h.entries().length, 0);
  assert.equal(h.calls[0][2].signal.aborted, true);
  assert.match(h.notices.join(' '), /timed out/);
  rejectLate(new Error('PRIVATE_LATE_PROVIDER_REJECTION'));
  await assert.rejects(h.results[0], /PRIVATE_LATE_PROVIDER_REJECTION/);
  assert.doesNotMatch(h.notices.join(' '), /PRIVATE_/);
  h.complete = async (_m: any, c: any) => answer(rewrittenMock(requestTarget(c)));
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(h.entries().length, 1);
  t.mock.timers.reset();
});

test('session replacement or a newer answer identity suppresses stale publication without lifecycle event', async (t) => {
  for (const change of ['session', 'answer', 'same-answer', 'busy']) {
    const h = await harness(t);
    let finish: any;
    h.complete = () => new Promise((resolve) => { finish = resolve; });
    const pending = h.run();
    await h.waitForCall();
    if (change === 'session') h.ctx.sessionManager = SessionManager.inMemory(cwd);
    if (change === 'answer') h.sm.appendMessage(answer('Newer answer.'));
    if (change === 'same-answer') h.sm.appendMessage(answer(requestTarget(h.calls[0][1])));
    if (change === 'busy') h.idle = false;
    finish(answer(rewrittenMock(requestTarget(h.calls[0][1]))));
    await pending;
    assert.equal(h.calls.length, 1, 'stale results are discarded without retry');
    assert.equal(h.entries().length, 0);
    assert.equal(h.rendered.length, 0);
  }
});

test('one call retains the selected model and style snapshot while the next command reads new preferences', async (t) => {
  const h = await harness(t);
  const alternate = { ...model, provider: 'anthropic', id: 'new-model', api: 'anthropic-messages' };
  h.available = [model, alternate];
  await saveStyleChoice(h.stylePath, 'terse');
  const completion = deferred<any>();
  h.complete = () => completion.promise;
  const pending = h.run();
  await h.waitForCall();
  await saveStyleChoice(h.stylePath, 'slye');
  await saveModelChoice(h.settingsPath, { provider: alternate.provider, modelId: alternate.id });
  h.rewriteModel = { ...model, api: 'google-generative-ai', reasoning: false };
  completion.resolve(answer(rewrittenMock(requestTarget(h.calls[0][1]))));
  await pending;
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.findCalls, [[model.provider, model.id]]);
  assert.deepEqual(h.calls[0][0], model);
  assert.deepEqual(h.authCalls, [model]);
  assert.deepEqual(h.providerCalls, [model.provider]);
  assert.equal(h.calls[0][1].systemPrompt, buildStyleRequest(answer().content[0].text, 'terse', BUILTIN_CATALOG).system);
  assert.equal(h.entries()[0].data.style, 'terse');
  assert.equal(h.entries()[0].data.model, `${model.provider}/${model.id}`);
  h.complete = async (_m: any, context: any) => answer(rewrittenMock(requestTarget(context)));
  await h.run();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1][0], alternate);
  assert.deepEqual(h.authCalls, [model, alternate]);
  assert.equal(h.calls[1][1].systemPrompt, buildStyleRequest(answer().content[0].text, 'slye', BUILTIN_CATALOG).system);
  assert.notEqual(h.calls[0][2].sessionId, h.calls[1][2].sessionId);
  assert.equal(h.entries()[1].data.style, 'slye');
  assert.equal(h.entries()[1].data.model, `${alternate.provider}/${alternate.id}`);
  assert.equal(h.ctx.model, mainModel);
});

test('picker saves a separate preference without an answer or model call, and fresh extensions retain it', async (t) => {
  const h = await harness(t, false);
  const alternate = { ...model, provider: 'anthropic', id: 'reasoning-model', api: 'anthropic-messages' };
  h.available = [model, alternate];
  h.select = async (_title: string, labels: string[]) => labels.find((label) => label.startsWith('anthropic/'));
  await h.run('model');
  assert.equal(h.picks.length, 1);
  assert.match(h.picks[0][0], /low thinking/);
  assert.ok(h.picks[0][1].includes(`${model.provider}/${model.id}  (current)`));
  assert.deepEqual(JSON.parse(await readFile(h.settingsPath, 'utf8')),
    { version: 1, provider: alternate.provider, modelId: alternate.id });
  assert.equal(h.calls.length, 0);
  assert.equal(h.authCalls.length, 0);
  assert.equal(h.providerCalls.length, 0);
  assert.equal(h.entries().length, 0);
  assert.equal(h.ctx.model, mainModel);
  assert.equal(h.ctx.thinkingLevel, 'high');
  assert.equal((await stat(h.settingsPath)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(h.settingsPath))).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(dirname(h.settingsPath)), ['settings.json']);

  const fresh = await harness(t, true, h.agentDir);
  fresh.available = [model, alternate];
  await fresh.run();
  assert.equal(fresh.calls.length, 1);
  assert.deepEqual(fresh.calls[0][0], alternate);
  assert.equal(fresh.calls[0][2].reasoning, 'low');
  assert.equal(fresh.entries()[0].data.model, 'anthropic/reasoning-model');
  assert.equal(fresh.ctx.model, mainModel);
  assert.equal(fresh.ctx.thinkingLevel, 'high');
  fresh.ctx.sessionManager = reload(fresh.sm);
  await fresh.run();
  assert.equal(fresh.calls.length, 2);
  assert.deepEqual(fresh.calls[1][0], alternate);
  await fresh.run('model');
  assert.ok(fresh.picks[0][1].includes('anthropic/reasoning-model  (current)'));
});

test('each harness captures its own temporary settings path, not later environment or global settings', async (t) => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const first = await harness(t, false);
  const second = await harness(t, false);
  assert.notEqual(first.agentDir, second.agentDir);
  assert.equal(process.env.PI_CODING_AGENT_DIR, previousAgentDir);
  first.available = [{ ...model, provider: 'test', id: 'first-only' }];
  first.select = async (_title: string, labels: string[]) => labels[0];
  await first.run('model');
  assert.deepEqual(await readModelChoice(first.settingsPath), { provider: 'test', modelId: 'first-only' });
  await assert.rejects(stat(second.settingsPath), { code: 'ENOENT' });
  second.select = async (_title: string, labels: string[]) => labels[0];
  await second.run('model');
  assert.deepEqual(await readModelChoice(second.settingsPath), DEFAULT_MODEL);
  assert.deepEqual(await readModelChoice(first.settingsPath), { provider: 'test', modelId: 'first-only' });
  assert.equal(process.env.PI_CODING_AGENT_DIR, previousAgentDir);
  assert.equal(first.calls.length + second.calls.length, 0);
});

test('picker cancellation ignores a late selection and blocks overlapping commands while open', async (t) => {
  const h = await harness(t, false);
  const opened = deferred();
  const selection = deferred<string>();
  h.select = () => { opened.resolve(); return selection.promise; };
  const pending = h.run('model');
  await opened.promise;
  await h.run('model');
  assert.equal(h.picks.length, 1);
  assert.match(h.notices.join(' '), /Wait for the current request/);
  await h.emit('session_tree');
  assert.equal(h.picks[0][2].signal.aborted, true);
  selection.resolve(h.picks[0][1][0]);
  await pending;
  await assert.rejects(stat(h.settingsPath), { code: 'ENOENT' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.authCalls.length, 0);
  h.select = async (_title: string, labels: string[]) => labels[0];
  await h.run('model');
  assert.deepEqual(await readModelChoice(h.settingsPath), DEFAULT_MODEL);
});

test('picker cancel leaves settings and main agent unchanged and makes no requests', async (t) => {
  for (const saved of [false, true]) {
    const h = await harness(t, false);
    if (saved) await saveModelChoice(h.settingsPath, DEFAULT_MODEL);
    const before = saved ? await readFile(h.settingsPath, 'utf8') : undefined;
    await h.run('model');
    assert.equal(h.calls.length, 0);
    assert.equal(h.authCalls.length, 0);
    assert.equal(h.ctx.model, mainModel);
    assert.equal(h.ctx.thinkingLevel, 'high');
    if (saved) assert.equal(await readFile(h.settingsPath, 'utf8'), before);
    else await assert.rejects(stat(h.settingsPath), { code: 'ENOENT' });
  }
});

test('picker lists only authenticated models that preserve low thinking, sorted across providers', async (t) => {
  const h = await harness(t, false);
  const allowed = { ...model, provider: 'anthropic', id: 'allowed', api: 'anthropic-messages', thinkingLevelMap: { low: 'low' } };
  h.available = [
    model, { ...model, id: 'nonreasoning', reasoning: false },
    { ...model, id: 'unauthenticated', auth: false },
    { ...model, id: 'remapped', thinkingLevelMap: { low: 'high' } },
    { ...model, id: 'disabled', thinkingLevelMap: { low: null } }, allowed,
  ];
  await h.run('model');
  assert.deepEqual(h.picks[0][1], ['anthropic/allowed', `${model.provider}/${model.id}  (current)`]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.authCalls.length, 0);
  h.available = h.available.filter((m: any) => m !== model && m !== allowed);
  await h.run('model');
  assert.equal(h.picks.length, 1);
  assert.match(h.notices.join(' '), /No authenticated models with low thinking support/);
});

test('invalid config blocks rewrites but picker can repair it without making requests', async (t) => {
  const h = await harness(t);
  await mkdir(dirname(h.settingsPath), { recursive: true });
  await writeFile(h.settingsPath, '{PRIVATE_INVALID_JSON');
  await h.run();
  assert.equal(h.calls.length, 0);
  assert.match(h.notices.join(' '), /settings file is invalid/);
  assert.doesNotMatch(h.notices.join(' '), /PRIVATE_/);
  h.select = async (_title: string, labels: string[]) => labels[0];
  await h.run('model');
  assert.equal(h.calls.length, 0);
  assert.equal(h.authCalls.length, 0);
  assert.deepEqual(await readModelChoice(h.settingsPath), DEFAULT_MODEL);
  await h.run();
  assert.equal(h.calls.length, 1);
});

test('missing saved model never falls back to Luna or the main agent model', async (t) => {
  const h = await harness(t);
  await saveModelChoice(h.settingsPath, { provider: 'missing-provider', modelId: 'missing-model' });
  await h.run();
  assert.deepEqual(h.findCalls, [['missing-provider', 'missing-model']]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.authCalls.length, 0);
  assert.match(h.notices.join(' '), /missing-provider\/missing-model is unavailable/);
  assert.equal(h.ctx.model, mainModel);
});

test('provider receives fresh resolved auth, headers, base URL and env with isolated low-thinking context', async (t) => {
  const h = await harness(t);
  h.authResult = { ok: true, apiKey: 'FAKE_REFRESHED_KEY', headers: { Authorization: 'FAKE', 'x-model': 'test' },
    baseUrl: 'https://provider.invalid/custom', env: { CUSTOM_PROVIDER_ENV: 'fake' } };
  await h.run();
  assert.deepEqual(h.providerCalls, [model.provider]);
  assert.deepEqual(h.authCalls, [model]);
  assert.equal(h.calls.length, 1);
  for (const [selected, context, options] of h.calls) {
    assert.deepEqual(selected, { ...model, baseUrl: h.authResult.baseUrl });
    assert.equal(options.apiKey, h.authResult.apiKey);
    assert.equal(options.headers, h.authResult.headers);
    assert.equal(options.env, h.authResult.env);
    assert.equal(options.reasoning, 'low');
    assert.equal('reasoningEffort' in options, false);
    assert.doesNotMatch(JSON.stringify(context), /FAKE|PRIVATE_/);
  }
  assert.equal(model.baseUrl, undefined, 'auth override must not mutate the catalog model');
  h.authResult = { ok: true, apiKey: 'FAKE_SECOND_KEY', headers: {}, env: {} };
  await h.run();
  assert.equal(h.authCalls.length, 2, 'resolve auth once for every invocation');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][2].apiKey, 'FAKE_SECOND_KEY');
  assert.notEqual(h.calls[0][1], h.calls[1][1]);
  assert.equal(new Set(h.calls.map((call: any[]) => call[2].sessionId)).size, 2);
});

test('cancellation while resolving auth prevents the provider request and releases the command', async (t) => {
  const h = await harness(t);
  const auth = deferred<any>();
  h.resolveAuth = () => auth.promise;
  const pending = h.run();
  await h.waitForAuth();
  h.loader.handleInput('\x1b');
  await pending;
  assert.equal(h.calls.length, 0);
  auth.resolve(h.authResult);
  await auth.promise;
  h.resolveAuth = async () => h.authResult;
  await h.run();
  assert.equal(h.calls.length, 1, 'only the new command reaches the provider');
  assert.equal(h.entries().length, 1);
});

test('failed auth or missing provider produces no request or credential disclosure', async (t) => {
  for (const failure of ['auth', 'provider', 'throw']) {
    const h = await harness(t);
    if (failure === 'auth') h.authResult = { ok: false, error: 'PRIVATE_AUTH_ERROR' };
    if (failure === 'provider') h.provider = undefined;
    if (failure === 'throw') h.resolveAuth = async () => { throw new Error('PRIVATE_REFRESH_ERROR'); };
    await h.run();
    assert.equal(h.calls.length, 0);
    assert.equal(h.entries().length, 0);
    assert.ok(h.notices.length > 0);
    assert.doesNotMatch(h.notices.join(' '), /PRIVATE_/);
  }
});

test('supported reasoning APIs receive provider-neutral low thinking', async (t) => {
  for (const api of ['openai-codex-responses', 'anthropic-messages', 'openai-responses', 'google-generative-ai']) {
    const h = await harness(t);
    h.rewriteModel = { ...model, api, thinkingLevelMap: { low: 'low' } };
    assert.equal(supportsLowThinking(h.rewriteModel), true);
    await h.run();
    assert.equal(h.calls.length, 1, api);
    assert.equal(h.calls[0][0].api, api);
    assert.equal(h.calls[0][2].reasoning, 'low');
    assert.equal('reasoningEffort' in h.calls[0][2], false);
  }
});

test('active reservation blocks overlapping invocations before async settings reads finish', async (t) => {
  const h = await harness(t);
  const pending = h.run();
  await h.run();
  assert.equal(h.calls.length, 0);
  await pending;
  assert.equal(h.calls.length, 1);
  assert.match(h.notices.join(' '), /Wait for the current request/);
  const cancelled = h.run();
  await h.emit('session_tree');
  await cancelled;
  assert.equal(h.calls.length, 1, 'lifecycle cancellation before settings resolve sends no request');
});

test('settings default only on ENOENT, reject invalid schema and replace files privately', async (t) => {
  const h = await harness(t, false);
  assert.deepEqual(await readModelChoice(h.settingsPath), DEFAULT_MODEL);
  await mkdir(dirname(h.settingsPath), { recursive: true });
  for (const contents of ['{', 'null', '[]', '{}', JSON.stringify({ version: 2, provider: 'x', modelId: 'y' }),
    JSON.stringify({ version: 1, provider: ' ', modelId: 'y' }),
    JSON.stringify({ version: 1, provider: 'x', modelId: 1 })]) {
    await writeFile(h.settingsPath, contents, { mode: 0o644 });
    await assert.rejects(readModelChoice(h.settingsPath), /settings file is invalid/);
  }
  await assert.rejects(readModelChoice(dirname(h.settingsPath)), /Could not read/);
  await saveModelChoice(h.settingsPath, DEFAULT_MODEL);
  assert.deepEqual(await readModelChoice(h.settingsPath), DEFAULT_MODEL);
  assert.equal((await stat(h.settingsPath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dirname(h.settingsPath)), ['settings.json']);
  const blockedPath = join(h.settingsPath, 'settings.json');
  await assert.rejects(saveModelChoice(blockedPath, DEFAULT_MODEL), /Could not save/);
  assert.deepEqual(await readModelChoice(h.settingsPath), DEFAULT_MODEL);
});

test('all six built-in styles use one isolated raw-source call with style metadata', async (t) => {
  assert.equal(POLICY_VERSION, 10);
  assert.equal(POLICY_VERSION, REWRITE_POLICY_VERSION);
  for (const style of STYLE_IDS) {
    await t.test(style, async (t) => {
      const h = await harness(t);
      const before = structuredClone(h.sm.buildSessionContext().messages);
      await h.run(style);
      assert.equal(h.calls.length, 1);
      const [selected, context, options] = h.calls[0];
      const target = requestTarget(context);
      const expected = buildStyleRequest(target, style, BUILTIN_CATALOG);
      assert.equal(context.systemPrompt, expected.system);
      assert.equal(context.messages[0].content, expected.user);
      assert.equal(context.messages.length, 1);
      assert.deepEqual(context.tools, []);
      assert.deepEqual(selected, model);
      assert.equal(options.reasoning, 'low');
      assert.equal(options.cacheRetention, 'none');
      assert.notEqual(options.sessionId, h.sm.getSessionId());
      assert.equal(target, answer().content[0].text);
      assert.doesNotMatch(JSON.stringify(context), /PRIVATE_/);
      if (style === 'slye') assert.ok(context.messages[0].content.startsWith('Context:\n\n\nTarget:\n'));
      const entry = h.entries()[0];
      assert.equal(entry.data.style, style);
      assert.equal(entry.data.version, POLICY_VERSION);
      assert.equal(entry.data.sourceEntryId, latestAnswer(h.sm.getBranch())!.id);
      assert.equal(entry.data.text, rewrittenMock(answer().content[0].text));
      assert.ok(h.rendered[0].includes(style === 'plain' ? 'Plain English' : STYLES[style].name));
      assert.ok(h.loaderFrames[0].includes(STYLES[style].name));
      assert.deepEqual(h.sm.buildSessionContext().messages, before);
      assert.deepEqual(reload(h.sm).buildSessionContext().messages, before);
      await assert.rejects(stat(h.stylePath), { code: 'ENOENT' });
      await assert.rejects(stat(h.settingsPath), { code: 'ENOENT' });
    });
  }
});

test('SLYE publishes transformed source facts unchanged but still discards cancelled results', async (t) => {
  const h = await harness(t);
  const before = structuredClone(h.sm.buildSessionContext().messages);
  const output = 'Use `settings.yaml` instead. Wait 99 minutes. See https://new.test/help.';
  h.complete = async (_m: any, context: any) => {
    assert.equal(requestTarget(context), answer().content[0].text);
    return answer(output);
  };
  await h.run('slye');
  assert.equal(h.calls.length, 1);
  assert.equal(h.entries().length, 1);
  assert.equal(h.entries()[0].data.text, output);
  assert.deepEqual(h.sm.buildSessionContext().messages, before);
  const late = deferred<any>();
  h.complete = () => late.promise;
  const pending = h.run('slye');
  await h.waitForCall(1);
  h.loader.handleInput('\x1b');
  await pending;
  assert.equal(h.calls[1][2].signal.aborted, true);
  late.resolve(answer(output));
  await h.results[1];
  assert.equal(h.calls.length, 2);
  assert.equal(h.entries().length, 1);
  assert.deepEqual(h.sm.buildSessionContext().messages, before);
});

test('style picker saves each built-in without an answer, auth, provider or rewrite call', async (t) => {
  for (const style of STYLE_IDS) {
    const h = await harness(t, false);
    h.auth = false;
    h.available = [];
    h.select = async (_title: string, labels: string[]) => labels.find((label) => label.includes(`(${style})`));
    await h.run('style');
    assert.equal(h.picks[0][1].length, 6);
    for (const id of STYLE_IDS) assert.ok(h.picks[0][1].some((label: string) => label.includes(STYLES[id].name)));
    assert.deepEqual(JSON.parse(await readFile(h.stylePath, 'utf8')), { version: 1, style });
    assert.equal((await stat(h.stylePath)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(h.stylePath))).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(dirname(h.stylePath)), ['style.json']);
    assert.equal(h.calls.length + h.authCalls.length + h.providerCalls.length + h.entries().length, 0);
    assert.equal(h.ctx.model, mainModel);
    const fresh = await harness(t, true, h.agentDir);
    await fresh.run();
    assert.equal(fresh.entries()[0].data.style, style);
  }
});

test('model and style preferences never overwrite each other; one-off styles never persist', async (t) => {
  const h = await harness(t);
  await saveModelChoice(h.settingsPath, DEFAULT_MODEL);
  const modelBefore = await readFile(h.settingsPath, 'utf8');
  h.select = async (_title: string, labels: string[]) => labels.find((label) => label.includes('(terse)'));
  await h.run('style');
  assert.equal(await readFile(h.settingsPath, 'utf8'), modelBefore);
  const styleBefore = await readFile(h.stylePath, 'utf8');
  h.select = async (_title: string, labels: string[]) => labels[0];
  await h.run('model');
  assert.equal(await readFile(h.stylePath, 'utf8'), styleBefore);
  for (const style of STYLE_IDS) {
    await h.run(style);
    assert.equal(h.entries().at(-1).data.style, style);
    assert.equal(await readFile(h.stylePath, 'utf8'), styleBefore);
    assert.equal(await readFile(h.settingsPath, 'utf8'), modelBefore);
  }
  await h.run();
  assert.equal(h.entries().at(-1).data.style, 'terse');
});

test('style cancellation, unknown selections and stale pickers cannot save', async (t) => {
  for (const event of ['cancel', 'unknown', 'session_shutdown', 'session_tree', 'agent_start', 'session', 'branch', 'busy']) {
    const h = await harness(t, false);
    await saveStyleChoice(h.stylePath, 'slye');
    const before = await readFile(h.stylePath, 'utf8');
    const opened = deferred();
    const selected = deferred<string | undefined>();
    h.select = () => { opened.resolve(); return selected.promise; };
    const pending = h.run('style');
    await opened.promise;
    assert.ok(h.picks[0][1].some((label: string) => label.includes('(slye)  (current)')));
    await h.run('model');
    await h.run('slye');
    assert.equal(h.picks.length, 1);
    assert.match(h.notices.join(' '), /Wait for the current request/);
    if (event.startsWith('session_') || event === 'agent_start') await h.emit(event);
    if (event === 'session') h.ctx.sessionManager = SessionManager.inMemory(cwd);
    if (event === 'branch') h.sm.appendMessage(answer());
    if (event === 'busy') h.idle = false;
    selected.resolve(event === 'cancel' ? undefined : event === 'unknown' ? 'not-a-style' : h.picks[0][1][0]);
    await pending;
    assert.equal(await readFile(h.stylePath, 'utf8'), before, event);
    assert.equal(h.calls.length + h.authCalls.length + h.entries().length, 0);
  }
  const h = await harness(t, false);
  await h.run('style');
  await assert.rejects(stat(h.stylePath), { code: 'ENOENT' });
});

test('invalid style settings fail closed, but style picker repairs them without model access', async (t) => {
  const h = await harness(t);
  await mkdir(dirname(h.stylePath), { recursive: true });
  await saveModelChoice(h.settingsPath, DEFAULT_MODEL);
  const modelBefore = await readFile(h.settingsPath, 'utf8');
  for (const value of ['{PRIVATE_INVALID', 'null', '[]', '{}', '{"version":2,"style":"plain"}',
    '{"version":1,"style":"PRIVATE_UNKNOWN"}', '{"version":1,"style":42}', '{"version":1,"style":" plain "}']) {
    await writeFile(h.stylePath, value);
    await h.run();
    assert.equal(h.calls.length + h.authCalls.length, 0);
    assert.equal(await readFile(h.stylePath, 'utf8'), value);
    await assert.rejects(readStyleChoice(h.stylePath), /style settings file is invalid/);
  }
  assert.match(h.notices.join(' '), /Run \/declaw style/);
  assert.doesNotMatch(h.notices.join(' '), /PRIVATE_/);
  h.select = async (_title: string, labels: string[]) => labels.find((label) => label.includes('(slye)'));
  await h.run('style');
  assert.equal(await readStyleChoice(h.stylePath), 'slye');
  assert.equal(await readFile(h.settingsPath, 'utf8'), modelBefore);
  assert.equal(h.calls.length + h.authCalls.length, 0);
  await h.run();
  assert.equal(h.entries()[0].data.style, 'slye');
});

test('style picker reports a real filesystem save failure safely and can save after repair', async (t) => {
  const h = await harness(t, false);
  await mkdir(h.stylePath, { recursive: true });
  const markerPath = join(h.stylePath, 'PRIVATE_EXISTING_FILE');
  await writeFile(markerPath, 'PRIVATE_EXISTING_CONTENT');
  h.select = async (_title: string, labels: string[]) => labels.find((label) => label.includes('(terse)'));
  await h.run('style');
  assert.deepEqual(h.notices, ['Could not save the /declaw style choice. Check the permissions on its settings directory.']);
  assert.equal(h.calls.length + h.authCalls.length + h.entries().length, 0);
  assert.equal(await readFile(markerPath, 'utf8'), 'PRIVATE_EXISTING_CONTENT');
  assert.deepEqual(await readdir(dirname(h.stylePath)), ['style.json'], 'failed atomic save removes its temporary file');
  await rm(h.stylePath, { recursive: true });
  await h.run('style');
  assert.equal(await readStyleChoice(h.stylePath), 'terse');
  assert.equal(h.picks.length, 2);
  assert.match(h.notices.at(-1), /now uses Terse/);
  assert.equal(h.calls.length + h.authCalls.length + h.entries().length, 0);
});

test('style file defaults only when missing and failed saves preserve the valid preference', async (t) => {
  const h = await harness(t, false);
  assert.equal(await readStyleChoice(h.stylePath), DEFAULT_STYLE_ID);
  await saveStyleChoice(h.stylePath, 'adhd');
  await assert.rejects(readStyleChoice(dirname(h.stylePath)), /Could not read/);
  await assert.rejects(saveStyleChoice(h.stylePath, 'unknown' as any), /Unknown/);
  await assert.rejects(saveStyleChoice(join(h.stylePath, 'style.json'), 'plain'), /Could not save/);
  assert.equal(await readStyleChoice(h.stylePath), 'adhd');
  assert.deepEqual(await readdir(dirname(h.stylePath)), ['style.json']);
});

test('declaw alias lists plugins and manage persists disabled status', async (t) => {
  const h = await harness(t, false);
  const declaw = h.ext.commands.get('declaw');
  assert.ok(declaw, 'Declaw command alias is registered');
  await declaw.handler('list', h.ctx);
  assert.match(h.notices.at(-1), /Paseo Plain \[builtin\/plain\] · active/);
  h.select = async (_title: string, labels: string[]) => labels.find((label) => label.includes('(builtin/plain)'));
  await declaw.handler('manage', h.ctx);
  assert.match(h.notices.at(-1), /Paseo Plain is now disabled/);
  assert.deepEqual(JSON.parse(await readFile(join(h.agentDir, 'declaw', 'plugins.json'), 'utf8')), {
    version: 1, plugins: { 'builtin/plain': 'disabled' },
  });
  await declaw.handler('style', h.ctx);
  assert.doesNotMatch(h.picks.at(-1)[1].join(' '), /Paseo Plain/);
});

test('plugin management can repair an invalid plugin status file', async (t) => {
  const h = await harness(t, false);
  await mkdir(dirname(join(h.agentDir, 'declaw', 'plugins.json')), { recursive: true });
  await writeFile(join(h.agentDir, 'declaw', 'plugins.json'), '{PRIVATE_INVALID');
  await h.run();
  assert.deepEqual(h.notices, ['The /declaw plugin settings file is invalid. Run /declaw manage to repair it.']);
  assert.equal(h.calls.length + h.authCalls.length + h.entries().length, 0);
  h.select = async (_title: string, labels: string[]) => labels.find((label) => label.includes('(builtin/plain)'));
  await h.ext.commands.get('declaw').handler('manage', h.ctx);
  assert.deepEqual(JSON.parse(await readFile(join(h.agentDir, 'declaw', 'plugins.json'), 'utf8')), {
    version: 1, plugins: { 'builtin/plain': 'disabled' },
  });
});

test('legacy entries retain Plain English rendering and completions expose all native styles', async (t) => {
  const h = await harness(t, false);
  const renderer = h.ext.entryRenderers.get(ENTRY_TYPE);
  for (const version of [1, 2, 3]) {
    const rendered = renderer({ data: { version, text: 'Old rewrite.', sourceEntryId: 'old', model: 'old/model' } }, {}, theme).render(100).join('\n');
    assert.match(rendered, /Plain English/);
    assert.match(rendered, /Old rewrite/);
    assert.match(rendered, /display only/);
  }
  const complete = h.ext.commands.get('declaw').getArgumentCompletions;
  assert.deepEqual(complete('').map((item: any) => item.value), ['model', 'style', 'list', 'manage', ...STYLE_IDS]);
  assert.deepEqual(complete('sl').map((item: any) => item.value), ['slye']);
  assert.equal(complete('unknown'), null);
});

test('a custom plugin owns technical additions, omissions and changes; completed output is published verbatim', async (t) => {
  t.after(clearDeclawPluginBridgeForTests);
  const source = '\nUse `config.json` in /old/path with 25 seconds.\r\n' +
    'Read [guide](https://old.test/docs), then run `npm test`.\r\n' +
    'The old system does not support retries. Literal ⟦KEEP_source_0⟧.\n';
  const instructions = 'Transform this tutorial for a different system. Add new commands and examples, ' +
    'omit obsolete details, and change paths, numbers, links and claims as needed. ' +
    'These transformation instructions control over default reading guidance.';
  const received: string[] = [];
  registerDeclawPlugin({
    apiVersion: 1, id: 'technical-transform', name: 'Technical transformations', version: '1.0.0',
    styles: [{
      id: 'technical-transform/tutorial', name: 'New-system tutorial', relationship: 'Local preset', instructions,
      buildUserPayload: (raw) => { received.push(raw); return JSON.stringify({ tutorial: raw }); },
    }],
  });
  const outputs = {
    additions: source + '\nRun `pnpm build` with 99 workers; see https://new.test/setup.\n```sh\necho new\n```',
    omissions: 'Use the new system.',
    changes: '\n  Use `settings.yaml` in /new/path with 5 minutes.\r\nThe system supports retries.\n',
    'ordinary-token-like-text': '⟦KEEP_new_0⟧ ⟦KEEP_source_0⟧ ⟦KEEP_source_0⟧ and ⟦KEPT_changed⟧',
  };
  for (const [transformation, output] of Object.entries(outputs)) {
    await t.test(transformation, async (t) => {
      const h = await harness(t);
      const sourceId = h.sm.appendMessage(answer(source));
      const before = structuredClone(h.sm.buildSessionContext().messages);
      h.complete = async (_m: any, context: any) => {
        assert.equal(h.entries().length, 0);
        assert.deepEqual(JSON.parse(context.messages[0].content), { tutorial: source });
        assert.equal(context.messages.length, 1);
        assert.deepEqual(context.tools, []);
        assert.doesNotMatch(JSON.stringify(context), /PRIVATE_/);
        assert.ok(context.systemPrompt.includes(DEFAULT_REWRITE_GUIDANCE));
        assert.ok(context.systemPrompt.indexOf(DEFAULT_REWRITE_GUIDANCE) < context.systemPrompt.indexOf(instructions));
        return answer(output);
      };
      await h.run('technical-transform/tutorial');
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0][2].maxRetries, 0);
      assert.equal(h.entries().length, 1);
      assert.equal(h.entries()[0].data.text, output, 'no host editing, trimming or literal restoration');
      assert.equal(h.entries()[0].data.sourceEntryId, sourceId);
      assert.equal(h.entries()[0].data.style, 'technical-transform/tutorial');
      assert.equal(h.entries()[0].data.stylePlugin, 'technical-transform');
      assert.match(h.rendered[0], /New-system tutorial/);
      assert.deepEqual(latestAnswer(h.sm.getBranch()), { id: sourceId, text: source });
      assert.deepEqual(h.sm.buildSessionContext().messages, before);
      assert.deepEqual(reload(h.sm).buildSessionContext().messages, before);
    });
  }
  assert.deepEqual(received, Object.values(outputs).map(() => source));
});
