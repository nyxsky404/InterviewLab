// Captures microphone audio and emits 16 kHz linear16 PCM chunks (ArrayBuffer)
// via the pcm-recorder AudioWorklet. Also exposes a live input level (0..1)
// for the speaking indicator, and a mute that zeroes outgoing audio without
// breaking the stream's cadence.
export class MicRecorder {
  constructor() {
    this.muted = false;
  }

  async start(onChunk) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    await this.ctx.audioWorklet.addModule("/pcm-recorder-worklet.js");

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-recorder", {
      processorOptions: { targetSampleRate: 16000 },
    });
    this.node.port.onmessage = (e) => {
      if (this.muted) {
        // Keep the byte cadence but send silence, so muting doesn't create
        // stream gaps — Deepgram just hears a quiet room.
        onChunk(new ArrayBuffer(e.data.byteLength));
      } else {
        onChunk(e.data);
      }
    };

    // Level meter for the "you're speaking" indicator.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.levelBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.source.connect(this.analyser);

    // Route through a muted gain so the graph keeps pulling audio without
    // echoing the mic back to the speakers.
    this.gate = this.ctx.createGain();
    this.gate.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.gate);
    this.gate.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
  }

  // RMS input level, 0..~1.
  getLevel() {
    if (!this.analyser || this.muted) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.levelBuf.length);
  }

  async stop() {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.gate?.disconnect();
      this.analyser?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    } catch {
      /* ignore */
    }
  }
}
