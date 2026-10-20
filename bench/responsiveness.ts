// Responsiveness benchmark: runs the live TunerEngine on realistic plucks
// streamed in 1024-sample blocks (like the microphone) and measures how
// quickly and how continuously it reports the pitch.
//
//   npm run bench:live   → prints a report and writes bench/responsiveness.md
//
// Signals model a real string through a phone/laptop mic: a noisy pick
// attack, harmonics that die away faster than the fundamental, a level that
// decays towards the room noise floor, optional mains hum, and (in the "peg"
// scenario) the pitch gliding while the player turns the tuning peg and
// re-plucks.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TunerEngine, type EngineSettings, type Reading } from '../src/engine';
import { findInstrument, resolveStrings } from '../src/instruments';
import { cents } from '../src/tuning';
import { rng } from './signals';

const SR = 48000;

interface PluckSpec {
  /** Pitch in Hz as a function of time (seconds). */
  freqAt: (t: number) => number;
  seconds: number;
  /** Times (s) at which the string is plucked. */
  plucks: number[];
  peakDbfs: number;
  noiseDbfs: number; // RMS of the room noise
  humDbfs?: number; // 50 Hz mains hum + harmonics
  decaySeconds: number; // fundamental's amplitude time constant
  seed: number;
}

function db(x: number) { return Math.pow(10, x / 20); }

/** Synthesise a realistic plucked-string recording. */
function pluckSignal(s: PluckSpec): Float32Array {
  const n = Math.round(s.seconds * SR);
  const out = new Float64Array(n);
  const rand = rng(s.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand());
  const K = 15;
  const phase = new Float64Array(K).map(() => rand() * 2 * Math.PI);
  let lastPluck = -Infinity;
  let pi = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (pi < s.plucks.length && t >= s.plucks[pi]) { lastPluck = s.plucks[pi]; pi++; }
    const f = s.freqAt(t);
    const age = t - lastPluck;
    let v = 0;
    for (let k = 1; k <= K; k++) {
      phase[k - 1] += (2 * Math.PI * k * f) / SR;
      if (k * f >= SR / 2 || age < 0) continue;
      const tau = s.decaySeconds / (1 + 0.35 * (k - 1)); // upper partials die faster
      v += (1 / k) * Math.exp(-age / tau) * Math.sin(phase[k - 1]);
    }
    // pick attack: 8 ms broadband burst
    if (age >= 0 && age < 0.008) v += 0.6 * gauss() * (1 - age / 0.008);
    out[i] = v;
  }
  // scale so the strongest moment hits the requested peak
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(out[i]));
  const g = db(s.peakDbfs) / m;
  const noise = db(s.noiseDbfs);
  const hum = s.humDbfs !== undefined ? db(s.humDbfs) : 0;
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let h = 0;
    if (hum) h = hum * (Math.sin(2 * Math.PI * 50 * t) + 0.5 * Math.sin(2 * Math.PI * 100 * t) + 0.3 * Math.sin(2 * Math.PI * 150 * t));
    res[i] = out[i] * g + noise * gauss() + h;
  }
  return res;
}

interface Result {
  latencyMs: number[]; // per pluck: time until first reading within 5 cents
  covered: number; // hops with a live (non-held) reading
  coverable: number; // hops while the note is ringing
  errors: number[]; // |cents error| of live readings
  wrongNote: number; // live readings more than 50 cents off
  dropouts: number; // live → not-live transitions while ringing
}

function run(settings: EngineSettings, spec: PluckSpec, ringUntil: (t: number) => boolean): Result {
  const engine = new TunerEngine(SR, settings);
  const sig = pluckSignal(spec);
  const res: Result = { latencyMs: [], covered: 0, coverable: 0, errors: [], wrongNote: 0, dropouts: 0 };
  const plucks = spec.plucks.slice();
  let pending: number | null = null;
  let wasLive = false;
  // engine.push returns at most one reading per block; step with smaller blocks
  // when the hop is shorter so every reading is observed.
  const hopSamples = 256;
  for (let i = 0; i + hopSamples <= sig.length; i += hopSamples) {
    const t = (i + hopSamples) / SR;
    if (plucks.length && t >= plucks[0]) { pending = plucks.shift()!; }
    const r: Reading | null = engine.push(sig.subarray(i, i + hopSamples));
    if (!r) continue;
    const ringing = ringUntil(t);
    const live = r.active && !r.held;
    if (ringing && t > (pending ?? -1) + 0.0) res.coverable++;
    if (live) {
      // compare with the true pitch ~half a frame ago (the frame's centre)
      const truth = spec.freqAt(Math.max(0, t - 0.03));
      const e = Math.abs(cents(r.freq, truth));
      if (ringing) res.covered++;
      if (e > 50) res.wrongNote++;
      else res.errors.push(e);
      if (pending !== null && e < 5) { res.latencyMs.push((t - pending) * 1000); pending = null; }
    }
    if (wasLive && !live && ringing) res.dropouts++;
    wasLive = live;
  }
  if (pending !== null) res.latencyMs.push(Infinity);
  return res;
}

