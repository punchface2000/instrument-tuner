// Reference tone: a soft, slightly bright tone at a target pitch so it is
// easy to tune by ear. Sine plus a quiet 2nd and 3rd harmonic, with a short
// attack and release to avoid clicks.

export class ReferenceTone {
  private nodes: { oscs: OscillatorNode[]; gain: GainNode } | null = null;
  private stopTimer: number | undefined;

  constructor(private readonly ctx: AudioContext) {}

  get playing(): boolean {
    return this.nodes !== null;
  }

  play(freq: number, seconds = 2.5, volume = 0.25): void {
    this.stop(true);
    const ctx = this.ctx;
    void ctx.resume();
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.03);
    gain.gain.setValueAtTime(volume, t + seconds - 0.25);
    gain.gain.linearRampToValueAtTime(0, t + seconds);
    gain.connect(ctx.destination);

    const oscs = [1, 2, 3].map((k, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq * k;
      const g = ctx.createGain();
      g.gain.value = [1, 0.25, 0.1][i];
      o.connect(g).connect(gain);
      o.start(t);
      o.stop(t + seconds + 0.05);
      return o;
    });
    this.nodes = { oscs, gain };
    this.stopTimer = window.setTimeout(() => this.stop(true), seconds * 1000 + 80);
  }

  stop(immediate = false): void {
    window.clearTimeout(this.stopTimer);
    if (!this.nodes) return;
    const { oscs, gain } = this.nodes;
    const t = this.ctx.currentTime;
    if (!immediate) {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.08);
      oscs.forEach((o) => o.stop(t + 0.1));
    } else {
      oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
      gain.disconnect();
    }
    this.nodes = null;
  }
}
