import { randomUUID } from 'node:crypto';

// One pass over prose: never run these expressions over generated placeholders.
const technical = /(`+)[^\n]*?\1|(?:^|(?<=\s))(?:sudo\s+)?(?:npm|npx|pnpm|bunx?|yarn|git|gh|curl|wget|ssh|docker|kubectl|paseo|systemctl|apt|brew|python3?|node|bash|pwsh|pip3?|cargo|go|dotnet|make)\s+[^\n]+|^\s*(?:Error|TypeError|ReferenceError|SyntaxError|fatal):[^\n]+|\[[^\]\n]*\]\([^\n)]*\)|https?:\/\/[^\s<>]+|(?:[A-Za-z]:[\\/]|~\/|\.{1,2}\/|\/)[^\s<>"'`]+|\b(?:[\w.@-]+[\/\\])+[\w.@/-]+|\b[\w.-]+\.(?:json|ya?ml|toml|tsx?|jsx?|py|md|sh|ps1|go|rs|log|txt|sql|css|html)\b|"[^"\n]+"|“[^”\n]+”|(?<!\w)'[^'\n]+'(?!\w)|(?<!\w)[+-]?\d+(?:[.,:]\d+)*(?:%|\b)/gm;

/** Copy protected spans exactly; reject damaged, duplicated, or reordered placeholders. */
export async function rewriteText(original: string, complete: (masked: string) => Promise<string>): Promise<string> {
  const prefix = `⟦KEEP_${randomUUID()}_`;
  const parts: string[] = [];
  const tokens: string[] = [];
  const protect = (text: string) => {
    parts.push(text);
    const token = `${prefix}${tokens.length}⟧`;
    tokens.push(token);
    return token;
  };
  const lines = original.split(/(?<=\n)/);
  let prose = '', masked = '';
  const flush = () => { masked += prose.replace(technical, protect); prose = ''; };
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
  const proseOnly = rewritten.replace(/⟦KEEP_[^⟧]+⟧/g, 'protected');
  if (new RegExp(technical.source, technical.flags).test(proseOnly) || /^ {0,3}(`{3,}|~{3,})/m.test(proseOnly)) throw new Error('preservation');
  let result = rewritten;
  for (let i = 0; i < tokens.length; i++) result = result.replace(tokens[i], () => parts[i]);
  if (result.includes(prefix)) throw new Error('preservation');
  return result;
}
