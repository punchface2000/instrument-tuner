import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, tuningLetters, STRING_COUNT_RANGE } from '../src/instruments';
import {
  sanitizeCustom, selectedTuning, stepNote, extraString, newCustomId, isValidStringNote, tuningsFor, type CustomTuning,
} from '../src/tunings';
import { TunerEngine, type Reading } from '../src/engine';
import { midiToFreq, nameToMidi } from '../src/tuning';
import { tone, PLUCK } from '../bench/signals';

const SR = 48000;
const ids = INSTRUMENTS.map((i) => i.id);

describe('preset tunings', () => {
  it('are all valid, unique and within limits', () => {
    for (const inst of INSTRUMENTS) {
      const seen = new Set<string>();
      for (const t of inst.tunings) {
        expect(seen.has(t.id), `${inst.id}/${t.id} duplicated`).toBe(false);
        seen.add(t.id);
        expect(t.strings.length).toBeGreaterThanOrEqual(STRING_COUNT_RANGE.min);
        expect(t.strings.length).toBeLessThanOrEqual(STRING_COUNT_RANGE.max);
        for (const n of t.strings) expect(isValidStringNote(n), `${inst.id}/${t.id} ${n}`).toBe(true);
      }
      expect(inst.tunings[0].id).toBe('standard');
    }
  });

  it('formats letters', () => {
    expect(tuningLetters(['E2', 'A2', 'D3', 'G3', 'B3', 'E4'])).toBe('EADGBE');
    expect(tuningLetters(['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'])).toBe('D A D F♯ A D');
    expect(tuningLetters(['Eb2', 'Ab2'])).toBe('E♭ A♭');
  });

  // Every string of every preset is detected as itself, a few cents off.
  for (const inst of INSTRUMENTS) {
    for (const t of inst.tunings) {
      it(`detects every string of ${inst.name} ${t.name}`, () => {
        for (let i = 0; i < t.strings.length; i++) {
          const e = new TunerEngine(SR, {
            a4: 440, toleranceCents: 3, mode: 'instrument', instrumentId: inst.id, tuningId: t.id, lockedString: null,
          });
          const truth = midiToFreq(nameToMidi(t.strings[i])) * 2 ** (6 / 1200);
          const sig = tone({ freq: truth, sampleRate: SR, length: Math.round(0.8 * SR), partials: PLUCK, decay: 3, peak: 0.3, seed: i + 1 });
          let last: Reading | null = null;
          for (let k = 0; k + 1024 <= sig.length; k += 1024) {
            const r = e.push(Float32Array.from(sig.subarray(k, k + 1024)));
            if (r) last = r;
          }
          expect(last?.active, `${t.strings[i]} not detected`).toBe(true);
          expect(last!.stringIndex, `${t.strings[i]} → string ${last!.targetName}`).toBe(i);
          expect(Math.abs(last!.cents - 6), `${t.strings[i]} cents ${last!.cents}`).toBeLessThan(1.5);
        }
      });
    }
  }
});

describe('custom tunings', () => {
  const good = { id: 'custom-abc123', instrumentId: 'guitar', name: '  Open Dsus4  ', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] };

  it('keeps valid saved tunings and trims names', () => {
    const c = sanitizeCustom(good, ids)!;
    expect(c.name).toBe('Open Dsus4');
    expect(c.custom).toBe(true);
  });

  it('drops broken saved data instead of crashing', () => {
    expect(sanitizeCustom(null, ids)).toBeNull();
    expect(sanitizeCustom({ ...good, id: 'standard' }, ids)).toBeNull();
    expect(sanitizeCustom({ ...good, instrumentId: 'banjo' }, ids)).toBeNull();
    expect(sanitizeCustom({ ...good, strings: ['E2', 'H9'] }, ids)).toBeNull();
    expect(sanitizeCustom({ ...good, strings: [] }, ids)).toBeNull();
    expect(sanitizeCustom({ ...good, strings: Array(9).fill('E2') }, ids)).toBeNull();
    expect(sanitizeCustom({ ...good, strings: ['C9'] }, ids)).toBeNull();
    expect(sanitizeCustom({ ...good, name: 42 }, ids)!.name).toBe('My tuning');
  });

  it('selects presets, customs, and falls back to standard', () => {
    const customs = [sanitizeCustom(good, ids)!] as CustomTuning[];
    expect(selectedTuning('guitar', { guitar: 'drop-d' }, customs).name).toBe('Drop D');
    expect(selectedTuning('guitar', { guitar: 'custom-abc123' }, customs).name).toBe('Open Dsus4');
    expect(selectedTuning('bass', { bass: 'custom-abc123' }, customs).id).toBe('standard'); // other instrument's custom
    expect(selectedTuning('guitar', { guitar: 'custom-gone' }, customs).id).toBe('standard');
    expect(selectedTuning('violin', {}, customs).id).toBe('standard');
    expect(tuningsFor('guitar', customs).custom).toHaveLength(1);
    expect(tuningsFor('bass', customs).custom).toHaveLength(0);
  });

  it('steps notes by semitone and adds strings a fourth away', () => {
    expect(stepNote('E2', -2)).toBe('D2');
    expect(stepNote('B3', 1)).toBe('C4');
    expect(stepNote('A0', -5)).toBe('A0'); // clamped
    expect(extraString(['E2', 'A2'], 'low')).toBe('B1');
    expect(extraString(['G3', 'D4', 'A4', 'E5'], 'high')).toBe('A5');
  });

  it('makes unique ids', () => {
    let k = 0;
    const seq = [0.1, 0.1, 0.2];
    const id = newCustomId([{ id: newCustomId([], () => 0.1) }], () => seq[k++]);
    expect(id).not.toBe(newCustomId([], () => 0.1));
  });

  it('tunes to a custom string list', () => {
    const strings = ['C2', 'G2', 'D3', 'A3', 'E4', 'G4']; // "Nashville-ish" made-up tuning
    const e = new TunerEngine(SR, {
      a4: 440, toleranceCents: 3, mode: 'instrument', instrumentId: 'guitar', tuningId: 'custom-x', strings, lockedString: null,
    });
    const sig = tone({ freq: midiToFreq(nameToMidi('A3')), sampleRate: SR, length: Math.round(0.8 * SR), partials: PLUCK, decay: 3, peak: 0.3 });
    let last: Reading | null = null;
    for (let k = 0; k + 1024 <= sig.length; k += 1024) {
      const r = e.push(Float32Array.from(sig.subarray(k, k + 1024)));
      if (r) last = r;
    }
    expect(last!.targetName).toBe('A3');
    expect(last!.stringIndex).toBe(3);
    // switching tunings rebuilds and clears tuned marks
    e.configure({ strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] });
    expect(e.targetStrings.map((s) => s.name)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  });
});
