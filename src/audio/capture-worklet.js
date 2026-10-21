// AudioWorklet processor: forwards microphone samples to the main thread in
// blocks of 1024 frames (fewer messages than the native 128-frame quanta).
//
// Audio interfaces often deliver several channels (input 1 = guitar,
// input 2 = mic). The page picks which one to use: a channel index, or -1 to
// mix all of them. Loaded as a raw string and turned into a Blob URL, so the
// app can ship as a single HTML file.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.fill = 0;
    this.channel = -1;
    this.port.onmessage = (ev) => {
      if (ev.data && typeof ev.data.channel === 'number') this.channel = ev.data.channel;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const n = input[0].length;
    const nch = input.length;
    const ch = this.channel;
    for (let i = 0; i < n; i++) {
      let v;
      if (ch >= 0 && ch < nch) v = input[ch][i];
      else {
        v = 0;
        for (let c = 0; c < nch; c++) v += input[c][i];
        v /= nch;
      }
      this.block[this.fill++] = v;
      if (this.fill === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(1024);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