const pct = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const base: EngineSettings = { a4: 440, toleranceCents: 3, mode: 'instrument', instrumentId: 'guitar', tuningId: 'standard', lockedString: null };

type Scenario = { id: string; label: string; make: (f0: number, seed: number) => { spec: PluckSpec; ringUntil: (t: number) => boolean } };

const SCENARIOS: Scenario[] = [
  {
    id: 'hold', label: 'Pluck and let ring (loud, −20 dBFS peak)',
    make: (f0, seed) => ({
      spec: { freqAt: () => f0 * 2 ** (7 / 1200), seconds: 5, plucks: [0.3], peakDbfs: -20, noiseDbfs: -66, decaySeconds: 1.6, seed },
      ringUntil: (t) => t > 0.3 && t < 4.3,
    }),
  },
  {
    id: 'quiet', label: 'Quiet phone mic at arm’s length (−38 dBFS peak)',
    make: (f0, seed) => ({
      spec: { freqAt: () => f0 * 2 ** (-12 / 1200), seconds: 5, plucks: [0.3], peakDbfs: -38, noiseDbfs: -64, decaySeconds: 1.6, seed },
      ringUntil: (t) => t > 0.3 && t < 3.3,
    }),
  },
  {
    id: 'peg', label: 'Turning the peg: −40 → +5 cents over 5 s, re-plucking every 1.7 s',
    make: (f0, seed) => ({
      spec: {
        freqAt: (t) => f0 * 2 ** ((-40 + 45 * Math.min(1, Math.max(0, (t - 0.3) / 5))) / 1200),
        seconds: 6, plucks: [0.3, 2.0, 3.7], peakDbfs: -26, noiseDbfs: -64, decaySeconds: 1.4, seed,
      },
      ringUntil: (t) => t > 0.3 && t < 5.4,
    }),
  },
  {
    id: 'hum', label: 'Noisy room with 50 Hz mains hum (−52 dBFS)',
    make: (f0, seed) => ({
      spec: { freqAt: () => f0, seconds: 4, plucks: [0.3], peakDbfs: -28, noiseDbfs: -58, humDbfs: -52, decaySeconds: 1.4, seed },
      ringUntil: (t) => t > 0.3 && t < 2.8,
    }),
  },
];

const TEST_STRINGS: Record<string, string[]> = {
  guitar: ['E2', 'A2', 'G3', 'E4'],
  bass: ['E1', 'A1', 'G2'],
  ukulele: ['G4', 'C4', 'A4'],
  violin: ['G3', 'A4', 'E5'],
};

const out: string[] = [];
const log = (l = '') => { out.push(l); console.log(l); };

log('# Live responsiveness benchmark');
log();
log('The live engine is fed simulated microphone audio in small blocks. **Latency** = time from the pluck until the first reading within 5 cents (median / worst, per pluck). **Coverage** = share of the ringing time with a live reading on screen. **Dropouts** = times the reading disappeared while the string was still ringing. **Error** = median / 95th-percentile cents error of live readings.');
log();
log('| Scenario | Instrument | Latency (ms) | Coverage | Dropouts | Error (¢) | Wrong note |');
log('|---|---|---|---|---|---|---|');
const summary: Record<string, { lat: number[]; cov: number; covN: number; drop: number; err: number[]; wrong: number }> = {};
for (const sc of SCENARIOS) {
  for (const [instId, names] of Object.entries(TEST_STRINGS)) {
    const inst = findInstrument(instId);
    const strings = resolveStrings(inst.tunings[0], 440).filter((s) => names.includes(s.name));
    const agg = { lat: [] as number[], cov: 0, covN: 0, drop: 0, err: [] as number[], wrong: 0 };
    for (const s of strings) {
      for (const seed of [1, 2]) {
        const { spec, ringUntil } = sc.make(s.freq, seed * 31 + s.midi);
        const r = run({ ...base, instrumentId: instId }, spec, ringUntil);
        agg.lat.push(...r.latencyMs); agg.cov += r.covered; agg.covN += r.coverable;
        agg.drop += r.dropouts; agg.err.push(...r.errors); agg.wrong += r.wrongNote;
      }
    }
    summary[`${sc.id}/${instId}`] = agg;
    const lat = `${pct(agg.lat, 0.5).toFixed(0)} / ${Number.isFinite(Math.max(...agg.lat)) ? Math.max(...agg.lat).toFixed(0) : 'never'}`;
    log(`| ${sc.label} | ${inst.name} | ${lat} | ${((100 * agg.cov) / agg.covN).toFixed(0)}% | ${agg.drop} | ${pct(agg.err, 0.5).toFixed(1)} / ${pct(agg.err, 0.95).toFixed(1)} | ${agg.wrong} |`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'responsiveness.md'), out.join('\n') + '\n');
