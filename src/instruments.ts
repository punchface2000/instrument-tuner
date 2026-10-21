// Instrument definitions. This file is pure data: to add an instrument or a
// tuning, add an entry below. Strings are listed from lowest-pitched course
// to highest as they appear on the instrument (for re-entrant tunings such as
// ukulele GCEA, list them in physical order; the app sorts by pitch where it
// needs to).

import { midiToFreq, nameToMidi } from './tuning';

export interface Tuning {
  id: string;
  name: string;
  /** Note names in physical string order, e.g. ['E2','A2','D3','G3','B3','E4']. */
  strings: string[];
}

export interface Instrument {
  id: string;
  name: string;
  tunings: Tuning[];
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: 'guitar',
    name: 'Guitar',
    tunings: [
      { id: 'standard', name: 'Standard', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
      { id: 'drop-d', name: 'Drop D', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
      { id: 'half-down', name: 'Half step down', strings: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
      { id: 'full-down', name: 'Full step down', strings: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
      { id: 'drop-c', name: 'Drop C', strings: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'] },
      { id: 'dadgad', name: 'DADGAD', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
      { id: 'open-g', name: 'Open G', strings: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
      { id: 'open-d', name: 'Open D', strings: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
      { id: 'open-e', name: 'Open E', strings: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'] },
      { id: 'open-c', name: 'Open C', strings: ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'] },
      { id: 'seven', name: '7-string', strings: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    ],
  },
  {
    id: 'ukulele',
    name: 'Ukulele',
    tunings: [
      { id: 'standard', name: 'Standard (high G)', strings: ['G4', 'C4', 'E4', 'A4'] },
      { id: 'low-g', name: 'Low G', strings: ['G3', 'C4', 'E4', 'A4'] },
      { id: 'd-tuning', name: 'D tuning', strings: ['A4', 'D4', 'F#4', 'B4'] },
      { id: 'baritone', name: 'Baritone', strings: ['D3', 'G3', 'B3', 'E4'] },
    ],
  },
  {
    id: 'bass',
    name: 'Bass',
    tunings: [
      { id: 'standard', name: 'Standard', strings: ['E1', 'A1', 'D2', 'G2'] },
      { id: 'drop-d', name: 'Drop D', strings: ['D1', 'A1', 'D2', 'G2'] },
      { id: 'half-down', name: 'Half step down', strings: ['Eb1', 'Ab1', 'Db2', 'Gb2'] },
      { id: 'five', name: '5-string', strings: ['B0', 'E1', 'A1', 'D2', 'G2'] },
      { id: 'six', name: '6-string', strings: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'] },
    ],
  },
  {
    id: 'violin',
    name: 'Violin',
    tunings: [
      { id: 'standard', name: 'Standard', strings: ['G3', 'D4', 'A4', 'E5'] },
      { id: 'cross-a', name: 'Cross A (AEAE)', strings: ['A3', 'E4', 'A4', 'E5'] },
      { id: 'cross-g', name: 'Cross G (GDGD)', strings: ['G3', 'D4', 'G4', 'D5'] },
      { id: 'viola', name: 'Viola', strings: ['C3', 'G3', 'D4', 'A4'] },
    ],
  },
];

/** Lowest and highest notes a custom tuning may use. */
export const STRING_NOTE_RANGE = { low: 'A0', high: 'C7' };
/** Number of strings a custom tuning may have. */
export const STRING_COUNT_RANGE = { min: 1, max: 8 };

/** Letter names of a tuning, e.g. "EADGBE" or "D A D F♯ A D" when accidentals are present. */
export function tuningLetters(strings: string[]): string {
  const letters = strings.map((n) => n.replace(/-?\d+$/, '').replace('#', '♯').replace(/^([A-G])b$/, '$1♭'));
  return letters.some((l) => l.length > 1) ? letters.join(' ') : letters.join('');
}

/** Range used by chromatic mode. */
export const CHROMATIC_RANGE = { low: 'B0', high: 'C8' };

export interface ResolvedString {
  index: number; // physical string index
  name: string;
  midi: number;
  freq: number;
}

export function resolveStrings(tuning: Tuning, a4: number): ResolvedString[] {
  return tuning.strings.map((name, index) => {
    const midi = nameToMidi(name);
    return { index, name, midi, freq: midiToFreq(midi, a4) };
  });
}

/**
 * Frequency range the detector should search for a tuning: from about four
 * semitones below the lowest string (badly detuned strings still register)
 * to about five semitones above the highest.
 */
export function detectionRange(tuning: Tuning, a4: number): { fMin: number; fMax: number } {
  const freqs = resolveStrings(tuning, a4).map((s) => s.freq);
  return { fMin: Math.min(...freqs) * 0.79, fMax: Math.max(...freqs) * 1.34 };
}

export function findInstrument(id: string): Instrument {
  const inst = INSTRUMENTS.find((i) => i.id === id);
  if (!inst) throw new Error(`Unknown instrument: ${id}`);
  return inst;
}
