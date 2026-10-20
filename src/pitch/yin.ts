// YIN pitch detector (de Cheveigné & Kawahara, 2002), steps 1–5:
//   1–2. difference function over a FIXED window:  d(τ) = Σ_{j<W} (x_j − x_{j+τ})²
//        computed as E(0) + E(τ) − 2·r(τ) with prefix-sum energies
//   3.   cumulative mean normalised difference d'(τ)
//   4.   absolute threshold, then descend to the local minimum
//   5.   parabolic interpolation around the minimum
//
import { FFT, nextPow2 } from './fft';

// All buffers are allocated once in the constructor so detect() does not
// allocate, which keeps it safe to call ~20–50 times per second.

export interface YinOptions {
  sampleRate: number;
  /** Lowest frequency to search for (Hz). Sets the maximum lag. */
  fMin: number;
  /** Highest frequency to search for (Hz). Sets the minimum lag. */
  fMax: number;
  /** YIN absolute threshold on d'(τ). 0.10–0.15 is typical. */
  threshold?: number;
  /** Integration window in samples. Defaults to max(2·maxLag, ~21 ms). */
  windowSize?: number;
  /** Frames quieter than this RMS (linear, full scale = 1) are reported unvoiced. */
  minRms?: number;
  /** Frames whose best d'(τ) is above this are reported unvoiced. */
  maxAperiodicity?: number;
}

export interface PitchResult {
  /** Estimated fundamental in Hz (NaN if nothing usable was found). */
  freq: number;
  /** 1 − d'(τ) at the chosen lag: 1 = perfectly periodic, ~0 = noise. */
  confidence: number;
  /** RMS level of the analysed frame (linear). */
  rms: number;
  /** True when the frame is loud enough and periodic enough to trust. */
  voiced: boolean;
}

export class YinDetector {
  readonly sampleRate: number;
  readonly tauMin: number;
  readonly tauMax: number;
  readonly windowSize: number;
  /** Number of input samples detect() expects (it reads the most recent ones). */
  readonly frameSize: number;

  private readonly threshold: number;
  private readonly minRms: number;
  private readonly maxAperiodicity: number;
  private readonly x: Float64Array;
  private readonly energy: Float64Array; // prefix sums of x²
  private readonly d: Float64Array;
  private readonly dn: Float64Array;
  private readonly fft: FFT;
  private lastValid = false;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly xRe: Float64Array;
  private readonly xIm: Float64Array;

  constructor(opts: YinOptions) {
    const { sampleRate, fMin, fMax } = opts;
    if (!(fMin > 0 && fMax > fMin)) throw new Error('YinDetector: need 0 < fMin < fMax');
    this.sampleRate = sampleRate;
    this.tauMin = Math.max(2, Math.floor(sampleRate / fMax));
    this.tauMax = Math.ceil(sampleRate / fMin);
    this.windowSize = opts.windowSize ?? Math.max(2 * this.tauMax, Math.round(sampleRate * 0.0213));
    // +2: one extra lag for interpolation beyond tauMax
    this.frameSize = this.windowSize + this.tauMax + 2;
    this.threshold = opts.threshold ?? 0.12;
    this.minRms = opts.minRms ?? 0.003; // ≈ −50 dBFS
    this.maxAperiodicity = opts.maxAperiodicity ?? 0.3;

    this.x = new Float64Array(this.frameSize);
    this.energy = new Float64Array(this.frameSize + 1);
    this.d = new Float64Array(this.tauMax + 2);
    this.dn = new Float64Array(this.tauMax + 2);
    // Window indices j < W plus lags τ ≤ tauMax+1 stay below frameSize, so a
    // transform of frameSize (rounded up) never wraps around.
    this.fft = new FFT(nextPow2(this.frameSize));
    this.aRe = new Float64Array(this.fft.size);
    this.aIm = new Float64Array(this.fft.size);
    this.xRe = new Float64Array(this.fft.size);
    this.xIm = new Float64Array(this.fft.size);
  }

  /** Analyse the last `frameSize` samples of `input`. */
  detect(input: ArrayLike<number>): PitchResult {
    const { x, energy, d, dn, windowSize: W, tauMin, tauMax, frameSize } = this;
    if (input.length < frameSize) {
      throw new Error(`YinDetector: need ${frameSize} samples, got ${input.length}`);
    }
    const offset = input.length - frameSize;

    // Remove DC so it cannot bias d(τ); measure level.
    let mean = 0;
    for (let i = 0; i < frameSize; i++) mean += input[offset + i];
    mean /= frameSize;
    energy[0] = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = input[offset + i] - mean;
      x[i] = v;
      energy[i + 1] = energy[i] + v * v;
    }
    const rms = Math.sqrt((energy[W] - energy[0]) / W);
    this.lastValid = false;
    if (!(rms >= this.minRms)) return { freq: NaN, confidence: 0, rms, voiced: false };

