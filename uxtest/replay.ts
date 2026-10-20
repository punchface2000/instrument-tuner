// Offline replay of a session through the engine (same code as the app, no UI).
// Writes logs/<session>.offline.json in the browser log format so score.py works,
// and with --trace prints a per-reading trace between two times.
//   npx tsx uxtest/replay.ts <session> [--trace from to]
// Optional engine overrides for experiments: TUNING='{"focus":false}' npx tsx …
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { TunerEngine } from '../src/engine';

const BASE = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const ti = process.argv.indexOf('--trace');
const [tFrom, tTo] = ti > 0 ? [Number(process.argv[ti + 1]), Number(process.argv[ti + 2])] : [Infinity, -Infinity];
const meta = JSON.parse(readFileSync(`${BASE}/www/sessions/${name}.json`, 'utf8'));
const buf = readFileSync(`${BASE}/www/sessions/${name}.wav`);
let off = 12, dataOff = 0, dataLen = 0;
while (off < buf.length) {
  const id = buf.toString('ascii', off, off + 4);
  const size = buf.readUInt32LE(off + 4);
  if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
  off += 8 + size;
}
const n = dataLen / 2;
const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(dataOff + 2 * i) / 32768;

const e = new TunerEngine(48000, { a4: 440, toleranceCents: 3, mode: 'instrument', instrumentId: meta.instrument, tuningId: 'standard', lockedString: null }, { debug: true, ...JSON.parse(process.env.TUNING ?? '{}') });
const frames: unknown[] = [];
const tl = meta.timeline;
for (let i = 0; i + 1024 <= n; i += 1024) {
  const r = e.push(x.subarray(i, i + 1024));
  const t = (i + 1024) / 48000;
  if (!r) continue;
  const note = r.active ? r.targetName : '';
  frames.push([t, t, r.active ? 'active' : 'listening', r.held, r.active && r.inTune, note, '', '',
    r.active ? Math.max(-50, Math.min(50, r.cents)) : 0, note || null, [...e.tuned].map((k) => e.targetStrings[k].name).join(',')]);
  if (t >= tFrom && t <= tTo) {
    const j = Math.round(t / 0.01);
    const tr = tl[j];
    const dbg = (e as unknown as { lastDebug?: string }).lastDebug ?? '';
    console.log(`${t.toFixed(3)} truth ${tr?.[1]?.toFixed(2) ?? '-'} (${tr?.[2] ?? '-'} ${tr?.[3] ?? ''}) | shown ${r.active ? (r.held ? 'held ' : 'LIVE ') + r.targetName + ' ' + r.cents.toFixed(1) + 'c f=' + r.freq.toFixed(2) : '----'} conf ${r.confidence.toFixed(2)} lvl ${r.levelDb.toFixed(0)} ${dbg}`);
  }
}
mkdirSync(`${BASE}/logs`, { recursive: true });
writeFileSync(`${BASE}/logs/off_${name}.json`, JSON.stringify({ session: name, frames, errors: [] }));
