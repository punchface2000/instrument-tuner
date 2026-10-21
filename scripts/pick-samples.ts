// Pick the best candidate of every reference note, judged by the tuner itself.
//
//   npx tsx scripts/pick-samples.ts     (after: python3 scripts/make-samples.py)
//
// For each note, every candidate WAV in .sample-build/ is streamed through
// TunerEngine with a one-string tuning of that note. The steadiest candidate
// (smallest spread, correct note) wins and is encoded to MP3. Its remaining
// median offset is stored as `cents`, and the player corrects for it, so the
// reference is exactly on pitch as the tuner reads it. Notes whose best
// candidate still wavers more than MAX_SPREAD are left out; the app then uses a
// neighbouring note or the modelled string.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TunerEngine, type Reading } from '../src/engine';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, '.sample-build');
const SR = 48000;
const MAX_SPREAD = 4; // cents, 95th percentile around the median

export function decode(path: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 64 << 20,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

/** How the tuner reads `x` as the note `note`: median cents and 95th-percentile spread, 0.25–2.2 s. */
export function measure(x: Float32Array, note: string, instrumentId: string) {
  const e = new TunerEngine(SR, {
    a4: 440, toleranceCents: 3, mode: 'instrument', instrumentId, tuningId: 'check', strings: [note], lockedString: null,
  });
  const cents: number[] = [];
  for (let i = 0; i + 1024 <= x.length; i += 1024) {
    const r: Reading | null = e.push(x.subarray(i, i + 1024));
    const t = (i + 1024) / SR;
    if (r?.active && !r.held && t >= 0.25 && t <= 2.2) cents.push(r.cents);
  }
  const sorted = [...cents].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] ?? NaN;
  const dev = cents.map((c) => Math.abs(c - median)).sort((a, b) => a - b);
  return { median, spread: dev[Math.floor(dev.length * 0.95)] ?? Infinity, n: cents.length };
}

type Plan = Record<string, { maxDown: number; maxUp: number; credit: string; notes: { note: string; midi: number; candidates: string[] }[] }>;

if (process.argv[1]?.endsWith('pick-samples.ts')) {
  const plan = JSON.parse(readFileSync(join(BUILD, 'plan.json'), 'utf8')) as Plan;
  const manifest: Record<string, unknown> = {};
  rmSync(join(ROOT, 'public/samples'), { recursive: true, force: true });
  for (const [inst, p] of Object.entries(plan)) {
    mkdirSync(join(ROOT, 'public/samples', inst), { recursive: true });
    const files = [];
    for (const n of p.notes) {
      const fileNote = n.note.replace('#', 's');
      const results = n.candidates.map((m) => ({ m, ...measure(decode(join(BUILD, inst, `${fileNote}.${m}.wav`)), n.note, inst) }));
      const best = results.filter((r) => r.n > 50).sort((a, b) => a.spread - b.spread)[0];
      const summary = results.map((r) => `${r.m} ±${r.spread.toFixed(1)}`).join('  ');
      if (!best || best.spread > MAX_SPREAD) {
        console.log(`skip ${inst.padEnd(7)} ${n.note.padEnd(4)} ${summary}`);
        continue;
      }
      const rel = `samples/${inst}/${fileNote}.mp3`;
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(BUILD, inst, `${fileNote}.${best.m}.wav`), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', join(ROOT, 'public', rel)]);
      const final = measure(decode(join(ROOT, 'public', rel)), n.note, inst);
      files.push({ note: n.note, midi: n.midi, file: rel, cents: +final.median.toFixed(2) });
      console.log(`keep ${inst.padEnd(7)} ${n.note.padEnd(4)} ${best.m.padEnd(9)} mp3: ${final.median >= 0 ? '+' : ''}${final.median.toFixed(2)}c ±${final.spread.toFixed(2)}   (${summary})`);
    }
    manifest[inst] = { maxDown: p.maxDown, maxUp: p.maxUp, credit: p.credit, files };
  }
  writeFileSync(join(ROOT, 'src/audio/samples.json'), JSON.stringify(manifest, null, 1) + '\n');
}
