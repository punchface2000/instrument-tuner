// Streaming low-pass pre-filter for the pitch detector.
// Two cascaded RBJ biquads (Q = 0.707 each, ~24 dB/octave). Removing
// broadband noise above the instrument's useful harmonics is what keeps YIN
// accurate on noisy input (see bench/results.md), so the app runs every
// sample through this before buffering it for detection.

export class LowpassFilter {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  // state for two sections: [x1, x2, y1, y2] × 2
  private readonly s = new Float64Array(8);
  private bypass = true;

  constructor(sampleRate: number, cutoffHz: number) {
    this.setCutoff(sampleRate, cutoffHz);
  }

  /**
   * Change the cutoff. Filter state is kept, so small changes while audio is
   * flowing (chromatic mode follows the detected note) do not click.
   */
  setCutoff(sampleRate: number, cutoffHz: number): void {
    if (!(cutoffHz > 0) || cutoffHz >= 0.45 * sampleRate) {
      this.bypass = true;
      return;
    }
    if (this.bypass) this.s.fill(0);
    this.bypass = false;
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const c = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 - c) / 2 / a0;
    this.b1 = (1 - c) / a0;
    this.b2 = (1 - c) / 2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** Filter `input` into `output` (may be the same array), keeping state across calls. */
  process(input: ArrayLike<number>, output: { [i: number]: number; length: number }): void {
    const n = input.length;
    if (this.bypass) {
      if ((input as unknown) !== output) for (let i = 0; i < n; i++) output[i] = input[i];
      return;
    }
    const { b0, b1, b2, a1, a2, s } = this;
    for (let i = 0; i < n; i++) {
      let v = input[i];
      for (let k = 0; k < 8; k += 4) {
        let y = b0 * v + b1 * s[k] + b2 * s[k + 1] - a1 * s[k + 2] - a2 * s[k + 3];
        if (y > -1e-20 && y < 1e-20) y = 0; // avoid denormals in silence
        s[k + 1] = s[k]; s[k] = v;
        s[k + 3] = s[k + 2]; s[k + 2] = y;
        v = y;
      }
      output[i] = v;
    }
  }
}

/**
 * Streaming 2nd-order high-pass (RBJ, Q = 0.707, 12 dB/octave). Removes
 * handling rumble, wind and most mains hum below the instrument's range.
 */
export class HighpassFilter {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private bypass = true;

  constructor(sampleRate: number, cutoffHz: number) {
    this.setCutoff(sampleRate, cutoffHz);
  }

  setCutoff(sampleRate: number, cutoffHz: number): void {
    if (!(cutoffHz > 0) || cutoffHz >= 0.45 * sampleRate) {
      this.bypass = true;
      return;
    }
    if (this.bypass) this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.bypass = false;
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const c = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 + c) / 2 / a0;
    this.b1 = -(1 + c) / a0;
    this.b2 = (1 + c) / 2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** Filter in place, keeping state across calls. */
  processInPlace(buf: { [i: number]: number; length: number }): void {
    if (this.bypass) return;
    const { b0, b1, b2, a1, a2 } = this;
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      if (y > -1e-20 && y < 1e-20) y = 0; // avoid denormals in silence
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      buf[i] = y;
    }
    this.x1 = x1; this.x2 = x2; this.y1 = y1; this.y2 = y2;
  }
}
