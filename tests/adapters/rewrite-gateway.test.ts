import test from "node:test";
import assert from "node:assert/strict";
import { createRewriteGateway, completeRewrite } from "../../src/adapters/model.ts";
import { buildRewriteRequest, type StyleRecord } from "../../src/domain/styles.ts";
import { BUILTIN_CATALOG } from "../../src/plugins/built-in/catalog.ts";

const model = { id: "chosen-model", provider: "chosen-provider", api: "openai-responses", maxTokens: 8192, reasoning: true } as any;
const message = (text: string, extra = {}) => ({
  role: "assistant", content: [{ type: "text", text }], stopReason: "stop", ...extra,
} as any);
function registryHarness() {
  const calls: any[] = [], authModels: any[] = [], providerIds: string[] = [];
  const h = {
    calls, authModels, providerIds,
    available: true,
    response: () => message("A valid reading."),
    resolveAuth: async (_model: any) => ({ ok: true, apiKey: "FAKE_KEY", headers: {}, env: {} } as any),
  };
  const registry: any = {
    getProvider(id: string) {
      providerIds.push(id);
      return h.available ? { streamSimple: (...args: any[]) => {
        calls.push(args); return { result: async () => h.response() };
      } } : undefined;
    },
    getApiKeyAndHeaders(selected: any) { authModels.push(selected); return h.resolveAuth(selected); },
  };
  return { h, registry };
}

function styleFixture(): StyleRecord {
  const record = BUILTIN_CATALOG.get("plain")!;
  return { ...record, style: { ...record.style } };
}

test("gateway exposes one rewrite port with frozen selection, fresh auth and isolated contexts", async () => {
  const { h, registry } = registryHarness();
  const selectedModel = { ...model }, style = styleFixture(), initialStyle = { ...style.style };
  let authCount = 0;
  h.resolveAuth = async () => {
    authCount++;
    return { ok: true, apiKey: `FAKE_KEY_${authCount}`, baseUrl: `https://example.invalid/${authCount}`,
      headers: { "x-request": `${authCount}` }, env: { FAKE_REQUEST: `${authCount}` } };
  };
  const gateway = createRewriteGateway(registry, selectedModel, style);
  assert.deepEqual(Object.keys(gateway), ["rewrite"]);
  selectedModel.id = "different-model";
  style.style.instructions = "Different style instructions";
  style.style.name = "Different name";
  style.style.buildUserPayload = () => "Changed formatter";
  const signal = new AbortController().signal;
  const source = "Use `config.json` with 99 ⟦KEEP_native⟧.\r\n";
  assert.equal(await gateway.rewrite(source, signal), "A valid reading.");
  assert.equal(h.calls.length, 1); assert.equal(h.authModels.length, 1);
  assert.equal(await gateway.rewrite(source, signal), "A valid reading.");
  assert.equal(h.calls.length, 2); assert.equal(h.authModels.length, 2);
  assert.ok(h.authModels.every(m => m.id === model.id && Object.isFrozen(m)));
  const expected = buildRewriteRequest(source, initialStyle);
  h.calls.forEach(([sentModel, context, options], index) => {
    assert.equal(sentModel.id, model.id);
    assert.equal(sentModel.baseUrl, `https://example.invalid/${index + 1}`);
    assert.equal(context.systemPrompt, expected.system);
    assert.equal(context.messages.length, 1);
    assert.equal(context.messages[0].role, "user");
    assert.equal(context.messages[0].content, expected.user);
    assert.deepEqual(context.tools, []);
    assert.equal(options.reasoning, "low"); assert.equal(options.maxRetries, 0);
    assert.equal(options.signal, signal); assert.equal(options.cacheRetention, "none");
    assert.equal(options.timeoutMs, 60_000); assert.equal(options.maxTokens, model.maxTokens);
    assert.equal(options.apiKey, `FAKE_KEY_${index + 1}`);
    assert.deepEqual(options.headers, { "x-request": `${index + 1}` });
    assert.deepEqual(options.env, { FAKE_REQUEST: `${index + 1}` });
  });
  assert.notEqual(h.calls[0][2].sessionId, h.calls[1][2].sessionId);
  assert.notEqual(h.calls[0][1], h.calls[1][1]);
});

test("custom plugin owns its formatter, receives raw source and can return invented content", async () => {
  const { h, registry } = registryHarness();
  const sources: string[] = [];
  const style = styleFixture();
  style.style.instructions = "Invent new technical details and omit the source conclusion.";
  style.style.buildUserPayload = source => { sources.push(source); return `CUSTOM\n${source}`; };
  const gateway = createRewriteGateway(registry, model, style);
  const signal = new AbortController().signal;
  const source = ' \r\nUse `original.json` for 5 minutes. "Quote" ⟦KEEP_native⟧\t ';
  h.response = () => message("Invented `new.json` with 99 dragons.");
  assert.equal(await gateway.rewrite(source, signal), "Invented `new.json` with 99 dragons.");
  assert.deepEqual(sources, [source]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1].messages[0].content, `CUSTOM\n${source}`);
});

test("unavailable providers, failed auth and cancellation cannot make provider calls", async () => {
  const { h, registry } = registryHarness();
  const gateway = createRewriteGateway(registry, model, styleFixture());
  const controller = new AbortController();
  h.available = false;
  await assert.rejects(gateway.rewrite("source", controller.signal), /provider is unavailable/);
  assert.equal(h.authModels.length, 0);
  h.available = true;
  h.resolveAuth = async () => ({ ok: false, error: "PRIVATE_AUTH_PAYLOAD" });
  await assert.rejects(gateway.rewrite("source", controller.signal), error =>
    error instanceof Error && /Authentication/.test(error.message) && !error.message.includes("PRIVATE_AUTH"));
  h.resolveAuth = async () => { controller.abort(); return { ok: true, apiKey: "FAKE_KEY", headers: {}, env: {} }; };
  await assert.rejects(gateway.rewrite("source", controller.signal));
  await assert.rejects(gateway.rewrite("source", controller.signal));
  assert.deepEqual(h.calls, []);
});

test("gateway rejects incomplete Pi messages using operational completion checks", async () => {
  const { h, registry } = registryHarness();
  const gateway = createRewriteGateway(registry, model, styleFixture());
  const signal = new AbortController().signal;
  for (const invalid of [message(" "), message("text", { stopReason: "length" }), message("text", { errorMessage: "PRIVATE_PAYLOAD" }),
    message("text", { stopReason: "aborted" }), message("text", { content: [{ type: "toolCall", name: "bash" }] })]) {
    h.response = () => invalid;
    const before = h.calls.length;
    await assert.rejects(gateway.rewrite("source", signal), /did not return complete text/);
    assert.equal(h.calls.length, before + 1, "No retries or review calls");
  }
  h.response = () => message("", { content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "First" }, { type: "text", text: "Second" }] });
  assert.equal(await gateway.rewrite("source", signal), "First\n\nSecond");
});

test("diagnostic completeRewrite remains a single call using the selected catalog payload", async () => {
  const { h, registry } = registryHarness();
  const signal = new AbortController().signal;
  assert.equal((await completeRewrite(registry, model, "source", signal)).stopReason, "stop");
  assert.equal(h.calls.length, 1);
  await completeRewrite(registry, model, "source", signal, "slye", BUILTIN_CATALOG);
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.parse(h.calls[0][1].messages[0].content).assistantMessage, "source");
  assert.equal(h.calls[1][1].messages[0].content, "Context:\n\n\nTarget:\nsource");
});
