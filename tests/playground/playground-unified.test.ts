import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderComparison } from '../../playground/markdown.ts';
import { renderUnifiedDiff } from '../../playground/unified.ts';
import { mergeInlineBlocks } from '../../playground/inline-diff.ts';

function compare(before: string, after: string) {
  const pair = renderComparison(before, after);
  return renderUnifiedDiff(pair.beforeHtml, pair.afterHtml);
}
const count = (html: string, text: string) => html.split(text).length - 1;
const plainText = (html: string) => html.replace(/<[^>]+>/g, '');
function structure(html: string) {
  const stack: string[] = [];
  for (const [, close, tag] of html.matchAll(/<(\/?)([a-z][a-z0-9]*)[^>]*>/g)) {
    if (close) assert.equal(stack.pop(), tag);
    else {
      if (tag === 'li') assert.match(stack.at(-1) ?? '', /^(ol|ul)$/);
      if (tag === 'td' || tag === 'th') assert.equal(stack.at(-1), 'tr');
      stack.push(tag);
    }
  }
  assert.deepEqual(stack, []);
}

test('the reported recovery sentence has one copy with inline replacements', () => {
  const result = compare('Successful process startup is not sufficient evidence of recovery.', 'Successful process startup does not prove recovery.');
  assert.equal(result.visibleChanged, true);
  assert.equal(count(result.unifiedHtml, '<p>'), 1);
  assert.equal(count(result.unifiedHtml, 'Successful process startup'), 1);
  assert.match(result.unifiedHtml, /<del class="change">is<\/del><span class="diff-gap"> <\/span><ins class="change">does<\/ins> not /);
  assert.match(result.unifiedHtml, /<del class="change">sufficient evidence of<\/del><span class="diff-gap"> <\/span><ins class="change">prove<\/ins> recovery\./);
  assert.doesNotMatch(result.unifiedHtml, /diff-sign|data-kind="remove"|data-kind="add"/);
  structure(result.unifiedHtml);
});
test('common wording appears once and adjacent replacements are not glued', () => {
  const { unifiedHtml } = compare('Those checks passed. Still local.', 'These checks passed. Still local.');
  assert.equal(count(unifiedHtml, 'checks passed. Still local.'), 1);
  assert.match(plainText(unifiedHtml), /Those These checks passed/);
  assert.doesNotMatch(plainText(unifiedHtml), /ThoseThese/);
});
test('projecting either side of an inline sentence reconstructs its wording', () => {
  function project(html: string, side: 'before' | 'after') {
    const omit = side === 'before' ? 'ins' : 'del';
    return plainText(html.replace(/<span class="diff-gap"> <\/span>/g, '')
      .replace(new RegExp(`<${omit} class="change">[\\s\\S]*?<\\/${omit}>`, 'g'), ''));
  }
  const pairs = [
    ['Successful process startup is not sufficient evidence of recovery.', 'Successful process startup does not prove recovery.'],
    ['alpha beta gamma delta', 'beta new gamma'],
    ['a a b a b', 'b a a a c'],
    ['Stop here rather than continue.', 'Stop rather than continue.'],
    ['Record the count shown by status. If copying fails, stop.', 'Record the count from status.'],
    ['😀 café old wording.', '😀 café more natural wording.'],
  ];
  for (const [before, after] of pairs) {
    const result = compare(before, after);
    assert.equal(project(result.unifiedHtml, 'before'), before);
    assert.equal(project(result.unifiedHtml, 'after'), after);
  }
});

