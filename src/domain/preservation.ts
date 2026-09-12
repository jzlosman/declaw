// Adapted from scowalt/paseo-plain, commit 35e63ee2e5f17a5bad40a8772c84fa5f21a8678f.
// Copyright 2026 scowalt. Apache-2.0: src/plugins/built-in/paseo-plain/upstream/LICENSE; notices: upstream/NOTICE.
// Local change: distinguish English make/go prose from standalone or explicitly run commands.
// One pass over prose: never run these expressions over generated placeholders.
const technical = /(`+)[^\n]*?\1|(?:^|(?<=\s))(?:sudo\s+)?(?:npm|npx|pnpm|bunx?|yarn|git|gh|curl|wget|ssh|docker|kubectl|paseo|systemctl|apt|brew|python3?|node|bash|pwsh|pip3?|cargo|dotnet)\s+[^\n]+|(?:^ {0,3}(?:\$ )?|(?<=\b[Rr]an )|(?<=\b[Rr]un )|(?<=\b[Ee]xecute )|(?<=\b[Ee]xecuted ))(?:make|go)\s+[^\n]+|^\s*(?:Error|TypeError|ReferenceError|SyntaxError|fatal):[^\n]+|\[[^\]\n]*\]\([^\n)]*\)|https?:\/\/[^\s<>]+|(?:[A-Za-z]:[\\/]|~\/|\.{1,2}\/|\/)[^\s<>"'`]+|\b(?:[\w.@-]+[\/\\])+[\w.@/-]+|\b[\w.-]+\.(?:json|ya?ml|toml|tsx?|jsx?|py|md|sh|ps1|go|rs|log|txt|sql|css|html)\b|"[^"\n]+"|“[^”\n]+”|(?<!\w)'[^'\n]+'(?!\w)|(?<!\w)[+-]?\d+(?:[.,:]\d+)*(?:%|\b)/gm;

/** Copy protected spans exactly; reject damaged, duplicated, or reordered placeholders. */
export async function rewriteText(original: string, complete: (masked: string) => Promise<string>): Promise<string> {
  const parts: string[] = [];
  const tokens: string[] = [];
  // Deterministic, source-derived tokens keep this policy core free of randomness.
  // Avoid a literal collision if the source already contains a KEEP-shaped token.
  let nonce = [...original].reduce((hash, character) =>
    ((hash * 31) + character.codePointAt(0)!) >>> 0, 0);
  const protect = (text: string) => {
    parts.push(text);
    let token: string;
    do { token = `⟦KEEP_${nonce.toString(36)}_${tokens.length}⟧`; nonce = (nonce + 1) >>> 0; }
    while (original.includes(token));
    tokens.push(token);
    return token;
  };
  const lines = original.split(/(?<=\n)/);
  let prose = '', masked = '';
  const maskProse = (text: string) => text.split(/(?<=\n)/).map(line => {
    // Markdown list markers are structure. Leave them editable so a model can
    // reflow or renumber a list without moving a protected factual number.
    const marker = /^ {0,3}\d+[.)][ \t]+/.exec(line);
    if (!marker) return line.replace(technical, protect);
    return marker[0] + line.slice(marker[0].length).replace(technical, protect);
  }).join('');
  const flush = () => { masked += maskProse(prose); prose = ''; };
  for (let i = 0; i < lines.length; i++) {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (!opening) { prose += lines[i]; continue; }
    flush();
    const fence = opening[1];
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n)?$`);
    let block = lines[i];
    while (++i < lines.length) {
      block += lines[i];
      if (closing.test(lines[i])) break;
    }
    // Keep the final line break outside the placeholder, preserving paragraph structure.
    const newline = block.endsWith('\n') ? '\n' : '';
    masked += protect(newline ? block.slice(0, -1) : block) + newline;
  }
  flush();
  const rewritten = await complete(masked);
  if (!rewritten.trim() || rewritten.length > 64000) throw new Error('empty-or-oversize');
  const found = rewritten.match(/⟦KEEP_[^⟧]+⟧/g) ?? [];
  if (JSON.stringify(found) !== JSON.stringify(tokens)) throw new Error('preservation');
  // Ordered Markdown markers are structure, not numeric content. Models may
  // reflow prose into a list; factual numbers remain protected and checked.
  const proseOnly = rewritten.replace(/⟦KEEP_[^⟧]+⟧/g, 'protected');
  const withoutListMarkers = proseOnly.replace(/^ {0,3}\d+[.)][ \t]+/gm, '');
  if (new RegExp(technical.source, technical.flags).test(withoutListMarkers) || /^ {0,3}(`{3,}|~{3,})/m.test(proseOnly)) throw new Error('preservation');
  let result = rewritten;
  for (let i = 0; i < tokens.length; i++) result = result.replace(tokens[i], () => parts[i]);
  if (/⟦KEEP_[^⟧]+⟧/.test(result)) throw new Error('preservation');
  return result;
}
