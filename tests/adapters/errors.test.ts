import test from 'node:test';
import assert from 'node:assert/strict';
import { PlainError, rewriteFailureMessage } from '../../src/adapters/errors.ts';
import type { RewriteExecutionResult } from '../../src/application/rewrite.ts';

test('each failed or rejected outcome maps to a useful UI-safe explanation', () => {
  const cases: Array<[Extract<RewriteExecutionResult, {kind:'failed'|'rejected'}>, RegExp]> = [
    [{kind:'failed'}, /request failed.*\/login.*original is unchanged/i],
    [{kind:'rejected',reason:'empty-source'}, /No completed assistant answer/],
    [{kind:'rejected',reason:'source-too-long'}, /32,000 characters maximum/],
    [{kind:'rejected',reason:'invalid-output'}, /64,000 characters maximum.*original is unchanged/i],
    [{kind:'rejected',reason:'unchanged'}, /no duplicate was added/],
  ];
  for (const [outcome, message] of cases) assert.match(rewriteFailureMessage(outcome), message);
  const safe = new PlainError('The selected provider is unavailable.');
  assert.ok(safe instanceof Error);
  assert.equal(safe.message, 'The selected provider is unavailable.');
});
