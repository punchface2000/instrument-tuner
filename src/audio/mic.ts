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

  constructor(private readonly onSamples: (block: Float32Array) => void) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctx({ latencyHint: 'interactive' });
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
          channelCount: 1,
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
      const sp = this.context.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (ev) => this.onSamples(Float32Array.from(ev.inputBuffer.getChannelData(0)));
      this.source.connect(sp);
      sp.connect(this.context.destination); // required for it to run; it outputs silence
      this.scriptNode = sp;
    } else {
      this.node = new AudioWorkletNode(this.context, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.node.port.onmessage = (ev: MessageEvent<Float32Array>) => this.onSamples(ev.data);
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
