import { mergeInlineBlocks, markBlock } from './inline-diff.ts';

type Kind = 'equal' | 'remove' | 'add' | 'change';
interface Block { html: string; key: string }
const unmark = (html: string) => html.replace(/<(?:del|ins) class="change">|<\/(?:del|ins)>/g, '');
const MAX_CELLS = 1_000_000; // At most 4 MiB; larger alignments use adjacent pairs.

/** Only for balanced, safe semantic HTML from renderComparison, NOT raw model text.
 * Generated tags have no void elements or attributes containing angle brackets.
 * Scan by tag depth: literal newlines inside paragraphs/code are not boundaries.
 */
function splitBlocks(html: string): string[] {
  const blocks: string[] = [];
  let depth = 0, start = 0;
  for (const match of html.matchAll(/<(\/?)[a-z][a-z0-9]*(?:\s[^>]*)?>/g)) {
    if (!match[1]) {
      if (depth === 0) start = match.index!;
      depth++;
    } else if (--depth === 0) {
      blocks.push(html.slice(start, match.index! + match[0].length));
    }
  }
  return blocks;
}

function units(html: string): Block[] {
  return splitBlocks(html).flatMap(block => {
    const list = /^<(ol|ul)(?: start="(\d+)")?>/.exec(block);
    if (!list) return [{ html: block, key: unmark(block) }];
    const tag = list[1], start = Number(list[2] ?? 1);
    // Split only direct children; nested lists stay inside their parent item.
    return splitBlocks(block.slice(list[0].length, -(tag.length + 3))).map((item, index) => {
      const wrapper = tag === 'ol' ? `<ol start="${start + index}">` : '<ul>';
      const html = `${wrapper}${item}</${tag}>`;
      return { html, key: unmark(html) };
    });
  });
}

function row(html: string, kind: Kind): string {
  const label = kind === 'equal' ? '' : ` role="group" aria-label="${kind === 'remove' ? 'Removed' : kind === 'add' ? 'Added' : 'Changed'}"`;
  return `<div class="diff-row" data-kind="${kind}"${label}><div class="prose">${html}</div></div>`;
}

/** A single reading with common wording once and replacements merged inline.
 * Separate blocks are used only for incompatible structural changes.
 */
export function renderUnifiedDiff(beforeHtml: string, afterHtml: string): {
  unifiedHtml: string; visibleChanged: boolean;
} {
  const beforeClean = unmark(beforeHtml);
  if (beforeClean === unmark(afterHtml)) {
    return { unifiedHtml: beforeClean ? row(beforeClean, 'equal') : '', visibleChanged: false };
  }
  const before = units(beforeHtml), after = units(afterHtml), output: string[] = [];
  let visibleChanged = false;
  const emit = (block: Block, kind: Exclude<Kind, 'change'>) => {
    output.push(row(kind === 'equal' ? block.key : markBlock(block.html, kind), kind));
    if (kind !== 'equal') visibleChanged = true;
  };
  const pair = (from: number, to: number, otherFrom: number, otherTo: number) => {
    while (from < to || otherFrom < otherTo) {
      if (from < to && otherFrom < otherTo && before[from].key === after[otherFrom].key) {
        emit(before[from++], 'equal'); otherFrom++;
      } else {
        // A removed/inserted heading must not offset every paragraph pairing.
        const leftHeading = from < to && /^<h[1-6]>/.test(before[from].key);
        const rightHeading = otherFrom < otherTo && /^<h[1-6]>/.test(after[otherFrom].key);
        if (leftHeading && !rightHeading) { emit(before[from++], 'remove'); continue; }
        if (rightHeading && !leftHeading) { emit(after[otherFrom++], 'add'); continue; }
        if (from < to && otherFrom < otherTo) {
          // A paragraph split must not duplicate its closing sentence as old/new rows.
          // Normalize just a 1↔2 paragraph boundary in the changes view; clean readings
          // and copied Markdown retain their original paragraph structure.
          const paragraphCount = (blocks: Block[], start: number, end: number) => {
            let count = 0;
            while (start + count < end && count < 3 && /^<p>/.test(blocks[start + count].key)) count++;
            return count;
          };
          const leftCount = paragraphCount(before, from, to), rightCount = paragraphCount(after, otherFrom, otherTo);
          if ((leftCount === 1 && rightCount === 2) || (leftCount === 2 && rightCount === 1)) {
            const joined = (blocks: Block[], start: number, count: number) =>
              `<p>${blocks.slice(start, start + count).map(block => block.key.slice(3, -4)).join(' ')}</p>`;
            const left = joined(before, from, leftCount), right = joined(after, otherFrom, rightCount);
            const merged = mergeInlineBlocks(left, right);
            if (merged !== null) {
              const kind = left === right ? 'equal' : 'change';
              output.push(row(merged, kind)); visibleChanged ||= kind === 'change';
              from += leftCount; otherFrom += rightCount; continue;
            }
          }
          const merged = mergeInlineBlocks(before[from].html, after[otherFrom].html);
          if (merged !== null) {
            output.push(row(merged, 'change')); visibleChanged = true;
            from++; otherFrom++; continue;
          }
        }
        if (from < to) emit(before[from++], 'remove');
        if (otherFrom < otherTo) emit(after[otherFrom++], 'add');
      }
    }
  };
  // Trim common ends before budgeting the quadratic alignment work.
  let prefix = 0, end = before.length, otherEnd = after.length;
  while (prefix < end && prefix < otherEnd && before[prefix].key === after[prefix].key) {
    emit(before[prefix++], 'equal');
  }
  while (end > prefix && otherEnd > prefix && before[end - 1].key === after[otherEnd - 1].key) {
    end--; otherEnd--;
  }
  const n = end - prefix, m = otherEnd - prefix, columns = m + 1;
  if (!n || !m || (n + 1) * columns > MAX_CELLS) {
    pair(prefix, end, prefix, otherEnd);
  } else {
    const lengths = new Uint32Array((n + 1) * columns);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i * columns + j] = before[prefix + i].key === after[prefix + j].key
          ? 1 + lengths[(i + 1) * columns + j + 1]
          : Math.max(lengths[(i + 1) * columns + j], lengths[i * columns + j + 1]);
      }
    }
    let i = 0, j = 0, runStart = 0, otherRunStart = 0;
    while (i < n && j < m) {
      if (before[prefix + i].key === after[prefix + j].key) {
        pair(prefix + runStart, prefix + i, prefix + otherRunStart, prefix + j);
        emit(before[prefix + i], 'equal');
        runStart = ++i; otherRunStart = ++j;
      } else if (lengths[(i + 1) * columns + j] >= lengths[i * columns + j + 1]) i++;
      else j++;
    }
    pair(prefix + runStart, end, prefix + otherRunStart, otherEnd);
  }
  for (let i = end; i < before.length; i++) emit(before[i], 'equal');
  return { unifiedHtml: output.join('\n'), visibleChanged };
}
