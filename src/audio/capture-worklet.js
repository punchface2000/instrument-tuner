// AudioWorklet processor: forwards mono microphone samples to the main thread
// in blocks of ~1024 frames (fewer messages than the native 128-frame quanta).
// Loaded as a raw string and turned into a Blob URL, so the app can ship as a
// single HTML file.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        this.block[this.fill++] = ch[i];
        if (this.fill === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(1024);
          this.fill = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
