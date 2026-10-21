// Plays a reference note with the instrument's own sound: a pitch-corrected
// recording (guitar, violin) or the modelled plucked string (bass, ukulele,
// and notes outside the recorded range). Falls back to a plain tone if a
// recording cannot be loaded.

import { chooseSource, type Source } from './reference-source';
import { renderPluck, VOICES } from './pluck';
import { ReferenceTone } from './reference-tone';

export class ReferencePlayer {
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private current: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private readonly fallback: ReferenceTone;
  private endTimer: number | undefined;
  /** Called when the note finishes or is stopped. */
  onEnded: (() => void) | null = null;

  constructor(private readonly ctx: AudioContext) {
    this.fallback = new ReferenceTone(ctx);
  }

  /** Start loading the sounds for these notes so the first tap plays at once. */
  preload(instrumentId: string, midis: number[], a4: number): void {
    for (const m of midis) void this.bufferFor(chooseSource(instrumentId, m, a4)).catch(() => {});
  }

  /** Play `midi` for `instrumentId`. Resolves with the length in seconds once sound starts. */
  async play(instrumentId: string, midi: number, a4: number): Promise<number> {
    this.stop();
    void this.ctx.resume();
    const source = chooseSource(instrumentId, midi, a4);
    let buffer: AudioBuffer;
    try {
      buffer = await this.bufferFor(source);
    } catch {
      // Recording unavailable (e.g. offline before it was ever cached): plain tone.
      const freq = 440 * Math.pow(2, (midi - 69) / 12) * (a4 / 440);
      this.fallback.play(freq, 2.5);
      this.scheduleEnd(2.5);
      return 2.5;
    }
    const rate = source.kind === 'sample' ? source.rate : 1;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.9, t);
    src.connect(gain).connect(this.ctx.destination);
    src.start(t);
    const seconds = buffer.duration / rate;
    this.current = { src, gain };
    src.onended = () => {
      if (this.current?.src === src) this.current = null;
    };
    this.scheduleEnd(seconds);
    return seconds;
  }

  /**
   * Render what `play` would sound like, offline (same buffer, same playback
   * rate). Used by the browser tests to check the pitch of every reference.
   */
  async render(instrumentId: string, midi: number, a4: number, seconds = 2): Promise<Float32Array> {
    const source = chooseSource(instrumentId, midi, a4);
    const buffer = await this.bufferFor(source);
    const sr = this.ctx.sampleRate;
    const off = new OfflineAudioContext(1, Math.round(seconds * sr), sr);
    const s = off.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = source.kind === 'sample' ? source.rate : 1;
    s.connect(off.destination);
    s.start();
    return (await off.startRendering()).getChannelData(0);
  }

  stop(): void {
    window.clearTimeout(this.endTimer);
    this.fallback.stop();
    if (this.current) {
      const { src, gain } = this.current;
      const t = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.06);
      try {
        src.stop(t + 0.07);
      } catch {
        /* already stopped */
      }
      this.current = null;
    }
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  get playing(): boolean {
    return this.current !== null;
  }

  private scheduleEnd(seconds: number) {
    window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => this.onEnded?.(), seconds * 1000);
  }

  private bufferFor(source: Source): Promise<AudioBuffer> {
    const key = source.kind === 'sample' ? source.file : `${source.voice}:${source.freq.toFixed(4)}`;
    let p = this.buffers.get(key);
    if (!p) {
      p = source.kind === 'sample' ? this.loadSample(source.file) : Promise.resolve(this.renderModel(source.voice, source.freq));
      p.catch(() => this.buffers.delete(key)); // allow a retry later
      this.buffers.set(key, p);
    }
    return p;
  }

  private async loadSample(file: string): Promise<AudioBuffer> {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    const data = await res.arrayBuffer();
    return await this.ctx.decodeAudioData(data);
  }

  private renderModel(voiceId: string, freq: number): AudioBuffer {
    const voice = VOICES[voiceId] ?? VOICES.guitar;
    const sr = this.ctx.sampleRate;
    const x = renderPluck(freq, sr, voice);
    const buf = this.ctx.createBuffer(1, x.length, sr);
    buf.getChannelData(0).set(x);
    return buf;
  }
}
