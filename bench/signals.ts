// Deterministic synthetic test signals for the pitch benchmark.

/** Small seeded PRNG (mulberry32) so every run produces identical signals. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian sample via Box–Muller. */
function gauss(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export interface ToneSpec {
  freq: number;
  sampleRate: number;
  length: number;
  /** Partial amplitudes relative to the fundamental; [1] = pure sine. */
  partials?: number[];
  /** String inharmonicity coefficient B: f_k = k·f·√(1 + B·k²). */
  inharmonicity?: number;
  /** Amplitude decay time constant in seconds (Infinity = sustained). */
  decay?: number;
  /** Additive white noise, as signal-to-noise ratio in dB. */
  snrDb?: number;
  /** DC offset added after normalisation. */
  dc?: number;
  /** Peak amplitude after normalisation. */
  peak?: number;
  seed?: number;
}

export function tone(spec: ToneSpec): Float64Array {
  const {
    freq, sampleRate, length,
    partials = [1], inharmonicity = 0, decay = Infinity,
    snrDb, dc = 0, peak = 0.5, seed = 1,
  } = spec;
  const rand = rng(seed);
  const out = new Float64Array(length);
  const phases = partials.map(() => rand() * 2 * Math.PI);
  for (let k = 0; k < partials.length; k++) {
    const n = k + 1;
    const fk = n * freq * Math.sqrt(1 + inharmonicity * n * n);
    if (fk >= sampleRate / 2) break;
    const w = (2 * Math.PI * fk) / sampleRate;
    const a = partials[k];
    for (let i = 0; i < length; i++) out[i] += a * Math.sin(w * i + phases[k]);
  }
  if (Number.isFinite(decay)) {
    for (let i = 0; i < length; i++) out[i] *= Math.exp(-i / (decay * sampleRate));
  }
  if (snrDb !== undefined) {
    let p = 0;
    for (let i = 0; i < length; i++) p += out[i] * out[i];
    const sigma = Math.sqrt(p / length / Math.pow(10, snrDb / 10));
    for (let i = 0; i < length; i++) out[i] += sigma * gauss(rand);
  }
  let m = 0;
  for (let i = 0; i < length; i++) m = Math.max(m, Math.abs(out[i]));
  const g = m > 0 ? peak / m : 0;
  for (let i = 0; i < length; i++) out[i] = out[i] * g + dc;
  return out;
}

export function whiteNoise(length: number, peak = 0.5, seed = 7): Float64Array {
  const rand = rng(seed);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = gauss(rand);
  let m = 0;
  for (let i = 0; i < length; i++) m = Math.max(m, Math.abs(out[i]));
  for (let i = 0; i < length; i++) out[i] *= peak / m;
  return out;
}

/** A plucked-string-like spectrum: partials falling off as 1/k. */
export const PLUCK = Array.from({ length: 12 }, (_, k) => 1 / (k + 1));

/** Same, but the fundamental 20 dB down (small phone/laptop speakers & mics on bass). */
export const WEAK_FUNDAMENTAL = PLUCK.map((a, k) => (k === 0 ? a * 0.1 : a));
