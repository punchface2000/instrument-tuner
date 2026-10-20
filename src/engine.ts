// TunerEngine: turns a stream of microphone samples into tuner readings.
// No DOM access, so it runs the same way in the browser and in tests.
//
//   samples → low-pass pre-filter → sliding frame → YIN every ~20 ms
//           → median of recent readings → target string / note → Reading

import { YinDetector } from './pitch/yin';
import { LowpassFilter, HighpassFilter } from './pitch/filter';
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

/**
 * Tunable constants. Exported so the responsiveness benchmark can try
 * variations; the app uses these defaults.
 */
export const ENGINE_TUNING = {
  /** Shortest time between detections… */
  hopSeconds: 0.01,
  /** …but at least this fraction of the analysis frame (longer frames for low notes). */
  hopFrameFraction: 1 / 6,
  /** Longest time between detections. */
  maxHopSeconds: 0.02,
  /** Readings combined by the median filter while the note is strong… */
  medianSize: 5,
  /** …growing to this many as the note fades towards the noise floor. */
  medianSizeFaint: 15,
  /** Signal-to-noise ratio (dB) above which the short median is used. */
  strongSnrDb: 25,
  /** How long the last note stays on screen after the sound stops. */
  holdSeconds: 1.5,
  /** Gaps shorter than this are bridged without dimming the display. */
  bridgeSeconds: 0.15,
  /** Gap after which the next sound counts as a new note. */
  resetSeconds: 0.25,
  /** Auto mode keeps the current string unless another is closer by this much. */
  stringHysteresisCents: 30,
  /** Time a string must stay within tolerance before it counts as tuned. */
  tunedSeconds: 0.4,
  /** A new note needs a clean frame: CMNDF dip at or below this. */
  strongAperiodicity: 0.25,
  /** A note already being tracked continues through frames up to this. */
  weakAperiodicity: 0.5,
  /** Frames within this distance of the current note continue it. */
  continuationCents: 40,
  /** Two clean frames agreeing within this switch to a different note. */
  newNoteAgreeCents: 30,
  /** A tracked note continues while it is this far above the noise floor (dB). */
  gateMarginDb: 6,
  /** A new note must start this far above the noise floor (dB). */
  newNoteMarginDb: 12,
  /** At start, listen this long to learn the room noise before accepting notes. */
  warmupSeconds: 0.15,
  /** Noise-floor rise rate during the warm-up (dB/s). */
  warmupRiseDbPerSecond: 120,
  /** Absolute quietest level ever considered (dBFS). */
  gateMinDbfs: -85,
  /** How fast the learned noise floor may rise during non-note sound (dB/s). */
  floorRiseDbPerSecond: 4,
};
export type EngineTuning = typeof ENGINE_TUNING;

export class TunerEngine {
  readonly sampleRate: number;
  private settings: EngineSettings;
  private strings: ResolvedString[] = [];
  private detector!: YinDetector;
  private filter!: LowpassFilter;
  private frame!: Float32Array;
  private sinceHop = 0;
  private hop = 1;

  private readonly k: EngineTuning;
  private highpass!: HighpassFilter;
  private history: number[] = [];
  private candidate: number | null = null;
  private noiseFloor = 0; // linear RMS, learned from non-note frames
  private snrDb = 0;
  private lastVoicedAt = -Infinity;
  private now = 0; // seconds of audio processed
  private autoString: number | null = null;
  private inTuneSince: number | null = null;
  private last: Reading | null = null;

  /** Strings that have been brought in tune since the last reset. */
  readonly tuned = new Set<number>();

