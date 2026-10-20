// Faithful TypeScript port of the original MATLAB DetectPitch / DetectPitchCMNDF.
// Kept ONLY for the benchmark so the old and new algorithms can be compared on
// identical input. Do not use it in the app.
//
// The port keeps MATLAB's 1-based indexing (arrays are padded at index 0) so it
// matches the original line by line, quirks included:
//   - returns SampleRate / (1-based index) → lag is off by one sample
//   - cross-correlation over a single window, energies over shifted windows
//   - parabola through (i-1, i, j-1) instead of the neighbours of the minimum
//   - fallback to the global CMNDF minimum without interpolation
//
// One approximation: MATLAB's envelope(f, np, 'peak') is only used as an
// amplitude gate (the onset it computes is always overridden by the clamp), so
// max(envelope) is approximated by max(f).

export function legacyDetectPitch(audio: Float64Array | Float32Array, sampleRate: number, threshold: number): number {
  return detectPitchCMNDF(audio, Math.floor(sampleRate / 10), sampleRate, Math.floor(sampleRate / 20), threshold);
}

function detectPitchCMNDF(
  input: Float64Array | Float32Array,
  W: number,
  sampleRate: number,
  upperBound: number,
  threshold: number,
): number {
  const N = input.length;
  const f1 = new Float64Array(N + 1); // 1-based copy
  for (let i = 0; i < N; i++) f1[i + 1] = input[i];

  // Amplitude gate: env = envelope(f, SampleRate*0.1, 'peak'); if max(env) < 0.1 → 0
  let peak = -Infinity;
  let firstAbove = -1;
  for (let i = 1; i <= N; i++) {
    if (f1[i] > peak) peak = f1[i];
    if (firstAbove < 0 && f1[i] > 0.1) firstAbove = i;
  }
  if (peak < 0.1) return 0;

  // onset = find(env > 0.1, 1, 'first') + SampleRate;  (always clamped below)
  let onset = firstAbove + sampleRate;
  if (onset + W + upperBound > N) onset = N - W - upperBound;
  if (onset < 1) return NaN; // MATLAB would throw an index error here

  // f = f(onset:onset+W+UpperBound)
  const segLen = W + upperBound + 1;
  const seg = new Float64Array(segLen + 1);
  for (let k = 1; k <= segLen; k++) seg[k] = f1[onset + k - 1];

  // 7-tap moving average, zero initial state: filter((1/7)*ones(1,7), 1, f)
  const degree = 7;
  const y = new Float64Array(segLen + 1);
  for (let n = 1; n <= segLen; n++) {
    let s = 0;
    for (let k = 0; k < degree; k++) if (n - k >= 1) s += seg[n - k];
    y[n] = s / degree;
  }

  // ACF_vals0 = xcorr(f(1:1+W)); ACF_positive = non-negative lags (1-based: index k ↔ lag k-1)
  const L = W + 1;
  const acfPos = new Float64Array(L + 1);
  for (let k = 1; k <= upperBound; k++) {
    let s = 0;
    for (let n = 1; n <= L - k + 1; n++) s += y[n] * y[n + k - 1];
    acfPos[k] = s;
  }

  // ACF_vals1(i) = sum(f(i:i+W).^2)
  const acf1 = new Float64Array(upperBound + 1);
  for (let i = 1; i <= upperBound; i++) {
    let s = 0;
    for (let n = i; n <= i + W; n++) s += y[n] * y[n];
    acf1[i] = s;
  }

  // DF and CMNDF, length(ACF_positive) = L, initialised to ones
  const df = new Float64Array(L + 1).fill(1);
  for (let i = 1; i <= upperBound; i++) df[i] = acfPos[1] + acf1[i] - 2 * acfPos[i];

  const cmndf = new Float64Array(L + 1).fill(1);
  let running = 0;
  for (let i = 1; i <= upperBound; i++) {
    running += df[i];
    cmndf[i] = (i * df[i]) / running; // i = 1 → 0/0 = NaN, as in MATLAB
  }

  for (let i = 1; i <= L; i++) {
    if (cmndf[i] < threshold) {
      const s1 = i - 1;
      const s2 = i;
      let s3 = 0;
      for (let j = i + 1; j <= L; j++) {
        if (cmndf[j] > threshold) {
          s3 = j - 1;
          break;
        }
      }
      if (s1 < 1 || s3 < 1) return NaN; // MATLAB index error
      const A = [
        [s1 * s1, s1, 1],
        [s2 * s2, s2, 1],
        [s3 * s3, s3, 1],
      ];
      const B = [cmndf[s1], cmndf[s2], cmndf[s3]];
      const c = solve3(A, B);
      const minSample = -c[1] / (2 * c[0]);
      return sampleRate / minSample;
    }
  }

  // [~, Sample] = min(CMNDF_vals)  (MATLAB's min ignores NaN)
  let best = Infinity;
  let bestIdx = 1;
  for (let i = 1; i <= L; i++) {
    if (!Number.isNaN(cmndf[i]) && cmndf[i] < best) {
      best = cmndf[i];
      bestIdx = i;
    }
  }
  return sampleRate / bestIdx;
}

/** Gaussian elimination with partial pivoting; NaN on a singular matrix (MATLAB warns and returns Inf/NaN). */
function solve3(Ain: number[][], Bin: number[]): number[] {
  const A = Ain.map((r) => r.slice());
  const B = Bin.slice();
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12 * Math.max(1, Math.abs(A[0][0]))) return [NaN, NaN, NaN];
    [A[col], A[piv]] = [A[piv], A[col]];
    [B[col], B[piv]] = [B[piv], B[col]];
    for (let r = col + 1; r < 3; r++) {
      const m = A[r][col] / A[col][col];
      for (let k = col; k < 3; k++) A[r][k] -= m * A[col][k];
      B[r] -= m * B[col];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = B[r];
    for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}
