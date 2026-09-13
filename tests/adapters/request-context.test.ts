import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedRequest } from '../../src/adapters/pi.ts';
import { StyleCatalog, buildStyleRequest } from '../../src/domain/styles.ts';
import { BUILTIN_CATALOG } from '../../src/plugins/built-in/catalog.ts';

const model = {id:'fixture',provider:'fixture',api:'openai-responses',maxTokens:32000,reasoning:true} as any;
test('diagnostic request builder uses default style and caps output independently of model context', () => {
  const source='Original `file.json` with 12 items.',signal=new AbortController().signal;
  const first=isolatedRequest(source,model,signal),second=isolatedRequest(source,model,signal);
  const expected=buildStyleRequest(source,undefined,BUILTIN_CATALOG);
  assert.equal(first.context.systemPrompt,expected.system);
  assert.equal(first.context.messages[0].content,expected.user);
  assert.equal(first.options.maxTokens,16384);
  assert.equal(first.options.signal,signal);
  assert.equal(first.options.maxRetries,0);
  assert.deepEqual(first.context.tools,[]);
  assert.notEqual(first.options.sessionId,second.options.sessionId);
});
test('diagnostic request builder honors custom catalog and rejects unavailable style before constructing a request', () => {
  const catalog=new StyleCatalog([{apiVersion:1,id:'fixture',name:'Fixture',version:'1',styles:[{
    id:'fixture/custom',name:'Custom',relationship:'Local preset',instructions:'Write a fictional dialogue.',buildUserPayload:source=>`RAW:${source}`,
  }]}]);
  const signal=new AbortController().signal;
  const {context}=isolatedRequest('source',model,signal,'fixture/custom',catalog);
  assert.equal(context.messages[0].content,'RAW:source');
  assert.ok(context.systemPrompt.endsWith('Write a fictional dialogue.'));
  catalog.setPluginStatus('fixture','disabled');
  assert.throws(()=>isolatedRequest('source',model,signal,'fixture/custom',catalog),/Unknown or disabled/);
});
