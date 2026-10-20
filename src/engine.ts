// TunerEngine: turns a stream of microphone samples into tuner readings.
// No DOM access, so it runs the same way in the browser and in tests.
//
//   samples → low-pass pre-filter → sliding frame → YIN every ~20 ms
//           → median of recent readings → target string / note → Reading

import { YinDetector } from './pitch/yin';
import { LowpassFilter } from './pitch/filter';
import { detectorConfig, chromaticLowpass } from './pitch/config';
import { CHROMATIC_RANGE, detectionRange, findInstrument, resolveStrings, type ResolvedString } from './instruments';
import { cents, midiToFreq, nameToMidi, nearestNote } from './tuning';

export type Mode = 'instrument' | 'chromatic';

export interface EngineSettings {
  a4: number;
  toleranceCents: number;
  mode: Mode;
  instrumentId: string;
  tuningId: string;
  /** Physical string index the user tapped to lock, or null for automatic. */
  lockedString: number | null;
}

export interface Reading {
  /** A note is sounding now, or was until very recently (see `held`). */
  active: boolean;
  /** True while showing the last note after the sound stopped. */
  held: boolean;
  freq: number;
  /** Deviation from the target in cents (positive = sharp). */
  cents: number;
  targetName: string;
  targetFreq: number;
  /** Physical index of the target string (instrument mode), else null. */
  stringIndex: number | null;
  inTune: boolean;
  /** 0–1 periodicity of the latest frame. */
  confidence: number;
  /** Input level of the latest frame in dBFS. */
  levelDb: number;
}

/** Time between detections. */
const HOP_SECONDS = 0.02;
/** Readings combined by the median filter. */
const MEDIAN_SIZE = 5;
/** How long the last note stays on screen after the sound stops. */
const HOLD_SECONDS = 1.5;
/** Unvoiced time after which the median history restarts (a new note). */
const RESET_SECONDS = 0.25;
/** Auto mode keeps the current string unless another is closer by this much. */
const STRING_HYSTERESIS_CENTS = 30;
/** Time a string must stay within tolerance before it counts as tuned. */
const TUNED_SECONDS = 0.4;

export class TunerEngine {
  readonly sampleRate: number;
  private settings: EngineSettings;
  private strings: ResolvedString[] = [];
  private detector!: YinDetector;
  private filter!: LowpassFilter;
  private frame!: Float32Array;
  private sinceHop = 0;
  private readonly hop: number;

  private history: number[] = [];
  private lastVoicedAt = -Infinity;
  private now = 0; // seconds of audio processed
  private autoString: number | null = null;
  private inTuneSince: number | null = null;
  private last: Reading | null = null;

  /** Strings that have been brought in tune since the last reset. */
  readonly tuned = new Set<number>();

  constructor(sampleRate: number, settings: EngineSettings) {
    this.sampleRate = sampleRate;
    this.hop = Math.round(sampleRate * HOP_SECONDS);
    this.settings = { ...settings };
    this.rebuild();
  }

  get currentSettings(): Readonly<EngineSettings> {
    return this.settings;
  }

  get targetStrings(): readonly ResolvedString[] {
    return this.strings;
  }

