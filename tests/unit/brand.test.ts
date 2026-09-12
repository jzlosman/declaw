import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

async function png(name: string) {
  const bytes = await readFile(new URL(`../../playground/assets/${name}`, import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6, 'must have real RGBA, not a flattened background');
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)), pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0, 'canonical asset exporter uses unfiltered PNG rows');
    raw.copy(pixels, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, pixels };
}

test('Declaw exports have true transparency, matching geometry and no chroma-key fringe', async () => {
  const white = await png('declaw-wordmark-white.png'), dark = await png('declaw-wordmark-charcoal.png');
  assert.equal(white.width, dark.width); assert.equal(white.height, dark.height);
  const palette = new Set(['166,167,177', '233,174,184', '175,224,196']);
  for (const asset of [white, dark, await png('declaw-e.png')]) {
    let clear = 0, solid = 0, edge = 0;
    for (let i = 0; i < asset.pixels.length; i += 4) {
      const alpha = asset.pixels[i + 3];
      if (alpha === 0) clear++; else if (alpha === 255) solid++; else edge++;
      if (alpha) {
        const color = [...asset.pixels.subarray(i, i + 3)].join(',');
        assert.ok(palette.has(color) || color === '255,255,255' || color === '23,24,28', color);
      }
      const pixel = i / 4, x = pixel % asset.width, y = Math.floor(pixel / asset.width);
      if (x === 0 || y === 0 || x === asset.width - 1 || y === asset.height - 1) assert.equal(alpha, 0);
    }
    assert.ok(clear > 0 && solid > 0 && edge > 0);
  }
  for (let i = 0; i < white.pixels.length; i += 4) {
    assert.equal(white.pixels[i + 3], dark.pixels[i + 3], 'recolor must not change the alpha mask');
    const color = [...white.pixels.subarray(i, i + 3)].join(',');
    if (palette.has(color)) assert.deepEqual(white.pixels.subarray(i, i + 4), dark.pixels.subarray(i, i + 4));
  }
});

test('README and playground select the correct light, dark and compact brand assets', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const html = await readFile(new URL('../../playground/index.html', import.meta.url), 'utf8');
  assert.match(readme, /<source media="\(prefers-color-scheme: dark\)" srcset="playground\/assets\/declaw-wordmark-white.png"/);
  assert.match(readme, /<img src="playground\/assets\/declaw-wordmark-charcoal.png" alt="Declaw"/);
  for (const file of ['declaw-wordmark-white.png', 'declaw-e.png', 'declaw-favicon.png']) assert.ok(html.includes(file));
  assert.match(html, /<title>Declaw<\/title>/);
});
