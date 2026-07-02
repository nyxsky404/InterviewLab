// AudioWorkletProcessor: takes mic audio at the context sample rate, resamples
// it to the target rate (16 kHz) with linear interpolation, converts to signed
// 16-bit PCM, and posts ~40 ms chunks to the main thread as ArrayBuffers.
class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = (options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    this.ratio = sampleRate / target; // sampleRate is a global in worklet scope
    this.idx = 0; // fractional read position relative to current input buffer
    this.prev = 0; // last sample of the previous buffer (for cross-buffer interp)
    this.acc = []; // accumulated output samples before flushing
    this.flushAt = Math.round(target * 0.04); // ~40 ms
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const n = ch.length;

    let idx = this.idx;
    while (idx < n) {
      const i0 = Math.floor(idx);
      if (i0 + 1 >= n) break; // need a sample from the next buffer to interpolate
      const frac = idx - i0;
      const s0 = i0 < 0 ? this.prev : ch[i0];
      const s1 = ch[i0 + 1];
      this.acc.push(s0 + (s1 - s0) * frac);
      idx += this.ratio;
    }
    this.idx = idx - n;
    this.prev = ch[n - 1];

    if (this.acc.length >= this.flushAt) this.flush();
    return true;
  }

  flush() {
    const pcm = new Int16Array(this.acc.length);
    for (let i = 0; i < this.acc.length; i++) {
      let s = this.acc[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.acc.length = 0;
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