test('unchanged and blank-line-only pairs remain one clean reading', () => {
  for (const [a, b] of [['same', 'same'], ['## Heading\nText.', '## Heading\n\nText.'], ['', '']]) {
    const result = compare(a, b);
    assert.equal(result.visibleChanged, false);
    assert.doesNotMatch(result.unifiedHtml, /<del|<ins/);
  }
});
test('list item wording changes inline without duplicating steps or nested lists', () => {
  const before = '7. First\n8. Save old inputs:\n   - Copy `checkpoint.json`.\n   - Keep intake paused.\n9. Last';
  const result = compare(before, before.replace('old', 'new'));
  assert.equal(count(result.unifiedHtml, '<ol start="8">'), 1);
  assert.equal(count(result.unifiedHtml, 'checkpoint.json'), 1);
  assert.equal(count(result.unifiedHtml, 'Keep intake paused.'), 1);
  assert.match(result.unifiedHtml, /<del class="change">old<\/del>.*<ins class="change">new<\/ins>/);
  structure(result.unifiedHtml);
});
test('nested wording and a moved condition do not duplicate the entire procedure item', () => {
  const before = '1. Save inputs:\n   - Record the count shown by `status`. If copying fails, stop.\n2. Finish.';
  const after = '1. Save inputs:\n   - Record the count from `status`.\n\n   If copying fails, stop.\n2. Finish.';
  const result = compare(before, after);
  assert.equal(count(result.unifiedHtml, 'Save inputs:'), 1);
  assert.equal(count(result.unifiedHtml, '<ol start="1">'), 1);
  assert.equal(count(result.unifiedHtml, 'status'), 1);
  assert.match(result.unifiedHtml, /<del class="change">shown by<\/del>/);
  assert.match(result.unifiedHtml, /<ins class="change">from<\/ins>/);
  structure(result.unifiedHtml);
});
test('table cells merge inline in one table', () => {
  const before = '| Concern | Result |\n| --- | --- |\n| Timing | Usually ready |';
  const result = compare(before, before.replace('Usually', 'Always'));
  assert.equal(count(result.unifiedHtml, '<table>'), 1);
  assert.equal(count(result.unifiedHtml, 'Concern'), 1);
  assert.match(result.unifiedHtml, /<td><del class="change">Usually<\/del>.*<ins class="change">Always<\/ins> ready<\/td>/);
  structure(result.unifiedHtml);
});
test('inline formatting and code remain valid and escaped', () => {
  const result = compare('Use **old wording** and `a < b`.', 'Use **new wording** and `a <= b`.');
  assert.equal(count(result.unifiedHtml, '<p>'), 1);
  assert.match(result.unifiedHtml, /<strong><del class="change">old<\/del><\/strong>/);
  assert.match(result.unifiedHtml, /<code><ins class="change">=<\/ins><\/code>/);
  assert.ok(result.unifiedHtml.includes('&lt;'));
  structure(result.unifiedHtml);
});
test('fenced code is merged inside one pre, retaining line breaks', () => {
  const result = compare('```js\nconst x = 1;\nrun(x);\n```', '```js\nconst x = 2;\nrun(x);\n```');
  assert.equal(count(result.unifiedHtml, '<pre>'), 1);
  assert.equal(count(result.unifiedHtml, 'run(x);'), 1);
  assert.match(result.unifiedHtml, /<del class="change">1<\/del>/);
  assert.match(result.unifiedHtml, /<ins class="change">2<\/ins>/);
  assert.ok(plainText(result.unifiedHtml).includes('\nrun(x);\n'));
  structure(result.unifiedHtml);
});
test('removed headings do not shift inline paragraph pairing', () => {
  const result = compare('## Heading\n\nOld first.\n\nOld second.', 'New first.\n\nNew second.');
  assert.equal(count(result.unifiedHtml, '<p>'), 2);
  assert.match(result.unifiedHtml, /<h2><del class="change">Heading<\/del><\/h2>/);
  assert.equal(count(result.unifiedHtml, ' first.'), 1);
  assert.equal(count(result.unifiedHtml, ' second.'), 1);
});
test('pure additions, removals and formatting changes remain visible', () => {
  assert.match(compare('', 'Added').unifiedHtml, /<ins class="change">Added<\/ins>/);
  assert.match(compare('Removed', '').unifiedHtml, /<del class="change">Removed<\/del>/);
  const result = compare('**same**', '*same*');
  assert.equal(count(result.unifiedHtml, '<p>'), 1);
  assert.match(result.unifiedHtml, /<strong><del class="change">same<\/del><\/strong>/);
  assert.match(result.unifiedHtml, /<em><ins class="change">same<\/ins><\/em>/);
});
test('hostile source remains inert and raw unsafe HTML is rejected', () => {
  const result = compare('Keep <script>alert("a")</script> & x.', 'Keep <script>alert("b")</script> & x.');
  assert.doesNotMatch(result.unifiedHtml, /<script|<img|onerror=/);
  assert.ok(result.unifiedHtml.includes('&lt;script&gt;'));
  assert.throws(() => mergeInlineBlocks('<script>x</script>', '<script>y</script>'));
  structure(result.unifiedHtml);
});
test('a split or joined paragraph keeps a changed closing sentence inline once', () => {
  const before = 'Keep the worker paused. The next useful step is a representative duration measurement.';
  const after = 'Keep the worker paused.\n\nThe next useful step is to measure a representative duration.';
  for (const [left, right] of [[before, after], [after, before]]) {
    const result = compare(left, right);
    assert.equal(count(result.unifiedHtml, 'The next useful step is'), 1);
    assert.equal(count(result.unifiedHtml, 'data-kind="change"'), 1);
    assert.equal(count(result.unifiedHtml, 'data-kind="remove"'), 0);
    assert.equal(count(result.unifiedHtml, 'data-kind="add"'), 0);
    structure(result.unifiedHtml);
  }
  assert.equal(compare('First sentence. Second sentence.', 'First sentence.\n\nSecond sentence.').visibleChanged, false);
});

test('all saved recordings yield balanced inline diffs and preserve their source', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../../playground/samples.json', import.meta.url), 'utf8'));
  const saved = JSON.stringify(snapshot);
  for (const sample of snapshot.cases) for (const variant of sample.variants) {
    const result = compare(sample.original, variant.text);
    structure(result.unifiedHtml);
  }
  assert.equal(JSON.stringify(snapshot), saved);
});
