// Streaming playback of linear16 PCM (mono, 24 kHz) from the agent. Chunks are
// scheduled back-to-back for gapless audio; interrupt() supports barge-in. All
// sources route through an analyser so the UI can drive the voice blob from
// the agent's actual output level.
export class PcmPlayer {
  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    this.ctx = null;
    this.nextTime = 0;
    this.sources = new Set();
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.nextTime = 0;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.levelBuf = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  enqueue(arrayBuffer) {
    this.ensure();
    const count = Math.floor(arrayBuffer.byteLength / 2);
    if (count === 0) return;
    const pcm = new Int16Array(arrayBuffer, 0, count);

    const buf = this.ctx.createBuffer(1, count, this.sampleRate);
    const f = buf.getChannelData(0);
    for (let i = 0; i < count; i++) f[i] = pcm[i] / 0x8000;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);

    const start = Math.max(this.ctx.currentTime + 0.02, this.nextTime);
    src.start(start);
    this.nextTime = start + buf.duration;

    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  // RMS output level, 0..~1 — drives the agent blob's animation.
  getLevel() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.levelBuf.length);
  }

  // Barge-in: stop and drop anything queued so the agent cuts off immediately.
  interrupt() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    if (this.ctx) this.nextTime = this.ctx.currentTime;
  }

  async close() {
    this.interrupt();
    if (this.ctx && this.ctx.state !== "closed") {
      await this.ctx.close();
    }
    this.ctx = null;
  }
}
