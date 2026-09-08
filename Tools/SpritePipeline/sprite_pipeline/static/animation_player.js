import { PlaybackClock } from "/pixel-editor-assets/animation_player_core.js?v=1";

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const prefix = `/v1/jobs/${encodeURIComponent(query.get("job_id") || "")}/candidates/${encodeURIComponent(query.get("candidate") || "")}/playback`;
let clock = null;
let images = [];
let normalFps = 8;
let lastTime = null;
let drawnIndex = -1;
let loading = false;

function render() {
  if (!clock) return;
  if (drawnIndex !== clock.index) {
    const canvas = $("animationCanvas");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(images[clock.index], 0, 0);
    drawnIndex = clock.index;
  }
  $("frameLabel").textContent = `第 ${clock.index + 1} / ${clock.count} 帧`;
  $("play").textContent = clock.playing ? "暂停" : "播放";
  for (const button of document.querySelectorAll("[data-speed]")) {
    button.setAttribute("aria-pressed", String(Math.abs(clock.fps - Math.min(60, Math.max(0.1, normalFps * Number(button.dataset.speed)))) < 0.001));
  }
}

async function fetchLocal(url) {
  const response = await fetch(url, {cache: "no-store", signal: AbortSignal.timeout(15000)});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || "动画读取失败，请刷新当前结果");
  }
  return response;
}

async function load() {
  if (loading) return;
  loading = true;
  if (clock) clock.playing = false;
  $("controls").disabled = true;
  $("animationCanvas").getContext("2d").clearRect(0, 0, $("animationCanvas").width, $("animationCanvas").height);
  drawnIndex = -1;
  $("retry").hidden = true;
  $("status").textContent = "正在读取当前版本的全部画面……";
  try {
    const payload = await (await fetchLocal(prefix)).json();
    const data = payload.data.playback;
    if (!Array.isArray(data.frames) || data.frames.length < 1 || data.frames.length > 64) throw new Error("当前动画没有可播放的画面");
    const loaded = await Promise.allSettled(data.frames.map(async (frame) => {
      const response = await fetchLocal(frame.url);
      return createImageBitmap(await response.blob());
    }));
    const failed = loaded.find((item) => item.status === "rejected");
    if (failed) {
      for (const item of loaded) if (item.status === "fulfilled") item.value.close();
      throw failed.reason;
    }
    for (const image of images) image.close();
    images = loaded.map((item) => item.value);
    normalFps = Number(data.fps);
    clock = new PlaybackClock(images.length, normalFps, data.loop ? "loop" : "once");
    $("animationCanvas").width = data.width;
    $("animationCanvas").height = data.height;
    $("fps").value = String(normalFps);
    $("mode").value = clock.mode;
    $("hint").textContent = `正常速度 ${normalFps} FPS · 播放设置只影响预览，导出仍按原规格。`;
    $("status").textContent = "";
    $("controls").disabled = false;
    drawnIndex = -1;
    lastTime = null;
    clock.restart();
    render();
  } catch (error) {
    $("status").textContent = error.name === "TimeoutError" ? "读取动画超时，请重新读取。" : error.message;
    $("retry").hidden = false;
  } finally { loading = false; }
}

function setFps(value) {
  try { clock.setFps(value); $("fps").value = String(clock.fps); $("status").textContent = ""; lastTime = null; render(); }
  catch (error) { $("status").textContent = error.message; $("fps").value = String(clock.fps); }
}
$("fps").addEventListener("change", (event) => setFps(event.target.value));
for (const button of document.querySelectorAll("[data-speed]")) button.addEventListener("click", () => setFps(Math.min(60, Math.max(0.1, normalFps * Number(button.dataset.speed)))));
$("mode").addEventListener("change", (event) => { clock.setMode(event.target.value); clock.restart(); lastTime = null; render(); });
$("play").addEventListener("click", () => { clock.toggle(); lastTime = null; render(); });
$("restart").addEventListener("click", () => { clock.restart(); lastTime = null; render(); });
$("retry").addEventListener("click", load);
document.addEventListener("visibilitychange", () => { lastTime = null; });
function tick(now) {
  if (clock && !document.hidden && !loading) {
    if (lastTime !== null) clock.advance(Math.min(250, now - lastTime));
    render();
  }
  lastTime = document.hidden ? null : now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
load();
