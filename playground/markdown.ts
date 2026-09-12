import { diffWords } from './diff.ts';

/** Half-open UTF-16 offsets into the unmodified Markdown source. */
export interface Mark { start: number; end: number; kind: 'remove' | 'add' }
interface Range { start: number; end: number }
interface Line extends Range { next: number }
const escape = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** A small, inert Markdown subset, not CommonMark. Links/images remain literal text.
 * Line views retain source offsets when list indentation is removed. Marks are
 * emitted only at literal leaves, so they cannot alter parsing or cross tags.
 * Depth and delimiter-search budgets fall back to literal text, never truncation.
 */
export function renderMarkdown(source: string, marks: Mark[] = []): string {
  const ranges: Mark[] = [];
  for (const mark of marks.filter(m => Number.isInteger(m.start) && Number.isInteger(m.end) &&
    (m.kind === 'remove' || m.kind === 'add')).slice().sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, mark.start, ranges.at(-1)?.end ?? 0);
    const end = Math.min(source.length, mark.end);
    if (end > start) ranges.push({ start, end, kind: mark.kind });
  }
  const literal = (start: number, end: number): string => {
    if (start >= end) return '';
    let html = '', cursor = start, low = 0, high = ranges.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ranges[mid].end <= start) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < ranges.length && ranges[i].start < end; i++) {
      const mark = ranges[i], a = Math.max(cursor, mark.start), b = Math.min(end, mark.end);
      html += escape(source.slice(cursor, a));
      const tag = mark.kind === 'remove' ? 'del' : 'ins';
      html += `<${tag} class="change">${escape(source.slice(a, b))}</${tag}>`;
      cursor = b;
    }
    return html + escape(source.slice(cursor, end));
  };
  let searches = 100_000;
  const inline = (start: number, end: number, depth = 0): string => {
    if (depth >= 16 || searches <= 0) return literal(start, end);
    const text = source.slice(start, end);
    const tokens = [...text.matchAll(/\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|`+|\*+|_+/g)];
    let html = '', cursor = 0;
    const codeEnd = (index: number) => {
      const delimiter = tokens[index][0];
      let at = tokens[index].index! + delimiter.length;
      while (searches-- > 0 && (at = text.indexOf(delimiter, at)) >= 0) {
        // Backslashes are literal inside code; only an exact backtick run closes it.
        if (text[at - 1] !== '`' && text[at + delimiter.length] !== '`') return at;
        at += delimiter.length;
      }
      return -1;
    };
    for (let i = 0; i < tokens.length && searches > 0; i++) {
      const token = tokens[i], at = token.index!, delimiter = token[0];
      if (at < cursor) continue;
      html += literal(start + cursor, start + at);
      cursor = at;
      if (delimiter[0] === '\\') {
        html += literal(start + at + 1, start + at + 2);
        cursor += 2;
        continue;
      }
      if (delimiter[0] === '`') {
        const close = codeEnd(i);
        if (close >= 0) {
          html += `<code>${literal(start + at + delimiter.length, start + close)}</code>`;
          cursor = close + delimiter.length;
        } else {
          html += literal(start + at, start + at + delimiter.length);
          cursor += delimiter.length;
        }
        continue;
      }
      let close = -1;
      if (delimiter.length <= 3 && /\S/.test(text[at + delimiter.length] ?? '') &&
        !(delimiter[0] === '_' && /[\p{L}\p{N}_]/u.test(text[at - 1] ?? ''))) {
        for (let j = i + 1; j < tokens.length && searches-- > 0; j++) {
          if (tokens[j][0][0] === '`') {
            const codeClose = codeEnd(j);
            if (codeClose >= 0) {
              const next = codeClose + tokens[j][0].length;
              while (j + 1 < tokens.length && tokens[j + 1].index! < next) j++;
              continue;
            }
          }
          if (tokens[j][0] === delimiter && /\S/.test(text[tokens[j].index! - 1] ?? '') &&
            !(delimiter[0] === '_' && /[\p{L}\p{N}_]/u.test(text[tokens[j].index! + delimiter.length] ?? ''))) {
            close = j; break;
          }
        }
      }
      if (close >= 0) {
        const bodyStart = start + at + delimiter.length, bodyEnd = start + tokens[close].index!;
        const tags = delimiter.length === 3 ? ['strong', 'em'] : [delimiter.length === 2 ? 'strong' : 'em'];
        html += tags.map(t => `<${t}>`).join('') + inline(bodyStart, bodyEnd, depth + 1) +
          [...tags].reverse().map(t => `</${t}>`).join('');
        cursor = tokens[close].index! + delimiter.length;
        i = close;
      } else {
        html += literal(start + at, start + at + delimiter.length);
        cursor += delimiter.length;
      }
    }
    return html + literal(start + cursor, end);
  };
  const lines: Line[] = [];
  for (let start = 0; start < source.length;) {
    const lf = source.indexOf('\n', start), next = lf < 0 ? source.length : lf + 1;
    const end = lf < 0 ? next : lf > start && source[lf - 1] === '\r' ? lf - 1 : lf;
    lines.push({ start, end, next });
    start = next;
  }
  const text = (line: Range) => source.slice(line.start, line.end);
  const blank = (line: Line) => !text(line).trim();
  const trim = (range: Range): Range => {
    const value = text(range), left = value.length - value.trimStart().length;
    return { start: range.start + left, end: Math.max(range.start + left, range.end - (value.length - value.trimEnd().length)) };
  };
  const heading = (line: Line) => /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(text(line));
  const fence = (line: Line) => /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(text(line));
  const item = (line: Line) => /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(text(line));
  const indent = (line: Line) => /^ */.exec(text(line))![0].length;
  const cells = (line: Line): Range[] | null => {
    const value = text(line), cuts: number[] = [];
    let ticks = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '\\') { i++; continue; }
      if (value[i] === '`') {
        let count = 1;
        while (value[i + count] === '`') count++;
        ticks = ticks === count ? 0 : ticks || count;
        i += count - 1;
      } else if (value[i] === '|' && !ticks) cuts.push(line.start + i);
    }
    if (!cuts.length) return null;
    const bounds = [line.start - 1, ...cuts, line.end];
    const result = bounds.slice(0, -1).map((bound, i) => trim({ start: bound + 1, end: bounds[i + 1] }));
    if (result[0].start === result[0].end) result.shift();
    if (result.at(-1)?.start === result.at(-1)?.end) result.pop();
    return result;
  };
  const tableHeader = (rows: Line[], index: number) => {
    if (!rows[index + 1]) return null;
    const header = cells(rows[index]), rule = cells(rows[index + 1]);
    return header?.length && rule?.length === header.length && rule.every(cell => /^:?-{3,}:?$/.test(text(cell)))
      ? header : null;
  };
  const blocks = (rows: Line[], depth = 0): string => {
    if (depth >= 32) return `<pre>${rows.map(line => literal(line.start, line.next)).join('')}</pre>`;
    const out: string[] = [];
    for (let i = 0; i < rows.length;) {
      const line = rows[i];
      if (blank(line)) { i++; continue; }
      const opening = fence(line);
      if (opening) {
        const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*$`);
        const body: string[] = [];
        for (i++; i < rows.length && !closing.test(text(rows[i])); i++) body.push(literal(rows[i].start, rows[i].next));
        if (i < rows.length) i++;
        out.push(`<pre><code>${body.join('')}</code></pre>`);
        continue;
      }
      const title = heading(line);
      if (title) {
        const level = title[1].length;
        out.push(`<h${level}>${inline(line.start + title[0].length, line.end)}</h${level}>`);
        i++; continue;
      }
      const first = item(line);
      if (first) {
        const ordered = /^\d/.test(first[2]), tag = ordered ? 'ol' : 'ul', base = first[1].length;
        const start = ordered ? ` start="${Number.parseInt(first[2], 10)}"` : '';
        const entries: string[] = [];
        while (i < rows.length) {
          const marker = item(rows[i]);
          if (!marker || marker[1].length !== base || /^\d/.test(marker[2]) !== ordered) break;
          const width = marker[0].length;
          const children: Line[] = [{ ...rows[i], start: rows[i].start + width }];
          i++;
          while (i < rows.length) {
            if (blank(rows[i])) {
              children.push({ ...rows[i], start: rows[i].start + Math.min(width, indent(rows[i])) });
              i++; continue;
            }
            if (indent(rows[i]) < width) break;
            children.push({ ...rows[i], start: rows[i].start + width });
            i++;
          }
          entries.push(`<li>${blocks(children, depth + 1)}</li>`);
        }
        out.push(`<${tag}${start}>${entries.join('')}</${tag}>`);
        continue;
      }
      const header = tableHeader(rows, i);
      if (header) {
        const row = (values: Range[], cellTag: string) => `<tr>${values.map(cell =>
          `<${cellTag}>${inline(cell.start, cell.end)}</${cellTag}>`).join('')}</tr>`;
        const body: string[] = [];
        i += 2;
        while (i < rows.length) {
          const values = cells(rows[i]);
          // Do not silently drop extra cells or swallow malformed rows.
          if (!values || values.length !== header.length) break;
          body.push(row(values, 'td')); i++;
        }
        out.push(`<table><thead>${row(header, 'th')}</thead><tbody>${body.join('')}</tbody></table>`);
        continue;
      }
      const paragraph: string[] = [];
      do {
        const current = rows[i++];
        paragraph.push(inline(current.start, current.end));
        if (i >= rows.length || blank(rows[i]) || heading(rows[i]) || fence(rows[i]) || item(rows[i]) || tableHeader(rows, i)) break;
        paragraph.push(literal(current.end, current.next));
      } while (i < rows.length);
      out.push(`<p>${paragraph.join('')}</p>`);
    }
    return out.join('\n');
  };
  return blocks(lines);
}

export function renderComparison(before: string, after: string): {
  beforeHtml: string; afterHtml: string; granularity: 'word' | 'block'; changed: boolean;
} {
  const diff = diffWords(before, after), left: Mark[] = [], right: Mark[] = [];
  let beforeOffset = 0, afterOffset = 0;
  for (const part of diff.parts) {
    if (part.kind === 'remove') left.push({ start: beforeOffset, end: beforeOffset + part.text.length, kind: 'remove' });
    if (part.kind === 'add') right.push({ start: afterOffset, end: afterOffset + part.text.length, kind: 'add' });
    if (part.kind !== 'add') beforeOffset += part.text.length;
    if (part.kind !== 'remove') afterOffset += part.text.length;
  }
  return { beforeHtml: renderMarkdown(before, left), afterHtml: renderMarkdown(after, right),
    granularity: diff.granularity, changed: before !== after };
}
