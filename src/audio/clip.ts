// Troubleshooting clips: keeps the last few seconds of raw microphone audio and
// what the tuner showed, and saves them as one WAV file. The settings and the
// reading log go in a custom "tunr" chunk (JSON) that audio players ignore, so
// the file plays normally and can be replayed through uxtest/replay.ts.

export interface ClipReading {
  t: number; // seconds since the clip buffer started
  active: boolean;
  held: boolean;
  note: string;
  cents: number;
  freq: number;
  inTune: boolean;
}

export class ClipRecorder {
  private readonly buf: Float32Array;
  private write = 0;
  private filled = 0;
  private readings: ClipReading[] = [];
  private samplesSeen = 0;

  constructor(readonly sampleRate: number, readonly seconds = 10) {
    this.buf = new Float32Array(Math.round(sampleRate * seconds));
  }

  get hasAudio(): boolean {
    return this.filled > this.sampleRate * 0.5;
  }

  push(block: Float32Array): void {
    const b = this.buf;
    for (let i = 0; i < block.length; i++) {
      b[this.write] = block[i];
      this.write = (this.write + 1) % b.length;
    }
    this.filled = Math.min(b.length, this.filled + block.length);
    this.samplesSeen += block.length;
  }

  note(r: Omit<ClipReading, 't'>): void {
    const t = this.samplesSeen / this.sampleRate;
    this.readings.push({ t: +t.toFixed(3), ...r, cents: +r.cents.toFixed(2), freq: +r.freq.toFixed(3) });
    const oldest = t - this.seconds;
    while (this.readings.length && this.readings[0].t < oldest) this.readings.shift();
  }

  /** WAV (16-bit mono) of the buffered audio with `meta` and the reading log embedded. */
  toWav(meta: Record<string, unknown>): Blob {
    const n = this.filled;
    const start = (this.write - n + this.buf.length) % this.buf.length;
    const startT = (this.samplesSeen - n) / this.sampleRate;
    const readings = this.readings
      .filter((r) => r.t >= startT)
      .map((r) => ({ ...r, t: +(r.t - startT).toFixed(3) }));
    const json = new TextEncoder().encode(JSON.stringify({ ...meta, sampleRate: this.sampleRate, readings }));
    const jsonLen = json.length + (json.length % 2); // chunks are word-aligned
    const dataLen = n * 2;
    const size = 12 + 24 + (8 + jsonLen) + (8 + dataLen);
    const ab = new ArrayBuffer(size);
    const dv = new DataView(ab);
    let o = 0;
    const str = (s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
    str('RIFF'); dv.setUint32(o, size - 8, true); o += 4; str('WAVE');
    str('fmt '); dv.setUint32(o, 16, true); o += 4;
    dv.setUint16(o, 1, true); o += 2; // PCM
    dv.setUint16(o, 1, true); o += 2; // mono
    dv.setUint32(o, this.sampleRate, true); o += 4;
    dv.setUint32(o, this.sampleRate * 2, true); o += 4;
    dv.setUint16(o, 2, true); o += 2;
    dv.setUint16(o, 16, true); o += 2;
    str('tunr'); dv.setUint32(o, jsonLen, true); o += 4;
    new Uint8Array(ab, o, json.length).set(json); o += jsonLen;
    str('data'); dv.setUint32(o, dataLen, true); o += 4;
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, this.buf[(start + i) % this.buf.length]));
      dv.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
  }
}

/** Hand a file to the user: the share sheet on phones (AirDrop, Messages, Files), a download elsewhere. */
export async function deliverFile(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // fall through to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
