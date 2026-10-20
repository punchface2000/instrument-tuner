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
    tunings: [{ id: 'standard', name: 'Standard (EADGBE)', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }],
  },
  {
    id: 'ukulele',
    name: 'Ukulele',
    tunings: [{ id: 'standard', name: 'Standard (GCEA, high G)', strings: ['G4', 'C4', 'E4', 'A4'] }],
  },
  {
    id: 'bass',
    name: 'Bass',
    tunings: [{ id: 'standard', name: 'Standard 4-string (EADG)', strings: ['E1', 'A1', 'D2', 'G2'] }],
  },
  {
    id: 'violin',
    name: 'Violin',
    tunings: [{ id: 'standard', name: 'Standard (GDAE)', strings: ['G3', 'D4', 'A4', 'E5'] }],
  },
];

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
