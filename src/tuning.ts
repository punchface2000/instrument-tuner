// Note math in 12-tone equal temperament with an adjustable A4 reference.
// Notes are identified by MIDI number: A4 = 69, C4 = 60, E2 = 40.

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const DEFAULT_A4 = 440;

/** Frequency in Hz of a MIDI note for a given A4 reference. */
export function midiToFreq(midi: number, a4 = DEFAULT_A4): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Fractional MIDI number of a frequency (69.0 = A4 exactly). */
export function freqToMidi(freq: number, a4 = DEFAULT_A4): number {
  return 69 + 12 * Math.log2(freq / a4);
}

/** Deviation in cents of `freq` from `target`. Positive = sharp. */
export function cents(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target);
}

/** "E2", "A#4" … from a MIDI number. */
export function midiToName(midi: number, flats = false): string {
  const names = flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${names[pc]}${octave}`;
}

/** Parse "E2", "A#4", "Bb3" into a MIDI number. Throws on bad input. */
export function nameToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

export interface NearestNote {
  midi: number;
  name: string;
  freq: number; // target frequency of the nearest note
  cents: number; // deviation of the input from that note
}

/** Nearest equal-tempered note to `freq` (chromatic mode). */
export function nearestNote(freq: number, a4 = DEFAULT_A4, flats = false): NearestNote {
  const midi = Math.round(freqToMidi(freq, a4));
  const target = midiToFreq(midi, a4);
  return { midi, name: midiToName(midi, flats), freq: target, cents: cents(freq, target) };
}
