export class PlaybackClock {
  constructor(count, fps, mode = "once") {
    if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error("无效的动画帧数");
    this.count = count;
    this.position = 0;
    this.elapsed = 0;
    this.playing = false;
    this.setFps(fps);
    this.setMode(mode);
  }
  get index() {
    if (this.mode === "pingpong" && this.count > 1) {
      const period = 2 * (this.count - 1);
      const phase = this.position % period;
      return phase < this.count ? phase : period - phase;
    }
    return Math.min(this.position, this.count - 1);
  }
  setFps(fps) {
    const value = Number(fps);
    if (!Number.isFinite(value) || value < 0.1 || value > 60) throw new Error("FPS 需要在 0.1 到 60 之间");
    this.fps = value;
    this.elapsed = 0;
  }
  setMode(mode) {
    if (!["once", "loop", "pingpong"].includes(mode)) throw new Error("无效的播放方式");
    this.position = this.index;
    this.mode = mode;
    this.elapsed = 0;
  }
  restart() { this.position = 0; this.elapsed = 0; this.playing = true; }
  toggle() {
    if (!this.playing && this.mode === "once" && this.position >= this.count) this.restart();
    else this.playing = !this.playing;
  }
  advance(milliseconds) {
    if (!this.playing || !Number.isFinite(milliseconds) || milliseconds <= 0) return this.index;
    this.elapsed += milliseconds;
    const duration = 1000 / this.fps;
    const steps = Math.floor((this.elapsed + 1e-8) / duration);
    this.elapsed = Math.max(0, this.elapsed - steps * duration);
    this.position += steps;
    if (this.mode === "once") {
      if (this.position >= this.count) { this.position = this.count; this.playing = false; this.elapsed = 0; }
    } else {
      const period = this.mode === "loop" ? this.count : Math.max(1, 2 * (this.count - 1));
      this.position %= period;
    }
    return this.index;
  }
}
