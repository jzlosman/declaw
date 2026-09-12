import { diffWords } from './diff.ts';

type Node = { tag: string; attrs: string; text: string; children: Node[] };
type Segment = { start: number; end: number; tags: string[] };
const inlineTags = new Set(['strong', 'em', 'code']);
const allowed = /^(p|h[1-6]|strong|em|code|pre|ol|ul|li|table|thead|tbody|tr|th|td)$/;
const unmark = (html: string) => html.replace(/<(?:del|ins) class="change">|<\/(?:del|ins)>/g, '');
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!);

/** Parse only the bounded, inert HTML produced by markdown.ts. Never raw model HTML. */
function parse(html: string): Node {
  const root: Node = { tag: '', attrs: '', text: '', children: [] }, stack = [root];
  for (const token of unmark(html).matchAll(/<([^>]+)>|([^<]+)/g)) {
    if (token[2] !== undefined) {
      stack.at(-1)!.children.push({ tag: '', attrs: '', text: decode(token[2]), children: [] });
    } else if (token[1].startsWith('/')) {
      if (stack.length === 1 || stack.pop()!.tag !== token[1].slice(1)) throw new Error('Unbalanced generated Markdown');
    } else {
      const match = /^([a-z][a-z0-9]*)(.*)$/.exec(token[1]);
      if (!match || !allowed.test(match[1]) || !(match[2] === '' || match[1] === 'ol' && /^ start="\d+"$/.test(match[2]))) throw new Error('Unsupported generated Markdown tag');
      if (stack.length > 96) throw new Error('Generated Markdown nesting limit');
      const node: Node = { tag: match[1], attrs: match[2], text: '', children: [] };
      stack.at(-1)!.children.push(node); stack.push(node);
    }
  }
  if (stack.length !== 1) throw new Error('Unclosed generated Markdown');
  return root;
}
const serialize = (n: Node): string => n.tag ? `<${n.tag}${n.attrs}>${n.children.map(serialize).join('')}</${n.tag}>` : escape(n.text);
const phrasing = (n: Node): boolean => !n.tag || inlineTags.has(n.tag) && n.children.every(phrasing);
const children = (n: Node) => n.children.some(c => c.tag && !inlineTags.has(c.tag))
  ? n.children.filter(c => c.tag || c.text.trim()) : n.children;
const sameShape = (a: Node, b: Node) => a.tag === b.tag && a.attrs === b.attrs;
function marked(n: Node, kind: 'remove' | 'add'): string {
  if (!n.tag) return n.text ? `<${kind === 'remove' ? 'del' : 'ins'} class="change">${escape(n.text)}</${kind === 'remove' ? 'del' : 'ins'}>` : '';
  return `<${n.tag}${n.attrs}>${n.children.map(c => marked(c, kind)).join('')}</${n.tag}>`;
}
function flatten(nodes: Node[]) {
  let text = ''; const segments: Segment[] = [];
  function visit(node: Node, tags: string[]) {
    if (!node.tag) {
      const start = text.length; text += node.text;
      if (text.length > start) segments.push({ start, end: text.length, tags });
    } else node.children.forEach(c => visit(c, [...tags, node.tag]));
  }
  nodes.forEach(n => visit(n, []));
  return { text, segments };
}
function inline(before: Node[], after: Node[], allowGap: boolean): string {
  const left = flatten(before), right = flatten(after);
  if (left.text === right.text && before.map(serialize).join('') !== after.map(serialize).join('')) {
    return before.map(n => marked(n, 'remove')).join('') + (allowGap ? '<span class="diff-gap"> </span>' : '') + after.map(n => marked(n, 'add')).join('');
  }
  const parts = diffWords(left.text, right.text).parts;
  let a = 0, b = 0, output = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i], side = part.kind === 'remove' ? left : right;
    const start = part.kind === 'remove' ? a : b, end = start + part.text.length;
    // This is presentation spacing between two alternatives, not source content.
    if (allowGap && part.kind === 'add' && parts[i - 1]?.kind === 'remove' && /\S$/.test(parts[i - 1].text) && /^\S/.test(part.text)) output += '<span class="diff-gap"> </span>';
    let low = 0, high = side.segments.length;
    while (low < high) { const mid = (low + high) >>> 1; if (side.segments[mid].end <= start) low = mid + 1; else high = mid; }
    for (let at = low; at < side.segments.length && side.segments[at].start < end; at++) {
      const segment = side.segments[at];
      let leaf = escape(side.text.slice(Math.max(start, segment.start), Math.min(end, segment.end)));
      if (part.kind !== 'equal') {
        const tag = part.kind === 'remove' ? 'del' : 'ins';
        leaf = `<${tag} class="change">${leaf}</${tag}>`;
      }
      for (const tag of [...segment.tags].reverse()) leaf = `<${tag}>${leaf}</${tag}>`;
      output += leaf;
    }
    if (part.kind !== 'add') a += part.text.length;
    if (part.kind !== 'remove') b += part.text.length;
  }
  return output;
}

export function markBlock(html: string, kind: 'remove' | 'add'): string {
  return children(parse(html)).map(n => marked(n, kind)).join('');
}

/** Merge compatible paragraphs, list items and table cells in place. Common text
 * occurs once; replacements are adjacent del/ins within the same sentence.
 * Structural insertions/deletions remain at their actual tree positions.
 */
export function mergeInlineBlocks(beforeHtml: string, afterHtml: string): string | null {
  const a = children(parse(beforeHtml)), b = children(parse(afterHtml));
  if (a.length !== 1 || b.length !== 1 || !sameShape(a[0], b[0])) return null;
  let budget = 250_000;
  function merge(left: Node, right: Node): string {
    if (serialize(left) === serialize(right)) return serialize(right);
    if (!left.tag) return inline([left], [right], true);
    const body = left.children.every(phrasing) && right.children.every(phrasing)
      ? inline(left.children, right.children, left.tag !== 'pre' && left.tag !== 'code')
      : sequence(children(left), children(right));
    return `<${right.tag}${right.attrs}>${body}</${right.tag}>`;
  }
  function sequence(left: Node[], right: Node[]): string {
    const leftKeys = left.map(serialize), rightKeys = right.map(serialize);
    let output = '';
    function pairs(from: number, to: number, otherFrom: number, otherTo: number) {
      while (from < to || otherFrom < otherTo) {
        if (from < to && otherFrom < otherTo && sameShape(left[from], right[otherFrom])) {
          output += merge(left[from++], right[otherFrom++]);
        } else {
          if (from < to) output += marked(left[from++], 'remove');
          if (otherFrom < otherTo) output += marked(right[otherFrom++], 'add');
        }
      }
    }
    const columns = right.length + 1, cells = (left.length + 1) * columns;
    if (cells > budget) { pairs(0, left.length, 0, right.length); return output; }
    budget -= cells;
    const lengths = new Uint32Array(cells);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      lengths[i * columns + j] = leftKeys[i] === rightKeys[j] ? 1 + lengths[(i + 1) * columns + j + 1] : Math.max(lengths[(i + 1) * columns + j], lengths[i * columns + j + 1]);
    }
    let i = 0, j = 0, start = 0, otherStart = 0;
    while (i < left.length && j < right.length) {
      if (leftKeys[i] === rightKeys[j]) {
        pairs(start, i, otherStart, j); output += rightKeys[j]; start = ++i; otherStart = ++j;
      } else if (lengths[(i + 1) * columns + j] >= lengths[i * columns + j + 1]) i++;
      else j++;
    }
    pairs(start, left.length, otherStart, right.length);
    return output;
  }
  return merge(a[0], b[0]);
}
