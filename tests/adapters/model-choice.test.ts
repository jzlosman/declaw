import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chooseModel } from '../../src/adapters/model.ts';

const available = [
  {provider:'z',id:'last',reasoning:true},
  {provider:'a',id:'first',reasoning:true},
  {provider:'a',id:'unsupported',reasoning:false},
  {provider:'a',id:'unauthenticated',reasoning:true},
] as any[];
async function fixture(t: any) {
  const dir=await mkdtemp(join(tmpdir(),'declaw-model-choice-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'model.json');
  const notices:any[]=[];
  const ctx:any={modelRegistry:{getAvailable:()=>available,hasConfiguredAuth:(m:any)=>m.id!=='unauthenticated'},ui:{
    notify:(...args:any[])=>notices.push(args),select:async()=>undefined,
  }};
  return {ctx,path,notices};
}
test('model picker filters and sorts available choices, marks current choice, and saves selection', async t=>{
  const {ctx,path,notices}=await fixture(t);
  await writeFile(path,JSON.stringify({version:1,provider:'z',modelId:'last'}));
  const signal=new AbortController().signal;
  ctx.ui.select=async (_title:string,labels:string[],options:any)=>{
    assert.deepEqual(labels,['a/first','z/last  (current)']);assert.equal(options.signal,signal);return labels[0];
  };
  await chooseModel(ctx,path,signal);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{version:1,provider:'a',modelId:'first'});
  assert.match(notices[0][0],/a\/first.*Main agent settings are unchanged/);
});
test('model picker can repair invalid preferences without inventing a current choice', async t=>{
  const {ctx,path}=await fixture(t);await writeFile(path,'not json');
  ctx.ui.select=async (_title:string,labels:string[])=>{assert.deepEqual(labels,['a/first','z/last']);return labels[1]};
  await chooseModel(ctx,path,new AbortController().signal);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{version:1,provider:'z',modelId:'last'});
});
test('no eligible models, pre-cancellation, dismissal and stale selection never save preferences', async t=>{
  const {ctx,path,notices}=await fixture(t);
  const original=JSON.stringify({version:1,provider:'a',modelId:'first'});await writeFile(path,original);
  const getAvailable=ctx.modelRegistry.getAvailable;
  ctx.modelRegistry.getAvailable=()=>[];
  ctx.ui.select=async()=>{assert.fail('No picker should open')};
  await chooseModel(ctx,path,new AbortController().signal);
  assert.match(notices[0][0],/No authenticated models/);
  ctx.modelRegistry.getAvailable=getAvailable;
  const cancelled=new AbortController();cancelled.abort();await chooseModel(ctx,path,cancelled.signal);
  for(const selection of [undefined,'not-an-offered-model']){
    ctx.ui.select=async()=>selection;await chooseModel(ctx,path,new AbortController().signal);
  }
  const duringSelection=new AbortController();
  ctx.ui.select=async()=>{duringSelection.abort();return 'z/last'};
  await chooseModel(ctx,path,duringSelection.signal);
  assert.equal(await readFile(path,'utf8'),original);
  assert.equal(notices.length,1,'No successful-save notice on cancellation or invalid selection');
});
