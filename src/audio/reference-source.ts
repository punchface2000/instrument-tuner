// Which sound plays a reference note: a recorded sample (shifted a little) or
// the modelled string. Pure logic, unit-tested.

import manifest from './samples.json';
import { midiToFreq } from '../tuning';

export interface SampleFile {
  note: string;
  midi: number;
  file: string;
  /** Residual offset of the recording as the tuner reads it; playback corrects it. */
  cents: number;
}

export interface SampleSet {
  maxDown: number;
  maxUp: number;
  credit: string;
  files: SampleFile[];
}

export const SAMPLES = manifest as Record<string, SampleSet>;

export type Source =
  | { kind: 'sample'; file: string; rate: number; shift: number }
  | { kind: 'model'; voice: string; freq: number };

/**
 * Pick the sound for `midi` on `instrumentId` at the given A4 reference.
 * Uses the nearest recording within the instrument's allowed shift (shifting
 * down is preferred on ties: it sounds more natural than shifting up),
 * otherwise the modelled plucked string.
 */
export function chooseSource(instrumentId: string, midi: number, a4: number, sets = SAMPLES): Source {
  const target = midiToFreq(midi, a4);
  const set = sets[instrumentId];
  if (set) {
    let best: SampleFile | null = null;
    let bestShift = 0;
    for (const f of set.files) {
      const shift = midi - f.midi; // semitones the sample must move
      if (shift < -set.maxDown || shift > set.maxUp) continue;
      const better =
        !best || Math.abs(shift) < Math.abs(bestShift) || (Math.abs(shift) === Math.abs(bestShift) && shift < bestShift);
      if (better) {
        best = f;
        bestShift = shift;
      }
    }
    if (best) {
      const recorded = midiToFreq(best.midi, 440) * Math.pow(2, best.cents / 1200);
      return { kind: 'sample', file: best.file, rate: target / recorded, shift: bestShift };
    }
  }
  return { kind: 'model', voice: instrumentId, freq: target };
}
