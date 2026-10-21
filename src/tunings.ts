// Tuning selection and custom tunings: pure logic, no DOM.
//
// Preset tunings live in instruments.ts. Custom tunings are made by the user,
// belong to one instrument, and are saved in settings. A selection maps each
// instrument to the id of its current tuning (preset id or custom id).

import { findInstrument, STRING_COUNT_RANGE, STRING_NOTE_RANGE, type Tuning } from './instruments';
import { midiToName, nameToMidi } from './tuning';

export interface CustomTuning extends Tuning {
  instrumentId: string;
  custom: true;
}

export const CUSTOM_NAME_MAX = 30;

const LOW = nameToMidi(STRING_NOTE_RANGE.low);
const HIGH = nameToMidi(STRING_NOTE_RANGE.high);

/** Is this a note name the tuner can use for a string? */
export function isValidStringNote(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  try {
    const m = nameToMidi(name);
    return m >= LOW && m <= HIGH;
  } catch {
    return false;
  }
}

/** Clean up a saved custom tuning; null if it can't be used. Old or hand-edited data never breaks the app. */
export function sanitizeCustom(raw: unknown, knownInstruments: string[]): CustomTuning | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.startsWith('custom-')) return null;
  if (typeof r.instrumentId !== 'string' || !knownInstruments.includes(r.instrumentId)) return null;
  if (!Array.isArray(r.strings)) return null;
  const strings = r.strings.filter(isValidStringNote);
  if (strings.length !== r.strings.length) return null;
  if (strings.length < STRING_COUNT_RANGE.min || strings.length > STRING_COUNT_RANGE.max) return null;
  const name = (typeof r.name === 'string' ? r.name : '').trim().slice(0, CUSTOM_NAME_MAX) || 'My tuning';
  return { id: r.id, instrumentId: r.instrumentId, name, strings, custom: true };
}

/** Presets and the user's own tunings for one instrument. */
export function tuningsFor(instrumentId: string, customs: CustomTuning[]): { presets: Tuning[]; custom: CustomTuning[] } {
  return {
    presets: findInstrument(instrumentId).tunings,
    custom: customs.filter((c) => c.instrumentId === instrumentId),
  };
}

/** The tuning currently selected for an instrument, falling back to its first preset. */
export function selectedTuning(
  instrumentId: string,
  selection: Record<string, string>,
  customs: CustomTuning[],
): Tuning | CustomTuning {
  const id = selection[instrumentId];
  const inst = findInstrument(instrumentId);
  return (
    inst.tunings.find((t) => t.id === id) ??
    customs.find((c) => c.id === id && c.instrumentId === instrumentId) ??
    inst.tunings[0]
  );
}

/** Move a string's note by `semitones`, staying within the allowed range. Uses sharps. */
export function stepNote(name: string, semitones: number): string {
  const m = Math.min(HIGH, Math.max(LOW, nameToMidi(name) + semitones));
  return midiToName(m);
}

/** A string to add below the lowest or above the highest, a fourth away (like most string instruments). */
export function extraString(strings: string[], where: 'low' | 'high'): string {
  if (!strings.length) return 'E2';
  const midis = strings.map(nameToMidi);
  const m = where === 'low' ? Math.max(LOW, Math.min(...midis) - 5) : Math.min(HIGH, Math.max(...midis) + 5);
  return midiToName(m);
}

/** A new, unique id for a custom tuning. */
export function newCustomId(existing: { id: string }[], random = Math.random): string {
  for (;;) {
    const id = `custom-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
    if (!existing.some((e) => e.id === id)) return id;
  }
}

/** A default name for a new tuning: the string letters, e.g. "DADGBE". */
export function defaultCustomName(strings: string[]): string {
  return strings.map((n) => n.replace(/-?\d+$/, '')).join(' ').slice(0, CUSTOM_NAME_MAX);
}
