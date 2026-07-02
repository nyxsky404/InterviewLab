// Captures microphone audio and emits 16 kHz linear16 PCM chunks (ArrayBuffer)
// via the pcm-recorder AudioWorklet.
export class MicRecorder {
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
    this.node.port.onmessage = (e) => onChunk(e.data);

    // Route through a muted gain so the graph keeps pulling audio without
    // echoing the mic back to the speakers.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.mute);
    this.mute.connect(this.ctx.destination);
  }

  async stop() {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.mute?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    } catch {
      /* ignore */
    }
  }
}
