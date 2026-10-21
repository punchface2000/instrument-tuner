// Modelled plucked string (Karplus–Strong with exact fractional tuning).
//
// A burst of filtered noise circulates in a delay loop whose length is one
// period of the note. A two-point average in the loop (half a sample of delay)
// makes the high partials die first, like a real string; a first-order allpass
// supplies the fractional part of the delay so the pitch is exact, not rounded
// to a whole number of samples. Pure: returns samples, no Web Audio needed.

export interface PluckVoice {
  /** Seconds to render. */
  seconds: number;
  /** Time for the fundamental to fall by 60 dB (s). */
  decay: number;
  /** 0 = dark (thumb, bass), 1 = bright (pick, nylon close to the bridge). */
  brightness: number;
  /** Where the string is plucked, as a fraction of its length (0.1–0.5). */
  position: number;
}

export const VOICES: Record<string, PluckVoice> = {
  bass: { seconds: 3.2, decay: 4.5, brightness: 0.25, position: 0.2 },
  guitar: { seconds: 3.2, decay: 3.5, brightness: 0.55, position: 0.18 },
  ukulele: { seconds: 2.4, decay: 1.6, brightness: 0.75, position: 0.22 },
  violin: { seconds: 2.0, decay: 1.2, brightness: 0.6, position: 0.25 }, // pizzicato
};

/** Small deterministic PRNG so every pluck of a note sounds the same. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

export function renderPluck(freq: number, sampleRate: number, voice: PluckVoice): Float32Array {
  const n = Math.round(voice.seconds * sampleRate);
  const out = new Float32Array(n);
  const period = sampleRate / freq; // total loop delay, in samples
  const w = (2 * Math.PI * freq) / sampleRate;

  // Loop delay = N (delay line) + 0.5 (two-point average) + d (allpass).
  let N = Math.floor(period - 0.5 - 0.1);
  let d = period - 0.5 - N;
  if (N < 2) {
    N = 2;
    d = Math.max(0.1, period - 2.5);
  }
  // Allpass coefficient giving exactly `d` samples of phase delay at the fundamental.
  const C = Math.sin(((1 - d) * w) / 2) / Math.sin(((1 + d) * w) / 2);
  // Loop gain from the requested decay time. The two-point average also
  // attenuates the fundamental by cos(w/2) per trip; compensate for it.
  const perTrip = Math.pow(10, -3 * (period / sampleRate) / voice.decay);
  const rho = Math.min(0.99999, perTrip / Math.cos(w / 2));

  // Excitation: one period of noise, low-passed for brightness, with a comb
  // notch for the pluck position (a node there cannot vibrate).
  const rand = rng(Math.round(freq * 100));
  const exc = new Float32Array(N);
  const a = 0.05 + 0.9 * voice.brightness; // one-pole low-pass coefficient
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += a * (rand() - lp);
    exc[i] = lp;
  }
  const p = Math.max(1, Math.round(voice.position * N));
  const shaped = new Float32Array(N);
  for (let i = 0; i < N; i++) shaped[i] = exc[i] - (i >= p ? exc[i - p] : 0);

  const line = new Float32Array(N); // circular delay line
  let idx = 0;
  let prevTap = 0;
  let apX1 = 0;
  let apY1 = 0;
  for (let i = 0; i < n; i++) {
    const tap = line[idx];
    const avg = 0.5 * (tap + prevTap);
    prevTap = tap;
    const ap = C * avg + apX1 - C * apY1;
    apX1 = avg;
    apY1 = ap;
    const y = (i < N ? shaped[i] : 0) + rho * ap;
    line[idx] = y;
    idx = idx + 1 === N ? 0 : idx + 1;
    out[i] = y;
  }

  // Normalise to −3 dBFS peak, short fade-in, fade-out over the last 0.4 s.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? 0.7 / peak : 0;
  const fadeIn = Math.round(0.002 * sampleRate);
  const fadeOut = Math.min(n, Math.round(0.4 * sampleRate));
  for (let i = 0; i < n; i++) {
    let e = g;
    if (i < fadeIn) e *= i / fadeIn;
    if (i > n - fadeOut) e *= ((n - i) / fadeOut) ** 2;
    out[i] *= e;
  }
  return out;
}
