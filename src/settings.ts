// User settings, remembered in this browser.

import { INSTRUMENTS } from './instruments';
import { DEFAULT_A4 } from './tuning';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  a4: number;
  toleranceCents: number;
  /** An instrument id, or 'chromatic'. */
  view: string;
  theme: Theme;
  deviceId: string;
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
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    s.a4 = clamp(Number(s.a4) || DEFAULT_A4, A4_MIN, A4_MAX);
    s.toleranceCents = clamp(Number(s.toleranceCents) || 3, TOLERANCE_MIN, TOLERANCE_MAX);
    if (s.view !== 'chromatic' && !INSTRUMENTS.some((i) => i.id === s.view)) s.view = DEFAULTS.view;
    if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = 'system';
    return s;
  } catch {
    return { ...DEFAULTS };
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
