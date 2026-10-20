// Pitch-detection benchmark: original MATLAB algorithm (ported as-is) vs the
// fixed YIN, on synthetic tones for every string of every instrument.
//
//   npm run bench            → prints a report and writes bench/results.md
//
// Error is measured in cents against the true synthesised fundamental.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { legacyDetectPitch } from '../src/pitch/legacy';
import { YinDetector, type PitchResult } from '../src/pitch/yin';
import { LowpassFilter } from '../src/pitch/filter';
import { detectorConfig, chromaticLowpass, type DetectorConfig } from '../src/pitch/config';
import { INSTRUMENTS, detectionRange, resolveStrings, CHROMATIC_RANGE } from '../src/instruments';
import { cents, midiToFreq, nameToMidi } from '../src/tuning';
import { tone, whiteNoise, PLUCK, WEAK_FUNDAMENTAL, type ToneSpec } from './signals';

const SR = 44100; // the original app's sample rate, so the comparison is like-for-like
const LEGACY_FRAME = Math.round(0.2 * SR); // FrameDuration = 0.2 s
const LEGACY_THRESHOLD = 0.1;
const DETUNE_CENTS = [-30, -10, -3, 0, 3, 10, 30];
const SEEDS = [1, 2, 3];
const IN_TUNE = 3; // ± cents counted as accurate
const GROSS = 50; // |error| above this = wrong note / octave error

type Scenario = { id: string; label: string; spec: Partial<ToneSpec> };
const SCENARIOS: Scenario[] = [
  { id: 'sine', label: 'Pure sine', spec: { partials: [1] } },
  { id: 'pluck', label: 'Plucked string (12 harmonics, decaying)', spec: { partials: PLUCK, decay: 1.5 } },
  { id: 'weakf0', label: 'Weak fundamental (−20 dB), like a phone mic on bass', spec: { partials: WEAK_FUNDAMENTAL, decay: 1.5 } },
  { id: 'noisy', label: 'Plucked + white noise at 15 dB SNR', spec: { partials: PLUCK, decay: 1.5, snrDb: 15 } },
  { id: 'dc', label: 'Plucked + DC offset (0.1)', spec: { partials: PLUCK, decay: 1.5, dc: 0.1, peak: 0.4 } },
];

interface Stats { n: number; inTune: number; sumAbs: number; maxAbs: number; gross: number; failed: number; }
const newStats = (): Stats => ({ n: 0, inTune: 0, sumAbs: 0, maxAbs: 0, gross: 0, failed: 0 });

function record(s: Stats, detected: number, truth: number) {
  s.n++;
  if (!Number.isFinite(detected) || detected <= 0) { s.failed++; return; }
  const e = Math.abs(cents(detected, truth));
  if (e > GROSS) { s.gross++; return; }
  if (e <= IN_TUNE) s.inTune++;
  s.sumAbs += e;
  s.maxAbs = Math.max(s.maxAbs, e);
}

function fmt(s: Stats): string[] {
  const ok = s.n - s.gross - s.failed;
  return [
    `${((100 * s.inTune) / s.n).toFixed(0)}%`,
    ok > 0 ? (s.sumAbs / ok).toFixed(2) : '–',
    ok > 0 ? s.maxAbs.toFixed(1) : '–',
    `${s.gross + s.failed}`,
  ];
}

/** Samples of signal fed through the pre-filter before the analysed frame (filter settling). */
const WARMUP = 2048;

/** Run the new pipeline the way the app does: stream through the low-pass, then YIN on the latest frame. */
function runNew(yin: YinDetector, lowpassHz: number, sig: Float64Array): PitchResult {
  const lp = new LowpassFilter(SR, lowpassHz);
  const y = new Float64Array(sig.length);
  lp.process(sig, y);
  return yin.detect(y);
}

const out: string[] = [];
const log = (line = '') => { out.push(line); console.log(line); };

log('# Pitch detector benchmark');
log();
log(`Sample rate ${SR} Hz. Each cell covers every string × detune {${DETUNE_CENTS.join(', ')}} cents × ${SEEDS.length} random phases.`);
log(`**In tune** = share of detections within ±${IN_TUNE} cents of the true pitch. **Mean/Max** = absolute cents error over non-gross detections. **Wrong** = gross errors (> ${GROSS} cents, i.e. wrong note or octave) plus failed detections.`);
log();
log('Legacy = original MATLAB DetectPitch ported as-is (0.2 s frame, threshold 0.1). New = fixed YIN with a streaming low-pass pre-filter (6 × highest string), window = 2 × longest period, threshold 0.12.');
log();

const timing = { legacy: { ms: 0, n: 0 }, yin: { ms: 0, n: 0 } };

