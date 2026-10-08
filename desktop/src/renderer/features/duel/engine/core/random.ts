export interface RandomSource {
  next(): number;
  readonly seed: number;
}

export function deriveSampleSeed(baseSeed: number, sampleIndex: number, ruleVersion: string): number {
  let hash = (baseSeed ^ Math.imul(sampleIndex + 1, 0x9e3779b1)) >>> 0;
  for (let index = 0; index < ruleVersion.length; index++) {
    hash = Math.imul(hash ^ ruleVersion.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash || 1;
}

export function createSeededRandom(seed: number): RandomSource {
  const initialSeed = seed >>> 0 || 1;
  let state = initialSeed;
  return {
    seed: initialSeed,
    next() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    },
  };
}
