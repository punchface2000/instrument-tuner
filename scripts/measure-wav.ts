// Measure WAV files the way the tuner hears them (used by browser tests):
//   npx tsx scripts/measure-wav.ts <note> <instrumentId> <a4> <file.wav> [...more note/inst/a4/file groups]
import { readFileSync } from 'node:fs';
import { TunerEngine, type Reading } from '../src/engine';

function readWav(path: string): { sr: number; x: Float32Array } {
  const b = readFileSync(path);
  let o = 12, sr = 48000, data: Float32Array | null = null;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') sr = b.readUInt32LE(o + 12);
    if (id === 'data') {
      data = new Float32Array(size / 2);
      for (let i = 0; i < data.length; i++) data[i] = b.readInt16LE(o + 8 + 2 * i) / 32768;
    }
    o += 8 + size + (size % 2);
  }
  return { sr, x: data! };
}

const a = process.argv.slice(2);
for (let k = 0; k + 3 < a.length; k += 4) {
  const [note, inst, a4s, file] = a.slice(k, k + 4);
  const { sr, x } = readWav(file);
  const e = new TunerEngine(sr, { a4: Number(a4s), toleranceCents: 3, mode: 'instrument', instrumentId: inst, tuningId: 'x', strings: [note], lockedString: null });
  const c: number[] = [];
  for (let i = 0; i + 1024 <= x.length; i += 1024) {
    const r: Reading | null = e.push(x.subarray(i, i + 1024));
    if (r?.active && !r.held && i / sr > 0.25 && i / sr < 1.8) c.push(r.cents);
  }
  c.sort((p, q) => p - q);
  const med = c[c.length >> 1];
  const spread = Math.max(Math.abs(c[Math.floor(c.length * 0.05)] - med), Math.abs(c[Math.floor(c.length * 0.95)] - med));
  console.log(JSON.stringify({ note, inst, a4: Number(a4s), median: +med.toFixed(2), spread: +spread.toFixed(2), n: c.length }));
}
