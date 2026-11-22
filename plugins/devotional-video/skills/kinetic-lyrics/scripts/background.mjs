#!/usr/bin/env node
// Turns a still image into a background video: the image fills the frame (centre crop, never moving, so a
// --text-box measured on it stays aligned) and original drawn flowers and sparkles drift across it.
// Usage: node background.mjs --image gate.png --duration 358.97 --out bg.mp4 [--zoom 1.2 --focus-y 0.6] [--vertical [--band 1.5,260]] [--overwrite] [--still t]
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer";

const FPS = 30;
const { values: args } = parseArgs({
  options: {
    image: { type: "string" }, duration: { type: "string" }, out: { type: "string" },
    vertical: { type: "boolean", default: false }, overwrite: { type: "boolean", default: false },
    still: { type: "string" }, flowers: { type: "string", default: "14" },
    zoom: { type: "string", default: "1" }, "focus-y": { type: "string", default: "0.5" },
    band: { type: "string" },
  },
});
const fail = (m) => { console.error(m); process.exit(2); };
if (!args.image || !args.out || (!args.duration && !args.still)) fail("--image, --out and --duration (or --still <sec>) are required");
if (existsSync(args.out) && !args.overwrite) fail(`${args.out} exists; ask the user, then pass --overwrite`);
const [W, H] = args.vertical ? [1080, 1920] : [1280, 720];
const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(args.image).toLowerCase()];
if (!mime) fail("--image must be png, jpg or webp");
const src = `data:${mime};base64,${readFileSync(args.image).toString("base64")}`;

const browser = await puppeteer.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error(e); process.exit(1); });
await page.setContent(`<!doctype html><canvas id="c" width="${W}" height="${H}"></canvas>`);
await page.evaluate(async (src, W, H, count, zoom, focusY, band) => {
  const ctx = document.getElementById("c").getContext("2d");
  const img = new Image(); img.src = src; await img.decode();
  // Cover-fit, centred, high-quality resampling.
  // --zoom enlarges about the horizontal centre and --focus-y (0 top, 1 bottom), which stays fixed in the frame.
  const k = Math.max(W / img.width, H / img.height) * zoom, w = img.width * k, h = img.height * k;
  const base = document.createElement("canvas"); base.width = W; base.height = H;
  const b = base.getContext("2d"); b.imageSmoothingQuality = "high";
  if (band) {
    // --band scale,y: a tall frame shows the image sharp at `scale` x frame-width, top edge at y, over a soft
    // blurred cover-fill of the same image.
    const [scale, y] = band, bw = W * scale, bh = (img.height * bw) / img.width;
    b.filter = "blur(28px) brightness(1.04)";
    b.drawImage(img, (W - w) / 2 - 40, (H - h) / 2 - 40, w + 80, h + 80);
    b.filter = "none";
    // Feather the band's top and bottom edges into the blur.
    const layer = document.createElement("canvas"); layer.width = W; layer.height = Math.ceil(bh);
    const l = layer.getContext("2d"); l.imageSmoothingQuality = "high";
    l.drawImage(img, (W - bw) / 2, 0, bw, bh);
    l.globalCompositeOperation = "destination-in";
    const fade = l.createLinearGradient(0, 0, 0, bh);
    fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(0.06, "#000"); fade.addColorStop(0.92, "#000"); fade.addColorStop(1, "rgba(0,0,0,0)");
    l.fillStyle = fade; l.fillRect(0, 0, W, bh);
    b.drawImage(layer, 0, y);
  } else {
    const top = Math.min(0, Math.max(H - h, H * focusY - h * focusY));
    b.drawImage(img, (W - w) / 2, top, w, h);
  }

  const seeded = (n, salt) => { const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };
  const S = Math.min(W, H) / 720;
  // Five-petal blossom: white with a yellow heart, or pink with a deeper centre.
  function blossom(x, y, r, angle, pink, flip) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(1, flip);
    for (let p = 0; p < 5; p++) {
      ctx.save(); ctx.rotate((p * 2 * Math.PI) / 5);
      const g = ctx.createLinearGradient(0, 0, 0, -r);
      g.addColorStop(0, pink ? "#d94f86" : "#ffd23f"); g.addColorStop(0.45, pink ? "#f7a1c4" : "#fff6d8"); g.addColorStop(1, pink ? "#ffd6e6" : "#ffffff");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(r * 0.08, -r * 0.5, r * 0.3, r * 0.52, 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = pink ? "#b8326a" : "#f2a900";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function sparkle(x, y, r, a) {
    ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(255,255,255,0.9)"; ctx.shadowBlur = r * 1.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.18 : r; const t = (i * Math.PI) / 4; ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  window.frame = (t, type) => {
    ctx.drawImage(base, 0, 0);
    // Sparkles twinkle in the sky (upper part of the frame).
    for (let n = 0; n < 18; n++) {
      const period = 2.5 + seeded(n, 1) * 2.5, phase = ((t / period + seeded(n, 2)) % 1);
      const a = Math.sin(phase * Math.PI) ** 3;
      sparkle(W * (0.04 + 0.92 * seeded(n, 3)), H * (0.04 + 0.4 * seeded(n, 4)), (7 + seeded(n, 5) * 9) * S, a);
    }
    // Blossoms fall slowly with a sway and a paper-like flip; each loops back to the top.
    for (let n = 0; n < count; n++) {
      const speed = (26 + seeded(n, 6) * 30) * S, fall = H + 120 * S;
      const y = -60 * S + ((t * speed + seeded(n, 7) * fall) % fall);
      const x = W * seeded(n, 8) + Math.sin(t * (0.5 + seeded(n, 9) * 0.6) + n) * 40 * S + t * 6 * S * (seeded(n, 10) - 0.5);
      const r = (22 + seeded(n, 11) * 20) * S;
      blossom(((x % W) + W) % W, y, r, t * (0.3 + seeded(n, 12) * 0.6) + n, seeded(n, 13) < 0.55, Math.cos(t * (0.8 + seeded(n, 14)) + n));
    }
    return document.getElementById("c").toDataURL(type, 0.95).split(",")[1];
  };
}, src, W, H, Number(args.flowers), Number(args.zoom), Number(args["focus-y"]), args.band ? args.band.split(",").map(Number) : null);

if (args.still) {
  writeFileSync(resolve(args.out), Buffer.from(await page.evaluate((t) => window.frame(t, "image/png"), Number(args.still)), "base64"));
  await browser.close();
  console.log(`still: ${args.out}`);
  process.exit(0);
}

const frames = Math.round(Number(args.duration) * FPS);
const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-",
  "-vf", `scale=${W}:${H}:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`,
  "-frames:v", String(frames), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-movflags", "+faststart", resolve(args.out)],
  { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((ok) => ffmpeg.on("close", ok));
for (let i = 0; i < frames; i++) {
  const data = await page.evaluate((t) => window.frame(t, "image/jpeg"), i / FPS);
  if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((ok) => ffmpeg.stdin.once("drain", ok));
  if (i % 1500 === 0) console.log(`frame ${i}/${frames}`);
}
ffmpeg.stdin.end();
const code = await done;
await browser.close();
if (code !== 0) fail("ffmpeg failed");
console.log(`${args.out}: ${frames} frames`);
