import { describe, expect, it } from 'vitest';
import { YinDetector } from '../src/pitch/yin';
import { LowpassFilter } from '../src/pitch/filter';
import { detectorConfig } from '../src/pitch/config';
import { INSTRUMENTS, detectionRange, resolveStrings } from '../src/instruments';
import { cents, midiToFreq, nameToMidi, midiToName, nearestNote } from '../src/tuning';
import { tone, whiteNoise, PLUCK } from '../bench/signals';

const SR = 48000; // typical browser rate (the benchmark uses 44.1 kHz)

function detect(inst: (typeof INSTRUMENTS)[number], freq: number, snrDb?: number) {
  const { fMin, fMax } = detectionRange(inst.tunings[0], 440);
  const cfg = detectorConfig(SR, fMin, fMax);
  const yin = new YinDetector(cfg.yin);
  const sig = tone({ freq, sampleRate: SR, length: yin.frameSize + 2048, partials: PLUCK, decay: 1.5, snrDb, seed: 5 });
  const lp = new LowpassFilter(SR, cfg.lowpassHz);
  const y = new Float64Array(sig.length);
  lp.process(sig, y);
  return yin.detect(y);
}

describe('tuning math', () => {
  it('maps note names and frequencies', () => {
    expect(nameToMidi('A4')).toBe(69);
    expect(nameToMidi('E2')).toBe(40);
    expect(nameToMidi('Bb3')).toBe(nameToMidi('A#3'));
    expect(midiToName(61)).toBe('C#4');
    expect(midiToFreq(69, 442)).toBeCloseTo(442, 9);
    expect(midiToFreq(nameToMidi('E2'))).toBeCloseTo(82.4069, 3);
    expect(cents(440 * 2 ** (5 / 1200), 440)).toBeCloseTo(5, 9);
  });

  it('finds the nearest note with an adjustable reference', () => {
    const n = nearestNote(445, 440);
    expect(n.name).toBe('A4');
    expect(n.cents).toBeCloseTo(cents(445, 440), 9);
    expect(nearestNote(432, 432).cents).toBeCloseTo(0, 9);
  });
});

describe('YIN detector', () => {
  for (const inst of INSTRUMENTS) {
    for (const s of resolveStrings(inst.tunings[0], 440)) {
      it(`${inst.name} ${s.name}: within 1 cent, 7 cents sharp`, () => {
        const truth = s.freq * 2 ** (7 / 1200);
        const r = detect(inst, truth);
        expect(r.voiced).toBe(true);
        expect(Math.abs(cents(r.freq, truth))).toBeLessThan(1);
      });
      it(`${inst.name} ${s.name}: within 3 cents at 15 dB SNR`, () => {
        const r = detect(inst, s.freq, 15);
        expect(r.voiced).toBe(true);
        expect(Math.abs(cents(r.freq, s.freq))).toBeLessThan(3);
      });
    }
  }

  it('rejects silence and white noise', () => {
    const yin = new YinDetector(detectorConfig(SR, 30, 4300).yin);
    expect(yin.detect(new Float64Array(yin.frameSize)).voiced).toBe(false);
    expect(yin.detect(whiteNoise(yin.frameSize, 0.5, 21)).voiced).toBe(false);
  });
});