for (const sc of SCENARIOS) {
  log(`## ${sc.label}`);
  log();
  log('| Instrument | Legacy in tune | Legacy mean | Legacy max | Legacy wrong | New in tune | New mean | New max | New wrong |');
  log('|---|---|---|---|---|---|---|---|---|');
  for (const inst of INSTRUMENTS) {
    const tuning = inst.tunings[0];
    const { fMin, fMax } = detectionRange(tuning, 440);
    const cfg: DetectorConfig = detectorConfig(SR, fMin, fMax);
    const yin = new YinDetector(cfg.yin);
    const length = Math.max(LEGACY_FRAME, yin.frameSize + WARMUP);
    const L = newStats();
    const Y = newStats();
    for (const str of resolveStrings(tuning, 440)) {
      for (const dc of DETUNE_CENTS) {
        for (const seed of SEEDS) {
          const truth = str.freq * Math.pow(2, dc / 1200);
          const sig = tone({ freq: truth, sampleRate: SR, length, seed, ...sc.spec });
          let t0 = performance.now();
          const lp = legacyDetectPitch(sig.subarray(sig.length - LEGACY_FRAME), SR, LEGACY_THRESHOLD);
          timing.legacy.ms += performance.now() - t0; timing.legacy.n++;
          record(L, lp, truth);
          t0 = performance.now();
          const r = runNew(yin, cfg.lowpassHz, sig);
          timing.yin.ms += performance.now() - t0; timing.yin.n++;
          record(Y, r.voiced ? r.freq : NaN, truth);
        }
      }
    }
    log(`| ${inst.name} | ${fmt(L).join(' | ')} | ${fmt(Y).join(' | ')} |`);
  }
  log();
}

// Chromatic mode uses one wide range for everything; check it still works.
log('## New YIN in chromatic mode (one detector, range B0–C8)');
log();
{
  const fMin = midiToFreq(nameToMidi(CHROMATIC_RANGE.low)) * 0.97;
  const fMax = midiToFreq(nameToMidi(CHROMATIC_RANGE.high)) * 1.03;
  const yin = new YinDetector(detectorConfig(SR, fMin, fMax).yin);
  log(`Window ${yin.windowSize} samples, frame ${yin.frameSize} samples (${((1000 * yin.frameSize) / SR).toFixed(0)} ms).`);
  log('The pre-filter follows the detected note: a first pass finds the note, then the cutoff is set from it (as the app does once a note is sounding).');
  log();
  log('| Scenario | In tune | Mean | Max | Wrong |');
  log('|---|---|---|---|---|');
  for (const sc of SCENARIOS) {
    const Y = newStats();
    for (const inst of INSTRUMENTS) {
      for (const str of resolveStrings(inst.tunings[0], 440)) {
        for (const dc of DETUNE_CENTS) {
          for (const seed of SEEDS) {
            const truth = str.freq * Math.pow(2, dc / 1200);
            const sig = tone({ freq: truth, sampleRate: SR, length: yin.frameSize + WARMUP, seed, ...sc.spec });
            const coarse = runNew(yin, chromaticLowpass(undefined, SR), sig);
            const r = runNew(yin, chromaticLowpass(coarse.voiced ? coarse.freq : undefined, SR), sig);
            record(Y, r.voiced ? r.freq : NaN, truth);
          }
        }
      }
    }
    log(`| ${sc.label} | ${fmt(Y).join(' | ')} |`);
  }
  log();
}

// Rejection: silence and pure noise should not produce a pitch.
log('## Rejection of non-pitched input');
log();
{
  const yin = new YinDetector(detectorConfig(SR, 30, 4300).yin);
  const len = Math.max(LEGACY_FRAME, yin.frameSize);
  const silence = new Float64Array(len);
  const quiet = whiteNoise(len, 0.002, 3);
  log('| Input | Legacy result | New result |');
  log('|---|---|---|');
  const show = (name: string, sig: Float64Array) => {
    const lp = legacyDetectPitch(sig.subarray(sig.length - LEGACY_FRAME), SR, LEGACY_THRESHOLD);
    const r = yin.detect(sig);
    const legacyTxt = lp > 0 && Number.isFinite(lp) ? `reports ${lp.toFixed(1)} Hz` : 'no pitch';
    const newTxt = r.voiced ? `reports ${r.freq.toFixed(1)} Hz (conf ${r.confidence.toFixed(2)})` : `no pitch (conf ${r.confidence.toFixed(2)})`;
    log(`| ${name} | ${legacyTxt} | ${newTxt} |`);
  };
  show('Silence', silence);
  show('Very quiet noise (−54 dBFS peak)', quiet);
  for (const seed of [11, 12, 13]) show(`Loud white noise (seed ${seed})`, whiteNoise(len, 0.5, seed));
  log();
}

log('## Speed (this machine, Node)');
log();
log(`- Legacy: ${(timing.legacy.ms / timing.legacy.n).toFixed(2)} ms per frame, one result every 200 ms (0.2 s frames)`);
log(`- New: ${(timing.yin.ms / timing.yin.n).toFixed(2)} ms per frame; frames can overlap, so 20–40 results per second are practical`);

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'results.md'), out.join('\n') + '\n');
