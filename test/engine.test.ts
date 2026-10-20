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
});
