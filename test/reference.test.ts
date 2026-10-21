import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderPluck, VOICES } from '../src/audio/pluck';
import { chooseSource, SAMPLES, type SampleSet } from '../src/audio/reference-source';
import { TunerEngine, type Reading } from '../src/engine';
import { INSTRUMENTS } from '../src/instruments';
import { midiToFreq, nameToMidi, midiToName } from '../src/tuning';

const SR = 48000;

/** How the tuner reads a rendered sound as `note`: median cents and spread after the attack. */
function read(x: Float32Array, note: string) {
  const e = new TunerEngine(SR, {
    a4: 440, toleranceCents: 3, mode: 'instrument', instrumentId: 'guitar', tuningId: 'x', strings: [note], lockedString: null,
  });
  const c: number[] = [];
  for (let i = 0; i + 1024 <= x.length; i += 1024) {
    const r: Reading | null = e.push(x.subarray(i, i + 1024));
    if (r?.active && !r.held && i / SR > 0.25 && i / SR < 1.6) c.push(r.cents);
  }
  c.sort((a, b) => a - b);
  const med = c[c.length >> 1];
  return { median: med, spread: Math.max(Math.abs(c[Math.floor(c.length * 0.05)] - med), Math.abs(c[Math.floor(c.length * 0.95)] - med)), n: c.length };
}

describe('modelled plucked string', () => {
  // A wide spread of notes, from a 5-string bass low B to high violin.
  for (const note of ['B0', 'E1', 'A1', 'E2', 'A2', 'G3', 'C4', 'E4', 'A4', 'E5', 'C6', 'G6']) {
    it(`is exactly on pitch at ${note}`, () => {
      const voice = nameToMidi(note) < 40 ? VOICES.bass : nameToMidi(note) > 64 ? VOICES.ukulele : VOICES.guitar;
      const x = renderPluck(midiToFreq(nameToMidi(note)), SR, { ...voice, seconds: 1.8 });
      const r = read(x, note);
      expect(r.n).toBeGreaterThan(20);
      expect(Math.abs(r.median)).toBeLessThan(0.5);
      expect(r.spread).toBeLessThan(1);
    });
  }

  it('follows the A4 reference', () => {
    const x = renderPluck(midiToFreq(nameToMidi('A2'), 432), SR, { ...VOICES.guitar, seconds: 1.8 });
    const e = new TunerEngine(SR, {
      a4: 432, toleranceCents: 3, mode: 'instrument', instrumentId: 'guitar', tuningId: 'x', strings: ['A2'], lockedString: null,
    });
    let last: Reading | null = null;
    for (let i = 0; i + 1024 <= x.length; i += 1024) last = e.push(x.subarray(i, i + 1024)) ?? last;
    expect(Math.abs(last!.cents)).toBeLessThan(0.5);
  });

  it('is deterministic', () => {
    const a = renderPluck(110, SR, VOICES.guitar);
    const b = renderPluck(110, SR, VOICES.guitar);
    expect(a).toEqual(b);
  });
});

describe('reference source choice', () => {
  const sets: Record<string, SampleSet> = {
    guitar: {
      maxDown: 3, maxUp: 2, credit: '',
      files: [
        { note: 'E2', midi: 40, file: 'e2.mp3', cents: 0 },
        { note: 'F#2', midi: 42, file: 'fs2.mp3', cents: 1.5 },
      ],
    },
  };

  it('uses the exact recording when there is one', () => {
    const s = chooseSource('guitar', 40, 440, sets);
    expect(s).toMatchObject({ kind: 'sample', file: 'e2.mp3', shift: 0 });
    expect((s as { rate: number }).rate).toBeCloseTo(1, 9);
  });

  it('prefers shifting a recording down, and corrects its residual offset', () => {
    const s = chooseSource('guitar', 41, 440, sets) as { file: string; rate: number; shift: number };
    expect(s.file).toBe('fs2.mp3'); // F2: F#2 down one (preferred over E2 up one)
    expect(s.shift).toBe(-1);
    const expected = midiToFreq(41) / (midiToFreq(42) * 2 ** (1.5 / 1200));
    expect(s.rate).toBeCloseTo(expected, 12);
  });

  it('follows A4 by changing the playback rate', () => {
    const s = chooseSource('guitar', 40, 432, sets) as { rate: number };
    expect(s.rate).toBeCloseTo(432 / 440, 12);
  });

  it('falls back to the modelled string outside the allowed shift or without recordings', () => {
    expect(chooseSource('guitar', 36, 440, sets).kind).toBe('model'); // C2: 4 below E2
    expect(chooseSource('guitar', 45, 440, sets).kind).toBe('model'); // A2: 3 above F#2
    expect(chooseSource('bass', 28, 440, sets)).toEqual({ kind: 'model', voice: 'bass', freq: midiToFreq(28) });
  });
});

describe('bundled samples', () => {
  it('exist on disk and cover every preset guitar and violin string with a recording', () => {
    for (const set of Object.values(SAMPLES)) {
      for (const f of set.files) expect(existsSync(join(__dirname, '..', 'public', f.file)), f.file).toBe(true);
    }
    for (const id of ['guitar', 'violin']) {
      for (const t of INSTRUMENTS.find((i) => i.id === id)!.tunings) {
        for (const s of t.strings) {
          const src = chooseSource(id, nameToMidi(s), 440);
          // 7-string low B and the viola C are allowed to use the model
          if (src.kind === 'model') expect(['B1', 'C3'], `${id} ${t.id} ${s}`).toContain(midiToName(nameToMidi(s)));
        }
      }
    }
  });

  it('keep shifts small enough to sound natural', () => {
    for (const set of Object.values(SAMPLES)) {
      expect(set.maxUp).toBeLessThanOrEqual(2);
      expect(set.maxDown).toBeLessThanOrEqual(7);
      expect(set.files.length).toBeGreaterThan(3);
      for (const f of set.files) expect(Math.abs(f.cents)).toBeLessThan(5);
    }
  });
});
