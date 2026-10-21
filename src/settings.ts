// User settings, remembered in this browser.

import { INSTRUMENTS } from './instruments';
import { sanitizeCustom, type CustomTuning } from './tunings';
import { DEFAULT_A4 } from './tuning';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  a4: number;
  toleranceCents: number;
  /** An instrument id, or 'chromatic'. */
  view: string;
  theme: Theme;
  deviceId: string;
  /** Channel of a multi-channel input (0-based), or -1 to mix all channels. */
  channel: number;
  /** Selected tuning per instrument: instrument id → tuning id (preset or custom). */
  tunings: Record<string, string>;
  /** Tunings the user made. */
  customTunings: CustomTuning[];
}

export const A4_MIN = 415;
export const A4_MAX = 466;
export const TOLERANCE_MIN = 1;
export const TOLERANCE_MAX = 10;

const KEY = 'tuner.settings.v1';

export const DEFAULTS: Settings = {
  a4: DEFAULT_A4,
  toleranceCents: 3,
  view: 'guitar',
  theme: 'system',
  deviceId: '',
  channel: -1,
  tunings: {},
  customTunings: [],
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, tunings: {}, customTunings: [] };
    const s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    s.a4 = clamp(Number(s.a4) || DEFAULT_A4, A4_MIN, A4_MAX);
    s.toleranceCents = clamp(Number(s.toleranceCents) || 3, TOLERANCE_MIN, TOLERANCE_MAX);
    if (s.view !== 'chromatic' && !INSTRUMENTS.some((i) => i.id === s.view)) s.view = DEFAULTS.view;
    if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = 'system';
    if (!Number.isInteger(s.channel) || s.channel < -1 || s.channel > 7) s.channel = -1;
    const ids = INSTRUMENTS.map((i) => i.id);
    s.customTunings = (Array.isArray(s.customTunings) ? s.customTunings : [])
      .map((c) => sanitizeCustom(c, ids))
      .filter((c): c is CustomTuning => c !== null)
      .slice(0, 50);
    const sel: Record<string, string> = {};
    if (s.tunings && typeof s.tunings === 'object') {
      for (const [k, v] of Object.entries(s.tunings)) if (ids.includes(k) && typeof v === 'string') sel[k] = v;
    }
    s.tunings = sel;
    return s;
  } catch {
    return { ...DEFAULTS, tunings: {}, customTunings: [] };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode, embedded preview): settings last for this visit */
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
