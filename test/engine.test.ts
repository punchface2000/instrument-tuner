import { describe, expect, it } from 'vitest';
import { TunerEngine, type EngineSettings, type Reading } from '../src/engine';
import { tone, PLUCK } from '../bench/signals';
import { midiToFreq, nameToMidi } from '../src/tuning';

const SR = 48000;
const base: EngineSettings = {
  a4: 440, toleranceCents: 3, mode: 'instrument', instrumentId: 'guitar', tuningId: 'standard', lockedString: null,
};

/** Stream `seconds` of a tone through the engine in 1024-sample blocks like the worklet does. */
function stream(engine: TunerEngine, freq: number, seconds: number, amp = 0.4): Reading | null {
  const n = Math.round(seconds * SR);
  const sig = freq > 0
    ? tone({ freq, sampleRate: SR, length: n, partials: PLUCK, decay: 3, peak: amp, seed: 9 })
    : new Float64Array(n);
  let last: Reading | null = null;
  for (let i = 0; i < n; i += 1024) {
    const r = engine.push(Float32Array.from(sig.subarray(i, i + 1024)));
    if (r) last = r;
  }
  return last;
}

const f = (name: string, a4 = 440) => midiToFreq(nameToMidi(name), a4);

describe('TunerEngine', () => {
  it('auto-detects the nearest guitar string and its deviation', () => {
    const e = new TunerEngine(SR, base);
    const r = stream(e, f('A2') * 2 ** (12 / 1200), 0.5)!;
    expect(r.active).toBe(true);
    expect(r.targetName).toBe('A2');
    expect(r.stringIndex).toBe(1);
    expect(r.cents).toBeCloseTo(12, 0);
    expect(r.inTune).toBe(false);
  });

  it('marks a string tuned after it stays in tolerance', () => {
    const e = new TunerEngine(SR, base);
    const r = stream(e, f('G3') * 2 ** (1 / 1200), 1)!;
    expect(r.inTune).toBe(true);
    expect(e.tuned.has(3)).toBe(true);
  });

  it('measures against the locked string even when another is closer', () => {
    const e = new TunerEngine(SR, { ...base, lockedString: 0 }); // E2
    const r = stream(e, f('F2'), 0.5)!;
    expect(r.targetName).toBe('E2');
    expect(r.cents).toBeCloseTo(100, 0);
  });

  it('follows the A4 reference', () => {
    const e = new TunerEngine(SR, { ...base, a4: 432 });
    const r = stream(e, f('D3', 432), 0.5)!;
    expect(r.targetName).toBe('D3');
    expect(Math.abs(r.cents)).toBeLessThan(1);
  });

  it('detects bass E1 and ukulele high G', () => {
    const bass = new TunerEngine(SR, { ...base, instrumentId: 'bass' });
    expect(stream(bass, f('E1'), 0.6)!.targetName).toBe('E1');
    const uke = new TunerEngine(SR, { ...base, instrumentId: 'ukulele' });
    const r = stream(uke, f('G4'), 0.5)!;
    expect(r.targetName).toBe('G4');
    expect(r.stringIndex).toBe(0);
  });

  it('names any note in chromatic mode', () => {
    const e = new TunerEngine(SR, { ...base, mode: 'chromatic' });
    for (const name of ['C2', 'F#3', 'Bb4', 'E6']) {
      e.reset();
      const r = stream(e, f(name) * 2 ** (-8 / 1200), 0.5)!;
      expect(r.targetName.replace('A#', 'Bb')).toBe(name);
      expect(r.cents).toBeCloseTo(-8, 0);
    }
  });

  it('holds the last note briefly after silence, then clears', () => {
    const e = new TunerEngine(SR, base);
    stream(e, f('D3'), 0.5);
    const held = stream(e, 0, 0.5)!;
    expect(held.active).toBe(true);
    expect(held.held).toBe(true);
    const gone = stream(e, 0, 1.5)!;
    expect(gone.active).toBe(false);
  });

  it('keeps tracking a quiet, decaying note without gaps', () => {
    const e = new TunerEngine(SR, base);
    const n = 3 * SR;
    const sig = tone({ freq: f('A2'), sampleRate: SR, length: n, partials: PLUCK, decay: 1.6, peak: 0.0125, snrDb: 30, seed: 4 });
    let live = 0, total = 0, maxErr = 0;
    for (let i = 0; i < n; i += 1024) {
      const r = e.push(Float32Array.from(sig.subarray(i, i + 1024)));
      if (!r || i < 0.3 * SR) continue;
      total++;
      if (r.active && !r.held) {
        live++;
        maxErr = Math.max(maxErr, Math.abs(r.cents));
      }
    }
    expect(live / total).toBeGreaterThan(0.95);
    expect(maxErr).toBeLessThan(5);
  });

  it('follows the pitch continuously while the peg is turned', () => {
    const e = new TunerEngine(SR, base);
    const n = 3 * SR;
    const sig = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const c = -40 + (40 * i) / n; // −40 → 0 cents
      ph += (2 * Math.PI * f('D3') * 2 ** (c / 1200)) / SR;
      sig[i] = 0.2 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph));
    }
    const seen: number[] = [];
    for (let i = 0; i < n; i += 1024) {
      const r = e.push(sig.subarray(i, i + 1024));
      if (r?.active && !r.held) seen.push(r.cents);
    }
    expect(seen.length).toBeGreaterThan(100);
    // readings move steadily from flat towards zero
    expect(seen[5]).toBeLessThan(-30);
    expect(seen[seen.length - 1]).toBeGreaterThan(-4);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1] - 2);
  });

  // ---- regressions found by the real-recording session tests (uxtest/) ----

  /** Stream a synthetic string with per-partial amplitudes, optional glide and inharmonicity. */
  function partialsStream(engine: TunerEngine, opts: {
    f0: (t: number) => number; seconds: number; amps: number[]; B?: number; decay?: number; level?: number;
  }): Reading[] {
    const n = Math.round(opts.seconds * SR);
    const ph = new Float64Array(opts.amps.length);
    const out: Reading[] = [];
    const block = new Float32Array(1024);
    let bi = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let v = 0;
      for (let k = 0; k < opts.amps.length; k++) {
        const m = k + 1;
        ph[k] += (2 * Math.PI * m * opts.f0(t) * Math.sqrt(1 + (opts.B ?? 0) * m * m)) / SR;
        v += opts.amps[k] * Math.sin(ph[k]);
      }
      block[bi++] = (opts.level ?? 0.1) * v * Math.exp(-t / (opts.decay ?? 4));
      if (bi === 1024) {
        const r = engine.push(block);
        if (r) out.push(r);
        bi = 0;
      }
    }
    return out;
  }

  it('does not jump an octave on a low string with a weak fundamental while the peg turns', () => {
    const e = new TunerEngine(SR, base);
    // E2 whose 2nd harmonic dominates (fundamental 20 dB down), gliding −30 → +5 cents
    const rs = partialsStream(e, {
      f0: (t) => f('E2') * 2 ** ((-30 + 35 * Math.min(1, t / 3)) / 1200), seconds: 3.5,
      amps: [0.1, 1, 0.45, 0.3, 0.2, 0.12, 0.08], decay: 3,
    });
    const shown = rs.filter((r) => r.active && !r.held).map((r) => r.targetName);
    expect(shown.length).toBeGreaterThan(100);
    expect(new Set(shown)).toEqual(new Set(['E2']));
  });

  it('reads the fundamental of an inharmonic string, not its sharp overtones', () => {
    const e = new TunerEngine(SR, { ...base, instrumentId: 'bass' });
    // bass E1: weak fundamental, strong overtones that run sharp (B = 3e-4)
    const rs = partialsStream(e, { f0: () => f('E1'), seconds: 3, amps: [0.3, 1, 0.9, 1, 0.8, 0.6, 0.4, 0.3], B: 3e-4, decay: 5 });
    const tail = rs.filter((r) => r.active && !r.held).slice(-40);
    const med = tail.map((r) => r.cents).sort((a, b) => a - b)[tail.length >> 1];
    expect(Math.abs(med)).toBeLessThan(2);
  });

  it('ignores people talking across the room once a string has been played', () => {
    const e = new TunerEngine(SR, base);
    // pluck A2 (sets how loud this instrument is), then 3 s of a quieter speaking voice
    partialsStream(e, { f0: () => f('A2'), seconds: 1, amps: [1, 0.6, 0.8, 0.3], decay: 0.25, level: 0.2 });
    let ph = 0;
    let live = 0;
    const block = new Float32Array(1024);
    let bi = 0;
    for (let i = 0; i < 3 * SR; i++) {
      const t = i / SR;
      const f0 = 145 + 40 * Math.sin(2 * Math.PI * 0.9 * t) + 15 * Math.sin(2 * Math.PI * 2.3 * t);
      ph += (2 * Math.PI * f0) / SR;
      const syll = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.3 * t);
      let v = 0;
      for (let k = 1; k < 8; k++) v += Math.sin(k * ph) / k;
      block[bi++] = 0.012 * syll * syll * v; // ≈ 20 dB below the pluck
      if (bi === 1024) {
        const r = e.push(block);
        if (r?.active && !r.held && i > 0.5 * SR) live++;
        bi = 0;
      }
    }
    expect(live).toBe(0);
  });

  it('keeps "In tune" steady at the edge of the tolerance', () => {
    const e = new TunerEngine(SR, base);
    // settle in tune, then sit just outside the ±3 cent tolerance, wobbling ±0.4 cents
    const rs = partialsStream(e, {
      f0: (t) => f('D3') * 2 ** ((t < 1 ? 0 : 3.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) / 1200),
      seconds: 3, amps: [1, 0.5, 0.3], decay: 10,
    });
    const after = rs.filter((r, i) => i > 0 && r.active && !r.held).slice(-100);
    const flips = after.slice(1).filter((r, i) => r.inTune !== after[i].inTune).length;
    expect(flips).toBe(0);
  });
});
