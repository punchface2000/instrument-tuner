// One place that turns a frequency range into detector settings, so the app
// and the benchmark always use identical parameters.

import type { YinOptions } from './yin';

export interface DetectorConfig {
  yin: YinOptions;
  /** Low-pass cutoff for the streaming pre-filter (Hz). */
  lowpassHz: number;
  /** High-pass cutoff for the streaming pre-filter (Hz). */
  highpassHz: number;
}

/** High-pass cutoff as a fraction of the lowest frequency searched for. */
export const HIGHPASS_FACTOR = 0.6;

/** Low-pass cutoff as a multiple of the highest fundamental searched for. */
export const LOWPASS_FACTOR = 6;
/** Integration window as a multiple of the longest period searched for. */
export const WINDOW_PERIODS = 2;

/**
 * Chromatic mode has no fixed upper note, so its pre-filter follows the
 * detected pitch instead: cutoff = LOWPASS_FACTOR × recent f0, never below
 * this floor (so the next, higher note is not filtered away before it can
 * be detected).
 */
export const CHROMATIC_LOWPASS_FLOOR_HZ = 1500;

export function chromaticLowpass(recentF0: number | undefined, sampleRate: number): number {
  if (!recentF0 || !Number.isFinite(recentF0)) return 0.45 * sampleRate; // bypass until a note is found
  return Math.min(Math.max(LOWPASS_FACTOR * recentF0 * 1.5, CHROMATIC_LOWPASS_FLOOR_HZ), 0.45 * sampleRate);
}

export function detectorConfig(sampleRate: number, fMin: number, fMax: number, threshold = 0.12): DetectorConfig {
  const tauMax = Math.ceil(sampleRate / fMin);
  return {
    yin: {
      sampleRate,
      fMin,
      fMax,
      threshold,
      windowSize: Math.max(WINDOW_PERIODS * tauMax, Math.round(sampleRate * 0.0213)),
    },
    lowpassHz: Math.min(LOWPASS_FACTOR * fMax, 0.45 * sampleRate),
    highpassHz: Math.max(20, HIGHPASS_FACTOR * fMin),
  };
}
