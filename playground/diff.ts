export interface DiffPart { kind: "equal" | "remove" | "add"; text: string }
export interface WordDiff { parts: DiffPart[]; granularity: "word" | "block" }

const MAX_CHARS = 100_000;
const MAX_CELLS = 2_000_000; // At most 8 MiB for the alignment table.
const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];

/** Lossless word/punctuation/whitespace diff. Moves appear as removal + addition.
 * Large inputs fall back to coarse changed blocks rather than unbounded LCS work.
 * Filtering out additions reconstructs before; filtering out removals reconstructs after.
 */
export function diffWords(before: string, after: string): WordDiff {
  const parts: DiffPart[] = [];
  const append = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  if (before === after) {
    append("equal", before);
    return { parts, granularity: "word" };
  }
  if (before.length + after.length > MAX_CHARS) {
    append("remove", before);
    append("add", after);
    return { parts, granularity: "block" };
  }
  const left = tokens(before), right = tokens(after);
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  while (suffix < left.length - prefix && suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  append("equal", left.slice(0, prefix).join(""));
  const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix);
  const columns = b.length + 1;
  const cells = (a.length + 1) * columns;
  let granularity: WordDiff["granularity"] = "word";
  if (cells > MAX_CELLS) {
    append("remove", a.join(""));
    append("add", b.join(""));
    granularity = "block";
  } else {
    const lengths = new Uint32Array(cells);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i * columns + j] = a[i] === b[j]
          ? 1 + lengths[(i + 1) * columns + j + 1]
          : Math.max(lengths[(i + 1) * columns + j], lengths[i * columns + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        append("equal", a[i++]); j++;
      } else if (i < a.length && (j === b.length || lengths[(i + 1) * columns + j] >= lengths[i * columns + j + 1])) {
        append("remove", a[i++]);
      } else {
        append("add", b[j++]);
      }
    }
  }
  append("equal", suffix ? left.slice(-suffix).join("") : "");
  return { parts, granularity };
}