  constructor(sampleRate: number, settings: EngineSettings, tuning: Partial<EngineTuning> = {}) {
    this.sampleRate = sampleRate;
    this.k = { ...ENGINE_TUNING, ...tuning };
    this.noiseFloor = Math.pow(10, this.k.gateMinDbfs / 20);
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
    this.candidate = null;
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
    // Level and periodicity gating happen in analyse(), where note context is known.
    this.detector = new YinDetector({ ...cfg.yin, minRms: 1e-6, maxAperiodicity: 1 });
    this.highpass = new HighpassFilter(this.sampleRate, cfg.highpassHz);
    const cutoff = s.mode === 'chromatic' ? chromaticLowpass(undefined, this.sampleRate) : cfg.lowpassHz;
    this.filter = new LowpassFilter(this.sampleRate, cutoff);
    this.frame = new Float32Array(this.detector.frameSize);
    const frameSec = this.detector.frameSize / this.sampleRate;
    const hopSec = Math.min(this.k.maxHopSeconds, Math.max(this.k.hopSeconds, frameSec * this.k.hopFrameFraction));
    this.hop = Math.round(this.sampleRate * hopSec);
    this.sinceHop = 0;
    this.history = [];
    this.candidate = null;
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
      this.highpass.processInPlace(tail);
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
    const k = this.k;

    if (this.accept(r.freq, 1 - r.confidence, r.rms)) {
      this.lastVoicedAt = this.now;
    }

    const sinceVoiced = this.now - this.lastVoicedAt;
    if (this.history.length === 0 || sinceVoiced > k.holdSeconds) {
      this.inTuneSince = null;
      if (sinceVoiced > k.holdSeconds) this.autoString = null;
      if (s.mode === 'chromatic') this.filter.setCutoff(this.sampleRate, chromaticLowpass(undefined, this.sampleRate));
      this.last = null;
      return this.empty(r.confidence, levelDb);
    }

    if (sinceVoiced > 0 && this.last) {
      // Keep showing the last note. Short gaps are bridged as if live, so the
      // display does not flicker as a note fades; longer ones show as held.
      const held = sinceVoiced > k.bridgeSeconds;
      return { ...this.last, held, confidence: r.confidence, levelDb };
    }

    const freq = this.currentPitch();
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
      if (reading.stringIndex !== null && this.now - this.inTuneSince >= this.k.tunedSeconds) {
        this.tuned.add(reading.stringIndex);
      }
    } else {
      this.inTuneSince = null;
    }
    this.last = reading;
    return reading;
  }

  /**
   * Decide whether this frame's pitch belongs on screen, and update the
   * median history and the learned noise floor.
   *
   *  - Gate: the frame must be `gateMarginDb` above the room's noise floor,
   *    which is learned from frames that are not part of a note. This follows
   *    a decaying string down to the noise instead of cutting it at a fixed level.
   *  - A note being tracked continues through noisier frames that agree with it.
   *  - Starting a note needs a clean frame; switching to a different note
   *    needs two clean frames that agree, so a stray frame cannot jump the display.
   */
  private accept(freq: number, aperiodicity: number, rms: number): boolean {
    const k = this.k;
    const floor = this.noiseFloor;
    const absMin = Math.pow(10, k.gateMinDbfs / 20);
    const snrDb = 20 * Math.log10(Math.max(rms, 1e-12) / Math.max(floor, absMin));
    const warmingUp = this.now < k.warmupSeconds;
    // While tracking, frames are compared with the current note; after a gap
    // the next sound starts a new note (history is replaced, not appended).
    const tracking = this.history.length > 0 && this.now - this.lastVoicedAt <= k.resetSeconds;
    const valid = !warmingUp && Number.isFinite(freq) && freq > 0 && rms >= absMin;
    const strong = aperiodicity <= k.strongAperiodicity && snrDb >= k.newNoteMarginDb;

    let accepted = false;
    if (valid) {
      if (tracking) {
        const cur = this.currentPitch(snrDb);
        const d = Math.abs(cents(freq, cur));
        if (d <= k.continuationCents && aperiodicity <= k.weakAperiodicity && snrDb >= k.gateMarginDb) {
          this.addReading(freq);
          this.candidate = null;
          accepted = true;
        } else if (strong) {
          if (this.candidate !== null && Math.abs(cents(freq, this.candidate)) <= k.newNoteAgreeCents) {
            this.history = [this.candidate];
            this.addReading(freq);
            this.candidate = null;
            this.inTuneSince = null;
            accepted = true;
          } else {
            this.candidate = freq;
          }
        }
      } else if (strong) {
        this.history = [freq];
        this.candidate = null;
        accepted = true;
      }
    }
    this.snrDb = snrDb;

    // Learn the noise floor: fall quickly to quieter frames, rise only during
    // sound that is not pitched, so a ringing string never becomes "noise".
    if (rms < floor) this.noiseFloor = Math.max(absMin, floor + (rms - floor) * 0.5);
    else if (!accepted && !tracking && aperiodicity > k.strongAperiodicity) {
      const rate = warmingUp ? k.warmupRiseDbPerSecond : k.floorRiseDbPerSecond;
      this.noiseFloor = Math.min(rms, floor * Math.pow(10, (rate * this.hop) / this.sampleRate / 20));
    }
    return accepted;
  }

  /** Median of recent readings; uses more of them as the note gets fainter. */
  private currentPitch(snrDb = this.snrDb): number {
    const k = this.k;
    const frac = Math.min(1, Math.max(0, (k.strongSnrDb - snrDb) / (k.strongSnrDb - k.gateMarginDb)));
    const n = Math.round(k.medianSize + frac * (k.medianSizeFaint - k.medianSize));
    return median(this.history.slice(-n));
  }

  private addReading(freq: number): void {
    this.history.push(freq);
    if (this.history.length > this.k.medianSizeFaint) this.history.shift();
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
      if (cur && Math.abs(cents(freq, cur.freq)) <= bestDist + this.k.stringHysteresisCents) return cur;
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