  /** Apply new settings; rebuilds the detector only when its range changes. */
  configure(next: Partial<EngineSettings>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...next };
    const s = this.settings;
    const rangeChanged =
      s.mode !== prev.mode || s.instrumentId !== prev.instrumentId || s.tuningId !== prev.tuningId || s.a4 !== prev.a4;
    if (s.instrumentId !== prev.instrumentId || s.tuningId !== prev.tuningId || s.mode !== prev.mode) {
      this.tuned.clear();
    }
    if (rangeChanged) this.rebuild();
    if (s.lockedString !== prev.lockedString) {
      this.autoString = null;
      this.inTuneSince = null;
    }
  }

  /** Forget the current note (e.g. while a reference tone plays). */
  reset(): void {
    this.history = [];
    this.lastVoicedAt = -Infinity;
    this.autoString = null;
    this.inTuneSince = null;
    this.frame.fill(0);
    this.last = null;
  }

  clearTuned(): void {
    this.tuned.clear();
  }

  private rebuild(): void {
    const s = this.settings;
    const inst = findInstrument(s.instrumentId);
    const tuning = inst.tunings.find((t) => t.id === s.tuningId) ?? inst.tunings[0];
    this.strings = resolveStrings(tuning, s.a4);
    let fMin: number;
    let fMax: number;
    if (s.mode === 'chromatic') {
      fMin = midiToFreq(nameToMidi(CHROMATIC_RANGE.low), s.a4) * 0.97;
      fMax = midiToFreq(nameToMidi(CHROMATIC_RANGE.high), s.a4) * 1.03;
    } else {
      ({ fMin, fMax } = detectionRange(tuning, s.a4));
    }
    const cfg = detectorConfig(this.sampleRate, fMin, fMax);
    this.detector = new YinDetector(cfg.yin);
    const cutoff = s.mode === 'chromatic' ? chromaticLowpass(undefined, this.sampleRate) : cfg.lowpassHz;
    this.filter = new LowpassFilter(this.sampleRate, cutoff);
    this.frame = new Float32Array(this.detector.frameSize);
    this.history = [];
    this.autoString = null;
    this.inTuneSince = null;
    this.last = null;
  }

  /**
   * Feed a block of samples. Returns the newest reading if at least one
   * detection ran during this block, otherwise null.
   */
  push(block: Float32Array): Reading | null {
    let reading: Reading | null = null;
    let offset = 0;
    while (offset < block.length) {
      const n = Math.min(this.hop - this.sinceHop, block.length - offset);
      const chunk = block.subarray(offset, offset + n);
      // slide the frame left and append the filtered chunk
      const f = this.frame;
      f.copyWithin(0, n);
      const tail = f.subarray(f.length - n);
      this.filter.process(chunk, tail);
      offset += n;
      this.sinceHop += n;
      this.now += n / this.sampleRate;
      if (this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        reading = this.analyse();
      }
    }
    return reading;
  }

  private analyse(): Reading {
    const r = this.detector.detect(this.frame);
    const levelDb = r.rms > 0 ? 20 * Math.log10(r.rms) : -120;
    const s = this.settings;

    if (r.voiced && Number.isFinite(r.freq)) {
      if (this.now - this.lastVoicedAt > RESET_SECONDS) this.history = [];
      this.lastVoicedAt = this.now;
      this.history.push(r.freq);
      if (this.history.length > MEDIAN_SIZE) this.history.shift();
    }

    const sinceVoiced = this.now - this.lastVoicedAt;
    if (this.history.length === 0 || sinceVoiced > HOLD_SECONDS) {
      this.inTuneSince = null;
      if (sinceVoiced > HOLD_SECONDS) this.autoString = null;
      if (s.mode === 'chromatic') this.filter.setCutoff(this.sampleRate, chromaticLowpass(undefined, this.sampleRate));
      this.last = null;
      return this.empty(r.confidence, levelDb);
    }

    const held = sinceVoiced > 0;
    if (held && this.last) {
      // keep showing the last note, with fresh level/confidence
      return { ...this.last, held: true, confidence: r.confidence, levelDb };
    }

    const freq = median(this.history);
    let reading: Reading;
    if (s.mode === 'chromatic') {
      this.filter.setCutoff(this.sampleRate, chromaticLowpass(freq, this.sampleRate));
      const n = nearestNote(freq, s.a4);
      reading = {
        active: true, held: false, freq, cents: n.cents, targetName: n.name, targetFreq: n.freq,
        stringIndex: null, inTune: Math.abs(n.cents) <= s.toleranceCents, confidence: r.confidence, levelDb,
      };
    } else {
      const target = this.pickString(freq);
      const c = cents(freq, target.freq);
      reading = {
        active: true, held: false, freq, cents: c, targetName: target.name, targetFreq: target.freq,
        stringIndex: target.index, inTune: Math.abs(c) <= s.toleranceCents, confidence: r.confidence, levelDb,
      };
    }

    if (reading.inTune) {
      this.inTuneSince ??= this.now;
      if (reading.stringIndex !== null && this.now - this.inTuneSince >= TUNED_SECONDS) {
        this.tuned.add(reading.stringIndex);
      }
    } else {
      this.inTuneSince = null;
    }
    this.last = reading;
    return reading;
  }

  private pickString(freq: number): ResolvedString {
    const locked = this.settings.lockedString;
    if (locked !== null && this.strings[locked]) return this.strings[locked];
    let best = this.strings[0];
    let bestDist = Infinity;
    for (const st of this.strings) {
      const d = Math.abs(cents(freq, st.freq));
      if (d < bestDist) { bestDist = d; best = st; }
    }
    if (this.autoString !== null && this.autoString !== best.index) {
      const cur = this.strings[this.autoString];
      if (cur && Math.abs(cents(freq, cur.freq)) <= bestDist + STRING_HYSTERESIS_CENTS) return cur;
    }
    if (this.autoString !== best.index) this.inTuneSince = null;
    this.autoString = best.index;
    return best;
  }

  private empty(confidence: number, levelDb: number): Reading {
    return {
      active: false, held: false, freq: NaN, cents: 0, targetName: '', targetFreq: NaN,
      stringIndex: this.settings.lockedString, inTune: false, confidence, levelDb,
    };
  }
}

function median(values: number[]): number {
  const a = values.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
