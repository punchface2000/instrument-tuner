// Microphone capture: getUserMedia → AudioWorklet → onSamples callback.

import workletSource from './capture-worklet.js?raw';

export type MicErrorKind = 'denied' | 'no-device' | 'insecure' | 'unsupported' | 'other';

export class MicError extends Error {
  constructor(readonly kind: MicErrorKind, message: string) {
    super(message);
  }
}

export interface MicDevice {
  id: string;
  label: string;
}

export class MicInput {
  readonly context: AudioContext;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private workletLoaded = false;
  private useScriptProcessor = false;
  private scriptNode: ScriptProcessorNode | null = null;
  private channel = -1;
  /** Called when inputs are plugged in or removed. */
  onDevicesChanged: (() => void) | null = null;

  constructor(private readonly onSamples: (block: Float32Array) => void) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctx({ latencyHint: 'interactive' });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.onDevicesChanged?.());
  }

  /** Channels delivered by the current input (2+ on many audio interfaces). */
  get channelCount(): number {
    const s = this.stream?.getAudioTracks()[0]?.getSettings();
    return Math.max(1, s?.channelCount ?? 1);
  }

  /** Use one channel of a multi-channel input (0-based), or -1 to mix them all. */
  setChannel(channel: number): void {
    this.channel = channel;
    this.node?.port.postMessage({ channel });
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  get running(): boolean {
    return this.stream !== null;
  }

  /** Ask for the microphone (or a specific input) and start streaming samples. */
  async start(deviceId?: string): Promise<void> {
    if (!window.isSecureContext) {
      throw new MicError('insecure', 'The microphone only works on https:// pages or on localhost.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicError('unsupported', 'This browser does not support microphone audio processing.');
    }
    this.stop();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // Voice processing distorts musical pitch and level; turn it all off.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Ask for up to 2 channels so a guitar on input 2 of an interface is
          // reachable; ordinary mics still give 1.
          channelCount: { ideal: 2 },
        },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new MicError('denied', 'Microphone access was blocked.');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new MicError('no-device', 'No microphone was found.');
      }
      throw new MicError('other', (e as Error)?.message ?? String(e));
    }

    if (!this.workletLoaded && !this.useScriptProcessor) {
      const url = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));
      try {
        await this.context.audioWorklet.addModule(url);
        this.workletLoaded = true;
      } catch {
        // Pages opened from a local file (file://) cannot load a worklet from a
        // blob URL. Fall back to the older ScriptProcessorNode, which works anywhere.
        this.useScriptProcessor = true;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    await this.context.resume();

    this.stream = stream;
    this.source = this.context.createMediaStreamSource(stream);
    if (this.useScriptProcessor) {
      const sp = this.context.createScriptProcessor(1024, 2, 1);
      sp.onaudioprocess = (ev) => {
        const b = ev.inputBuffer;
        const ch = this.channel;
        if (ch >= 0 && ch < b.numberOfChannels) return this.onSamples(Float32Array.from(b.getChannelData(ch)));
        const out = Float32Array.from(b.getChannelData(0));
        for (let c = 1; c < b.numberOfChannels; c++) {
          const d = b.getChannelData(c);
          for (let i = 0; i < out.length; i++) out[i] += d[i];
        }
        if (b.numberOfChannels > 1) for (let i = 0; i < out.length; i++) out[i] /= b.numberOfChannels;
        this.onSamples(out);
      };
      this.source.connect(sp);
      sp.connect(this.context.destination); // required for it to run; it outputs silence
      this.scriptNode = sp;
    } else {
      this.node = new AudioWorkletNode(this.context, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        // keep the input's own channels (a mono mic arrives as 1 channel)
        channelCountMode: 'max',
        channelInterpretation: 'discrete',
      });
      this.node.port.onmessage = (ev: MessageEvent<Float32Array>) => this.onSamples(ev.data);
      this.node.port.postMessage({ channel: this.channel });
      this.source.connect(this.node);
    }
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.scriptNode = null;
    this.source = null;
    this.stream = null;
  }

  /** Track id of the input in use, so the device picker can show it. */
  get currentDeviceId(): string | undefined {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId;
  }

  static async listInputs(): Promise<MicDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }
}
