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
  /** "In tune" switches off only once the note is this much beyond the tolerance (cents). */
  inTuneHysteresisCents: 1.5,
  /** A new note needs a clean frame: CMNDF dip at or below this. */
  strongAperiodicity: 0.25,
  /** Switching away from a note that is still ringing needs frames at least this clean. */
  switchAperiodicity: 0.15,
  /** A note already being tracked continues through frames up to this. */
  weakAperiodicity: 0.5,
  /** Frames within this distance of the current note continue it. */
  continuationCents: 40,
  /** Clean frames needed, agreeing within `newNoteAgreeCents`, to start a new note. */
  confirmFrames: 3,
  newNoteAgreeCents: 25,
  /** A level jump of this much within ~50 ms counts as a new pluck (dB). */
  onsetDb: 10,
  /** A pluck must be within this much of the remembered loudness of recent plucks (dB). */
  pluckMarginDb: 9,
  /** The remembered pluck loudness fades by this much per second. */
  pluckMemoryDecayDbPerSecond: 1,
  /** Frames within this time after a pluck use the quick confirmation. */
  onsetWindowSeconds: 0.15,
  /** Without a pluck, a new note needs this many steady frames… */
  confirmFramesNoOnset: 8,
  /** …agreeing within this many cents. */
  newNoteAgreeCentsNoOnset: 15,
  /** Instrument mode: detections within this of a string are taken as they are. */
  plausibleCents: 100,
  /** Measure tracked notes on a copy filtered around their fundamental. */
  focus: true,
  /** Focus band: low-pass at this multiple of the note… */
  focusLowpassFactor: 1.4,
  /** …high-pass at this fraction of it. */
  focusHighpassFactor: 0.5,
  /** Use the focus reading only when its normalised difference is at most this (0 = perfect match). */
  focusMaxDifference: 0.08,
  /** Re-centre the focus band when the note moves this far from its centre (cents). */
  focusRetuneCents: 100,
  /** Keep a one-line explanation of the last decision (tests and debugging). */
  debug: false,
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
  // Focus path: a second copy of the signal filtered tightly around the note
  // being tracked, so the reading follows its fundamental rather than being
  // pulled sharp by strong, slightly inharmonic overtones.
  private focusDet!: YinDetector;
  private focusLp!: LowpassFilter;
  private focusHp!: HighpassFilter;
  private focusFrame!: Float32Array;
  private focusCenter = 0;
  private focusSince = Infinity;
  private history: number[] = [];
  private candidates: { freq: number; t: number }[] = [];
  private levels: number[] = [];
  private lastOnsetAt = -Infinity;
  private noteStartAt = -Infinity;
  private pluckMemoryDb = -200;

  lastDebug = '';
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
    this.candidates = [];
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
    this.focusDet = new YinDetector({ ...cfg.yin, minRms: 1e-6, maxAperiodicity: 1 });
    this.focusLp = new LowpassFilter(this.sampleRate, 0);
    this.focusHp = new HighpassFilter(this.sampleRate, 0);
    this.focusFrame = new Float32Array(this.detector.frameSize);
    this.focusCenter = 0;
    this.focusSince = Infinity;
    const frameSec = this.detector.frameSize / this.sampleRate;
    const hopSec = Math.min(this.k.maxHopSeconds, Math.max(this.k.hopSeconds, frameSec * this.k.hopFrameFraction));
    this.hop = Math.round(this.sampleRate * hopSec);
    this.sinceHop = 0;
    this.history = [];
    this.candidates = [];
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
      const ff = this.focusFrame;
      ff.copyWithin(0, n);
      const ftail = ff.subarray(ff.length - n);
      this.focusLp.process(chunk, ftail);
      this.focusHp.processInPlace(ftail);
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

    let refined = NaN;
    const frameSec = this.frame.length / this.sampleRate;
    if (k.focus && this.focusCenter > 0 && this.history.length && this.now - this.focusSince >= frameSec) {
      const p = this.focusDet.refine(this.focusFrame, this.currentPitch(), 0.03);
      if (p.aperiodicity <= k.focusMaxDifference) refined = p.freq;
    }
    if (this.accept(r.freq, 1 - r.confidence, r.rms, refined)) {
      this.lastVoicedAt = this.now;
    }
    this.updateFocus();

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
        stringIndex: null, inTune: this.inTuneWithHysteresis(n.cents, n.name), confidence: r.confidence, levelDb,
      };
    } else {
      const target = this.pickString(freq);
      const c = cents(freq, target.freq);
      reading = {
        active: true, held: false, freq, cents: c, targetName: target.name, targetFreq: target.freq,
        stringIndex: target.index, inTune: this.inTuneWithHysteresis(c, target.name), confidence: r.confidence, levelDb,
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
   *    If the detector jumps (usually an octave) but the tracked note's period
   *    still fits and nothing was plucked, the tracked note continues.
   *  - In instrument mode a detection far from every string is re-checked at
   *    half, a third and double its frequency (octave errors on low strings).
   *  - A new note needs `confirmFrames` consecutive clean frames that agree, so
   *    stray frames and gliding sounds (speech) do not start one.
   */
  private accept(freq: number, aperiodicity: number, rms: number, refined = NaN): boolean {
    const k = this.k;
    const floor = this.noiseFloor;
    const absMin = Math.pow(10, k.gateMinDbfs / 20);
    const snrDb = 20 * Math.log10(Math.max(rms, 1e-12) / Math.max(floor, absMin));
    const warmingUp = this.now < k.warmupSeconds;
    // While tracking, frames are compared with the current note; after a gap
    // the next sound starts a new note (history is replaced, not appended).
    const tracking = this.history.length > 0 && this.now - this.lastVoicedAt <= k.resetSeconds;
    const valid = !warmingUp && Number.isFinite(freq) && freq > 0 && rms >= absMin;

    // A pluck shows up as a jump in level compared with ~50 ms ago.
    this.levels.push(rms);
    const lookback = Math.max(2, Math.round(0.05 / (this.hop / this.sampleRate)));
    if (this.levels.length > lookback) this.levels.shift();
    const levelDb = 20 * Math.log10(Math.max(rms, 1e-12));
    // Plucks are remembered by how loud they were; a "pluck" far quieter than
    // the recent ones (a syllable of speech across the room) does not count.
    this.pluckMemoryDb -= k.pluckMemoryDecayDbPerSecond * (this.hop / this.sampleRate);
    const loudEnough = levelDb >= this.pluckMemoryDb - k.pluckMarginDb;
    const onset = rms > this.levels[0] * Math.pow(10, k.onsetDb / 20) && loudEnough;
    if (onset) this.lastOnsetAt = this.now;

    let accepted = false;
    if (valid) {
      if (tracking) {
        const cur = this.currentPitch(snrDb);
        let d = Math.abs(cents(freq, cur));
        if (d > k.continuationCents && !onset && this.mayBeDetectorError(freq, cur)) {
          const p = this.detector.probe(cur, 0.025);
          if (p.aperiodicity <= k.weakAperiodicity && Math.abs(cents(p.freq, cur)) <= k.continuationCents) {
            freq = p.freq;
            aperiodicity = p.aperiodicity;
            d = Math.abs(cents(freq, cur));
          }
        }
        if (d <= k.continuationCents && aperiodicity <= k.weakAperiodicity && snrDb >= k.gateMarginDb) {
          const useRefined = Number.isFinite(refined) && Math.abs(cents(refined, cur)) <= k.continuationCents;
          this.addReading(useRefined ? refined : freq);
          this.candidates = [];
          accepted = true;
        } else if (aperiodicity <= k.switchAperiodicity && snrDb >= k.newNoteMarginDb && this.now - this.lastOnsetAt <= k.onsetWindowSeconds) {
          // While a note is still ringing, only a fresh pluck can switch to another one.
          const alt = this.plausible(freq, aperiodicity);
          accepted = this.confirm(alt.freq);
        } else {
          this.candidates = [];
        }
      } else if (aperiodicity <= k.strongAperiodicity && snrDb >= k.newNoteMarginDb && loudEnough) {
        const alt = this.plausible(freq, aperiodicity);
        accepted = this.confirm(alt.freq);
      } else {
        this.candidates = [];
      }
    } else {
      this.candidates = [];
    }
    this.snrDb = snrDb;
    if (accepted && this.now - this.noteStartAt <= 0.15) {
      this.pluckMemoryDb = Math.max(this.pluckMemoryDb, levelDb);
    }
    if (k.debug) {
      this.lastDebug = `raw ${freq.toFixed(1)}Hz ap ${aperiodicity.toFixed(2)} snr ${snrDb.toFixed(0)} ${onset ? 'ONSET ' : ''}${tracking ? 'trk ' : ''}cand ${this.candidates.length} ${accepted ? 'ACC' : ''}`;
    }

    // Learn the noise floor: fall quickly to quieter frames, rise only during
    // sound that is not pitched, so a ringing string never becomes "noise".
    if (rms < floor) this.noiseFloor = Math.max(absMin, floor + (rms - floor) * 0.5);
    else if (!accepted && !tracking && aperiodicity > k.strongAperiodicity) {
      const rate = warmingUp ? k.warmupRiseDbPerSecond : k.floorRiseDbPerSecond;
      this.noiseFloor = Math.min(rms, floor * Math.pow(10, (rate * this.hop) / this.sampleRate / 20));
    }
    return accepted;
  }

  /** Keep the focus filters centred on the note being tracked (bypassed when none). */
  private updateFocus(): void {
    const k = this.k;
    const tracking = this.history.length > 0 && this.now - this.lastVoicedAt <= k.resetSeconds;
    if (!k.focus || !tracking) {
      if (this.focusCenter !== 0) {
        this.focusCenter = 0;
        this.focusLp.setCutoff(this.sampleRate, 0);
        this.focusHp.setCutoff(this.sampleRate, 0);
      }
      return;
    }
    const cur = this.currentPitch();
    if (this.focusCenter === 0 || Math.abs(cents(cur, this.focusCenter)) > k.focusRetuneCents) {
      this.focusCenter = cur;
      this.focusSince = this.now;
      this.focusLp.setCutoff(this.sampleRate, cur * k.focusLowpassFactor);
      this.focusHp.setCutoff(this.sampleRate, cur * k.focusHighpassFactor);
    }
  }

  /**
   * Collect clean frames for a new note; start it once `confirmFrames`
   * consecutive ones agree within `newNoteAgreeCents`.
   */
  private confirm(freq: number): boolean {
    const k = this.k;
    const c = this.candidates;
    const gap = c.length ? this.now - c[c.length - 1].t : 0;
    if (gap > 2.5 * (this.hop / this.sampleRate)) c.length = 0;
    c.push({ freq, t: this.now });
    // keep only the run that agrees with the newest frame
    while (c.length > 1 && Math.abs(cents(c[0].freq, freq)) > k.newNoteAgreeCents) c.shift();
    let lo = Infinity, hi = -Infinity;
    for (const x of c) { lo = Math.min(lo, x.freq); hi = Math.max(hi, x.freq); }
    // After a pluck a few agreeing frames are enough; a sound that starts
    // without one (a voice, a hum) has to hold its pitch for longer.
    const plucked = this.now - this.lastOnsetAt <= k.onsetWindowSeconds;
    const need = plucked ? k.confirmFrames : k.confirmFramesNoOnset;
    const spread = plucked ? k.newNoteAgreeCents : k.newNoteAgreeCentsNoOnset;
    if (c.length >= need && cents(hi, lo) <= spread) {
      this.history = c.map((x) => x.freq);
      this.candidates = [];
      this.inTuneSince = null;
      this.noteStartAt = this.now;
      return true;
    }
    return false;
  }

  /**
   * Could a jump from the tracked pitch `cur` to `freq` be a detector error
   * (rather than a real new note)? In instrument mode: only if `freq` is not
   * itself one of the strings. In chromatic mode: only for an exact octave.
   */
  private mayBeDetectorError(freq: number, cur: number): boolean {
    if (this.settings.mode === 'instrument' && this.strings.length) {
      const d = Math.min(...this.strings.map((s) => Math.abs(cents(freq, s.freq))));
      return d > this.k.plausibleCents;
    }
    const octaves = Math.abs(cents(freq, cur)) / 1200;
    return Math.abs(octaves - Math.round(octaves)) * 1200 <= this.k.continuationCents && Math.round(octaves) >= 1;
  }

  /**
   * Instrument mode: if `freq` is far from every string but half, a third or
   * double of it lands on a string and fits the frame almost as well, the
   * detector made an octave-type error; use the string-plausible pitch.
   */
  private plausible(freq: number, aperiodicity: number): { freq: number; aperiodicity: number } {
    if (this.settings.mode !== 'instrument' || !this.strings.length) return { freq, aperiodicity };
    const dist = (f: number) => Math.min(...this.strings.map((s) => Math.abs(cents(f, s.freq))));
    const d0 = dist(freq);
    if (d0 <= this.k.plausibleCents) return { freq, aperiodicity };
    let best = { freq, aperiodicity, d: d0 };
    for (const m of [0.5, 1 / 3, 2]) {
      const p = this.detector.probe(freq * m, 0.02);
      if (!Number.isFinite(p.freq)) continue;
      const dp = dist(p.freq);
      if (p.aperiodicity <= Math.max(this.k.strongAperiodicity, aperiodicity + 0.1) && dp < best.d - 100 && dp <= this.k.plausibleCents) {
        best = { freq: p.freq, aperiodicity: p.aperiodicity, d: dp };
      }
    }
    return best;
  }

  /**
   * "In tune" turns on within the tolerance and stays on until the note drifts
   * `inTuneHysteresisCents` beyond it, so it does not flicker at the edge.
   */
  private inTuneWithHysteresis(c: number, target: string): boolean {
    const tol = this.settings.toleranceCents;
    const wasIn = this.last?.inTune === true && this.last.targetName === target;
    const limit = wasIn ? tol + this.k.inTuneHysteresisCents : tol;
    return Math.abs(c) <= limit;
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
