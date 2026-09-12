import type { Snapshot } from '../../playground/build.ts';

/** Explicit old-schema fixture, independent of whichever recordings are currently showcased. */
export function legacySnapshot(source: Snapshot): Snapshot {
  const result = structuredClone(source);
  result.version = 1;
  result.modes = result.modes.filter(mode => mode.id !== 'slye');
  for (const sample of result.cases) {
    sample.variants = sample.variants.filter(variant => variant.mode !== 'slye');
    for (const variant of sample.variants) delete variant.recording;
  }
  return result;
}