    // Steps 1–2: difference function over a fixed window of W samples.
    // r(τ) = Σ_{j<W} x_j·x_{j+τ} is a cross-correlation of the first W samples
    // with the whole frame, computed with FFTs: R = IFFT(conj(A)·X). Both
    // inputs are real, so they share one complex FFT: z = a + i·x.
    const { fft, aRe, aIm, xRe, xIm } = this;
    const N = fft.size;
    xRe.fill(0); xIm.fill(0);
    for (let j = 0; j < W; j++) xRe[j] = x[j];
    xIm.set(x);
    fft.transform(xRe, xIm);
    for (let k = 0; k < N; k++) {
      const m = (N - k) & (N - 1);
      const zr = xRe[k], zi = xIm[k], wr = xRe[m], wi = xIm[m];
      const ar = (zr + wr) * 0.5, ai = (zi - wi) * 0.5; // A_k
      const br = (zi + wi) * 0.5, bi = (wr - zr) * 0.5; // X_k
      aRe[k] = ar * br + ai * bi; // conj(A)·X
      aIm[k] = ar * bi - ai * br;
    }
    fft.transform(aRe, aIm, true);
    const scale = 1 / fft.size;
    const e0 = energy[W];
    const lastTau = tauMax + 1;
    d[0] = 0;
    for (let tau = 1; tau <= lastTau; tau++) {
      const r = aRe[tau] * scale;
      const eTau = energy[tau + W] - energy[tau];
      d[tau] = Math.max(0, e0 + eTau - 2 * r);
    }

    // Step 3: cumulative mean normalised difference.
    dn[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= lastTau; tau++) {
      running += d[tau];
      dn[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }

    // Step 4: first dip under the threshold, then walk down to its minimum.
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (dn[t] < this.threshold) {
        while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // No dip under the threshold: take the global minimum (low confidence).
      tau = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (dn[t] < dn[tau]) tau = t;
    }

    // Step 5: parabolic interpolation on d'(τ−1), d'(τ), d'(τ+1).
    let tauEst = tau;
    if (tau > 1 && tau < lastTau) {
      const y0 = dn[tau - 1];
      const y1 = dn[tau];
      const y2 = dn[tau + 1];
      const denom = y0 - 2 * y1 + y2;
      if (denom > 0) {
        const shift = (y0 - y2) / (2 * denom);
        if (Math.abs(shift) <= 1) tauEst = tau + shift;
      }
    }

    this.lastValid = true;
    const aperiodicity = dn[tau];
    const confidence = Math.max(0, Math.min(1, 1 - aperiodicity));
    return {
      freq: this.sampleRate / tauEst,
      confidence,
      rms,
      voiced: aperiodicity <= this.maxAperiodicity,
    };
  }

  /**
   * Re-examine the last analysed frame at a given frequency: the best lag
   * within ±`tol` of it, refined by parabolic interpolation, and its d'(τ).
   * Lets the caller ask "does the note I was tracking still fit?" when the
   * first-dip rule picked something else (typically an octave).
   */
  probe(freq: number, tol = 0.03): { freq: number; aperiodicity: number } {
    if (!this.lastValid || !(freq > 0)) return { freq: NaN, aperiodicity: 1 };
    const { dn, sampleRate, tauMax } = this;
    const lo = Math.max(2, Math.floor(sampleRate / (freq * (1 + tol))));
    const hi = Math.min(tauMax, Math.ceil(sampleRate / (freq * (1 - tol))));
    if (hi <= lo) return { freq: NaN, aperiodicity: 1 };
    let t = lo;
    for (let k = lo + 1; k <= hi; k++) if (dn[k] < dn[t]) t = k;
    let tauEst = t;
    const y0 = dn[t - 1], y1 = dn[t], y2 = dn[t + 1];
    const denom = y0 - 2 * y1 + y2;
    if (denom > 0) {
      const shift = (y0 - y2) / (2 * denom);
      if (Math.abs(shift) <= 1) tauEst = t + shift;
    }
    return { freq: sampleRate / tauEst, aperiodicity: dn[t] };
  }

  /**
   * Cheap local refinement: given a frame and a frequency already known to
   * within ±`tol`, find the best-matching period near it using the
   * normalised squared difference d(τ) / (E(0) + E(τ)) over only those lags.
   * Returns the refined frequency and that normalised difference (0 = perfect).
   * Used on a band-limited copy of the signal while a note is tracked.
   */
  refine(input: ArrayLike<number>, freq: number, tol = 0.03): { freq: number; aperiodicity: number } {
    const { x, energy, windowSize: W, frameSize, sampleRate } = this;
    if (input.length < frameSize || !(freq > 0)) return { freq: NaN, aperiodicity: 1 };
    const offset = input.length - frameSize;
    let mean = 0;
    for (let i = 0; i < frameSize; i++) mean += input[offset + i];
    mean /= frameSize;
    energy[0] = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = input[offset + i] - mean;
      x[i] = v;
      energy[i + 1] = energy[i] + v * v;
    }
    const lo = Math.max(2, Math.floor(sampleRate / (freq * (1 + tol))) - 1);
    const hi = Math.min(this.tauMax + 1, Math.ceil(sampleRate / (freq * (1 - tol))) + 1);
    if (hi - lo < 2) return { freq: NaN, aperiodicity: 1 };
    const e0 = energy[W];
    const nd = this.dn; // scratch
    let best = lo;
    for (let tau = lo; tau <= hi; tau++) {
      let r = 0;
      for (let j = 0; j < W; j++) r += x[j] * x[j + tau];
      const eTau = energy[tau + W] - energy[tau];
      const den = e0 + eTau;
      nd[tau] = den > 0 ? Math.max(0, (den - 2 * r) / den) : 1;
      if (nd[tau] < nd[best]) best = tau;
    }
    let tauEst = best;
    if (best > lo && best < hi) {
      const y0 = nd[best - 1], y1 = nd[best], y2 = nd[best + 1];
      const denom = y0 - 2 * y1 + y2;
      if (denom > 0) {
        const shift = (y0 - y2) / (2 * denom);
        if (Math.abs(shift) <= 1) tauEst = best + shift;
      }
    }
    return { freq: sampleRate / tauEst, aperiodicity: nd[best] };
  }
}
