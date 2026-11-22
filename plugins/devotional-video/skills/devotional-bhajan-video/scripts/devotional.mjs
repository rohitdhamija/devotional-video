#!/usr/bin/env node
// Devotional "amrit vela" background from a still temple/gate image. Everything is drawn in code over the image,
// which never moves, so a --text-box measured on it stays aligned:
//   - a night -> blue hour -> sunrise -> morning journey (graded image + painted sky through a colour-keyed sky mask)
//   - stars, and a sun rising behind a chosen point (e.g. a temple dome), hidden by everything that is not sky
//   - light rays through an arch opening, golden dust motes
//   - flickering diyas (niche lamps and clay diyas on ledges) with warm light pools, incense smoke
//   - falling marigolds and rose petals
//   - a golden light ring from the dome on every lyric word containing a keyword (default "जय"), diyas flare
//   - a lit aarti thali circling the lyric box during lines containing a keyword (default "आरती")
// Positions come from a scene JSON measured on the 1280x720 frame (see examples/aarti_scene.json).
// Usage: node devotional.mjs --image gate.png --scene scene.json --align alignment.json --beats beats.json
//          (--duration <sec> --out bg.mp4 | --still 10,60,200 --out /dir/still.png) [--overwrite]
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer";

const FPS = 30, W = 1280, H = 720;
const { values: args } = parseArgs({
  options: {
    image: { type: "string" }, scene: { type: "string" }, align: { type: "string" }, beats: { type: "string" },
    duration: { type: "string" }, out: { type: "string" }, still: { type: "string" }, overwrite: { type: "boolean", default: false },
  },
});
const fail = (m) => { console.error(m); process.exit(2); };
if (!args.image || !args.scene || !args.align || !args.beats || !args.out || (!args.duration && !args.still))
  fail("--image, --scene, --align, --beats, --out and --duration (or --still) are required");
const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(args.image).toLowerCase()];
if (!mime) fail("--image must be png, jpg or webp");
const scene = JSON.parse(readFileSync(args.scene, "utf8"));
const align = JSON.parse(readFileSync(args.align, "utf8"));
const beats = JSON.parse(readFileSync(args.beats, "utf8"));

// Lyric-driven events, from the forced alignment (never guessed).
const pulseWord = scene.pulseKeyword || "जय", aartiWord = scene.aartiKeyword || "आरती";
const pulses = [];
for (const l of align.lines) for (const w of l.words) if (w.text.includes(pulseWord)) pulses.push(w.start);
const wins = [];
for (const l of align.lines) {
  if (!l.text.includes(aartiWord)) continue;
  const a = l.start - 0.5, b = l.end + 0.5, last = wins[wins.length - 1];
  if (last && a - last[1] < 1.5) last[1] = b; else wins.push([a, b]);
}
const strongBeats = beats.beats.filter((b) => b.s > 0.45).map((b) => b.t);
console.log(`${pulses.length} "${pulseWord}" pulses, ${wins.length} "${aartiWord}" windows: ${wins.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(", ")}`);

const src = `data:${mime};base64,${readFileSync(args.image).toString("base64")}`;
const browser = await puppeteer.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error(e); process.exit(1); });
page.on("console", (m) => console.log("[page]", m.text()));
await page.setContent(`<!doctype html><canvas id="c" width="${W}" height="${H}"></canvas>`);
await page.evaluate(async (src, W, H, S, pulses, wins, strongBeats, bpm) => {
  const ctx = document.getElementById("c").getContext("2d");
  const mk = () => { const k = document.createElement("canvas"); k.width = W; k.height = H; return k; };
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  const lerp = (a, b, f) => a + (b - a) * f;
  const seeded = (n, salt) => { const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };
  const noise = (t, n) => Math.sin(t * 7.1 + n * 3.3) * 0.5 + Math.sin(t * 13.7 + n * 1.7) * 0.3 + Math.sin(t * 23.3 + n * 5.1) * 0.2;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (c1, c2, f) => c1.map((v, i) => lerp(v, c2[i], f));

  // ---- base image, cover-fit (zoom 1), never moving ----
  const img = new Image(); img.src = src; await img.decode();
  const k = Math.max(W / img.width, H / img.height) * (S.zoom || 1), iw = img.width * k, ih = img.height * k;
  const base = mk(); const bc = base.getContext("2d"); bc.imageSmoothingQuality = "high";
  bc.drawImage(img, (W - iw) / 2, Math.min(0, Math.max(H - ih, H * (S.focusY ?? 0.5) - ih * (S.focusY ?? 0.5))), iw, ih);
  const bd = bc.getImageData(0, 0, W, H).data;

  // ---- sky mask: clearly blue pixels above the horizon ----
  const skyRaw = mk(); { const c = skyRaw.getContext("2d"); const id = c.createImageData(W, H);
    for (let i = 0, p = 0; i < bd.length; i += 4, p++) {
      const y = (p / W) | 0, r = bd[i], b = bd[i + 2];
      let v = clamp((b - r - 22) / 34);
      v *= clamp((S.horizon - y) / 6);
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = v * 255;
    }
    c.putImageData(id, 0, 0); }
  const sky = mk(); { const c = sky.getContext("2d"); c.filter = "blur(0.7px)"; c.drawImage(skyRaw, 0, 0); }
  // Arch-opening path (rays and dust stay inside it, plus open sky).
  const archPath = () => { const a = S.arch; const p = new Path2D();
    p.moveTo(a.x0, a.bottom); p.lineTo(a.x0, a.spring); p.quadraticCurveTo(a.x0, a.top, (a.x0 + a.x1) / 2, a.top);
    p.quadraticCurveTo(a.x1, a.top, a.x1, a.spring); p.lineTo(a.x1, a.bottom); p.closePath(); return p; };
  const open = mk(); { const c = open.getContext("2d"); c.drawImage(sky, 0, 0); c.filter = "blur(6px)"; c.fillStyle = "#fff"; c.fill(archPath()); }

  // ---- graded versions of the image: night, blue hour, sunrise, morning ----
  const GRADES = [[0.2, 0.24, 0.45, 0.5], [0.42, 0.43, 0.66, 0.72], [0.9, 0.78, 0.7, 0.86], [1.03, 1.0, 0.96, 1.04]];
  const grades = GRADES.map((m) => { const g = mk(); const c = g.getContext("2d"); const id = c.createImageData(W, H), d = id.data;
    for (let i = 0; i < bd.length; i += 4) { const l = bd[i] * 0.3 + bd[i + 1] * 0.59 + bd[i + 2] * 0.11;
      for (let j = 0; j < 3; j++) d[i + j] = clamp((l + (bd[i + j] - l) * m[3]) * m[j], 0, 255);
      d[i + 3] = 255; }
    c.putImageData(id, 0, 0); return g; });
  // Sky palettes per stage: top, middle, horizon.
  const SKIES = [["#04061c", "#0b1240", "#1a2257"], ["#0d1546", "#323a80", "#b06c8c"], ["#2f4d9b", "#e3947c", "#ffc66c"], ["#6aa6e8", "#c3e2f5", "#ffe1a6"]].map((s) => s.map(hex));

  // Timeline: stage 0 night .. 3 morning, eased between keyframes.
  const stageAt = (t) => { const K = S.timeline; if (t <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) return lerp(K[i - 1][1], K[i][1], sstep(K[i - 1][0], K[i][0], t));
    return K[K.length - 1][1]; };

  // ---- sprites: marigolds and petals, in day and lamp-lit night versions ----
  function sprite(size, draw) { const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"); x.translate(size / 2, size / 2); draw(x, size / 2); return c; }
  function marigold(x, R, dark, light) {
    for (let ring = 0; ring < 4; ring++) { const rr = R * (1 - ring * 0.21), n = 16 - ring * 2;
      for (let p = 0; p < n; p++) { const a = (p / n) * Math.PI * 2 + ring * 0.4;
        x.save(); x.rotate(a); const g = x.createLinearGradient(0, 0, 0, -rr);
        g.addColorStop(0, rgb(mix(dark, [90, 20, 0], 0.35))); g.addColorStop(0.55, rgb(dark)); g.addColorStop(1, rgb(light));
        x.fillStyle = g; x.beginPath(); x.moveTo(-rr * 0.16, 0);
        x.quadraticCurveTo(-rr * 0.3, -rr * 0.75, -rr * 0.12, -rr); x.lineTo(-rr * 0.04, -rr * 0.9); x.lineTo(rr * 0.05, -rr * 1.0); x.lineTo(rr * 0.13, -rr * 0.92);
        x.quadraticCurveTo(rr * 0.3, -rr * 0.75, rr * 0.16, 0); x.fill();
        x.strokeStyle = rgb(mix(dark, [120, 30, 0], 0.5), 0.35); x.lineWidth = 0.8; x.stroke(); x.restore(); } }
    x.fillStyle = rgb(mix(dark, [110, 40, 0], 0.5)); x.beginPath(); x.arc(0, 0, R * 0.16, 0, Math.PI * 2); x.fill();
  }
  function petal(x, R, c1, c2) { const g = x.createLinearGradient(0, -R, 0, R); g.addColorStop(0, rgb(c2)); g.addColorStop(1, rgb(c1));
    x.fillStyle = g; x.beginPath(); x.moveTo(0, R); x.bezierCurveTo(R * 0.9, R * 0.4, R * 0.7, -R * 0.8, 0, -R * 0.6); x.bezierCurveTo(-R * 0.7, -R * 0.8, -R * 0.9, R * 0.4, 0, R); x.fill();
    x.strokeStyle = rgb(mix(c1, [60, 0, 0], 0.4), 0.5); x.lineWidth = 0.7; x.beginPath(); x.moveTo(0, R * 0.8); x.quadraticCurveTo(R * 0.1, 0, 0, -R * 0.4); x.stroke(); }
  const KINDS = [
    (x, r) => marigold(x, r * 0.92, [232, 96, 8], [255, 168, 30]), (x, r) => marigold(x, r * 0.92, [240, 150, 0], [255, 214, 70]),
    (x, r) => petal(x, r * 0.8, [176, 14, 40], [236, 70, 80]), (x, r) => petal(x, r * 0.8, [228, 100, 10], [255, 180, 60]),
    (x, r) => petal(x, r * 0.8, [240, 160, 0], [255, 220, 90])];
  const SPR = KINDS.map((d) => { const day = sprite(96, d); const night = sprite(96, (x, r) => { x.drawImage(day, -r, -r); x.globalCompositeOperation = "source-atop"; x.fillStyle = "rgba(25,20,55,0.5)"; x.fillRect(-r, -r, 2 * r, 2 * r); }); return [night, day]; });

  // ---- drawing helpers ----
  function flame(x, y, h, t, n, boost) {
    const f = 1 + 0.12 * noise(t, n) + 0.45 * boost, hh = h * f, sway = noise(t * 0.7, n + 9) * h * 0.12;
    const g = ctx.createRadialGradient(x, y - hh * 0.3, 0, x, y - hh * 0.3, hh * 0.9);
    g.addColorStop(0, "rgba(255,250,225,1)"); g.addColorStop(0.35, "rgba(255,214,110,0.95)"); g.addColorStop(0.75, "rgba(255,130,30,0.75)"); g.addColorStop(1, "rgba(255,90,10,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - h * 0.22, y);
    ctx.bezierCurveTo(x - h * 0.3, y - hh * 0.45, x + sway * 0.4, y - hh * 0.75, x + sway, y - hh);
    ctx.bezierCurveTo(x + sway * 0.4 + h * 0.05, y - hh * 0.7, x + h * 0.3, y - hh * 0.45, x + h * 0.22, y);
    ctx.quadraticCurveTo(x, y + h * 0.1, x - h * 0.22, y); ctx.fill();
  }
  function glow(x, y, r, c, a) { if (a <= 0.003) return; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgb(c, a)); g.addColorStop(0.4, rgb(c, a * 0.45)); g.addColorStop(1, rgb(c, 0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }
  function diyaBowl(x, y, w, lit) { const g = ctx.createLinearGradient(0, y - w * 0.1, 0, y + w * 0.35);
    g.addColorStop(0, rgb(mix([150, 70, 35], [230, 140, 70], lit))); g.addColorStop(1, rgb(mix([60, 25, 15], [120, 50, 25], lit)));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.quadraticCurveTo(x, y + w * 0.55, x + w / 2, y); ctx.quadraticCurveTo(x + w * 0.62, y - w * 0.12, x + w * 0.66, y - w * 0.16); ctx.lineTo(x + w * 0.4, y - w * 0.04); ctx.quadraticCurveTo(x, y + w * 0.06, x - w / 2, y); ctx.fill();
    ctx.strokeStyle = rgb([255, 190, 110], 0.5 * lit + 0.2); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y, w / 2, w * 0.08, 0, Math.PI, 0); ctx.stroke(); }
  const boostAt = (t) => { let b = 0; for (const e of pulses) { const a = t - e; if (a >= 0 && a < 2.5) b = Math.max(b, Math.exp(-a / 0.45)); }
    for (const e of strongBeats) { const a = t - e; if (a >= 0 && a < 0.6) b = Math.max(b, 0.22 * Math.exp(-a / 0.18)); } return b; };

  const layer = mk(), L = layer.getContext("2d");
  window.frame = (t, type) => {
    const s = stageAt(t), i0 = Math.min(2, Math.floor(s)), f = s - i0;
    const night = 1 - sstep(1.5, 2.7, s), dayness = sstep(0.9, 2.6, s), boost = boostAt(t);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.drawImage(grades[i0], 0, 0); if (f > 0) { ctx.globalAlpha = f; ctx.drawImage(grades[i0 + 1], 0, 0); ctx.globalAlpha = 1; }

    // Warm lamp uplight on the gate (not the sky) while it is dark.
    const up = night * 0.9 + 0.1;
    L.globalCompositeOperation = "source-over"; L.clearRect(0, 0, W, H);
    const ug = L.createLinearGradient(0, H, 0, 120); ug.addColorStop(0, `rgba(255,150,60,${0.85 * up})`); ug.addColorStop(0.45, `rgba(255,140,60,${0.45 * up})`); ug.addColorStop(1, "rgba(255,140,60,0)");
    L.fillStyle = ug; L.fillRect(0, 0, W, H); L.globalCompositeOperation = "destination-out"; L.drawImage(sky, 0, 0);
    ctx.globalCompositeOperation = "soft-light"; ctx.drawImage(layer, 0, 0); ctx.globalCompositeOperation = "source-over";

    // Painted sky with stars, through the sky mask.
    const pal = SKIES[i0].map((c, j) => mix(c, SKIES[i0 + 1][j], f));
    L.globalCompositeOperation = "source-over"; L.clearRect(0, 0, W, H);
    const sg = L.createLinearGradient(0, 0, 0, S.horizon); sg.addColorStop(0, rgb(pal[0])); sg.addColorStop(0.6, rgb(pal[1])); sg.addColorStop(1, rgb(pal[2]));
    L.fillStyle = sg; L.fillRect(0, 0, W, S.horizon + 2);
    const starA = 1 - sstep(0.7, 1.6, s);
    if (starA > 0) for (let n = 0; n < 90; n++) { const x = seeded(n, 1) * W, y = seeded(n, 2) * S.horizon * 0.85, tw = 0.55 + 0.45 * Math.sin(t * (1 + seeded(n, 3) * 2) + n);
      const r = 0.6 + seeded(n, 4) ** 3 * 1.8; L.fillStyle = `rgba(255,250,235,${starA * tw * (0.5 + seeded(n, 5) * 0.5)})`; L.beginPath(); L.arc(x, y, r, 0, Math.PI * 2); L.fill(); }
    L.globalCompositeOperation = "destination-in"; L.drawImage(sky, 0, 0);
    ctx.globalAlpha = s < 2 ? 1 : 1 - 0.85 * sstep(2, 3, s); ctx.drawImage(layer, 0, 0); ctx.globalAlpha = 1;

    // Sun rising behind the dome: disc hidden by everything that is not sky, with a soft bloom over the scene.
    const sunVis = sstep(1.45, 1.95, s), sy = lerp(S.sun.y0, S.sun.y1, sstep(1.45, 3, s)), sx = S.sun.x;
    if (sunVis > 0) {
      L.globalCompositeOperation = "source-over"; L.clearRect(0, 0, W, H);
      let g = L.createRadialGradient(sx, sy, 0, sx, sy, 300); g.addColorStop(0, `rgba(255,228,160,${0.95 * sunVis})`); g.addColorStop(0.12, `rgba(255,205,120,${0.75 * sunVis})`); g.addColorStop(0.45, `rgba(255,160,90,${0.28 * sunVis})`); g.addColorStop(1, "rgba(255,140,80,0)");
      L.fillStyle = g; L.fillRect(0, 0, W, H);
      g = L.createRadialGradient(sx, sy, 0, sx, sy, S.sun.r); g.addColorStop(0, `rgba(255,253,236,${sunVis})`); g.addColorStop(0.75, `rgba(255,232,160,${sunVis})`); g.addColorStop(1, `rgba(255,200,110,${0.9 * sunVis})`);
      L.fillStyle = g; L.beginPath(); L.arc(sx, sy, S.sun.r, 0, Math.PI * 2); L.fill();
      L.globalCompositeOperation = "destination-in"; L.drawImage(sky, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.globalCompositeOperation = "screen"; glow(sx, Math.min(sy, S.horizon - 20), 520, [255, 170, 90], 0.22 * sunVis * (1 - 0.4 * sstep(2.6, 3, s)));
      ctx.globalCompositeOperation = "source-over";
    }

    // Light rays through the arch and golden dust, inside the opening and open sky.
    const rayA = sstep(1.35, 2.2, s) * (0.3 - 0.1 * sstep(2.6, 3, s));
    if (rayA > 0) {
      L.globalCompositeOperation = "source-over"; L.clearRect(0, 0, W, H);
      const ox = sx, oy = Math.min(sy, S.horizon - 30);
      for (let n = 0; n < 14; n++) { const a = (n / 14) * Math.PI * 2 + Math.sin(t * 0.05 + n) * 0.06 + t * 0.012, wd = 0.035 + seeded(n, 7) * 0.05;
        const g = L.createRadialGradient(ox, oy, 0, ox, oy, 650); g.addColorStop(0, `rgba(255,225,160,${rayA * (0.6 + 0.4 * Math.sin(t * 0.4 + n * 2))})`); g.addColorStop(1, "rgba(255,200,120,0)");
        L.fillStyle = g; L.beginPath(); L.moveTo(ox, oy); L.arc(ox, oy, 650, a - wd, a + wd); L.closePath(); L.fill(); }
      for (let n = 0; n < 40; n++) { const x = S.arch.x0 + seeded(n, 11) * (S.arch.x1 - S.arch.x0) + Math.sin(t * 0.3 + n) * 14, y = S.arch.top + ((seeded(n, 12) * 330 - t * (4 + seeded(n, 13) * 6)) % 330 + 330) % 330;
        L.fillStyle = `rgba(255,232,170,${(0.35 + 0.35 * Math.sin(t * 1.5 + n)) * rayA * 2.2})`; L.beginPath(); L.arc(x, y, 0.8 + seeded(n, 14) * 1.4, 0, Math.PI * 2); L.fill(); }
      L.globalCompositeOperation = "destination-in"; L.drawImage(open, 0, 0);
      ctx.globalCompositeOperation = "screen"; ctx.drawImage(layer, 0, 0); ctx.globalCompositeOperation = "source-over";
    }

    // Temple lit from within while it is dark.
    ctx.globalCompositeOperation = "lighter";
    for (const d of S.templeLights) glow(d[0], d[1], d[2], [255, 170, 70], 0.5 * night * (0.85 + 0.15 * noise(t * 0.3, d[0])));
    // Lamp-light pools on the marble, stronger at night and on each jaikara.
    const lamps = [...S.niches.map((p) => [p[0], p[1], 1]), ...S.ledges.flatMap((L2) => L2.map((p) => [p[0], p[1], 0.8]))];
    for (const [x, y, w] of lamps) glow(x, y - 6, 75 * (1 + 0.35 * boost) * w, [255, 140, 50], (0.42 * night + 0.06) * (0.9 + 0.1 * noise(t, x)) * (1 + 0.6 * boost));
    // Golden ring of light from the dome on every "जय".
    for (const e of pulses) { const a = t - e; if (a < 0 || a > 2.2) continue;
      const R = 30 + a * 360, al = 0.5 * (1 - a / 2.2) ** 2;
      ctx.lineWidth = 26 + a * 30; ctx.strokeStyle = `rgba(255,150,40,${al * 0.4})`; ctx.beginPath(); ctx.arc(S.dome[0], S.dome[1], R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 5 + a * 6; ctx.strokeStyle = `rgba(255,200,90,${al})`; ctx.beginPath(); ctx.arc(S.dome[0], S.dome[1], R, 0, Math.PI * 2); ctx.stroke(); }
    glow(S.dome[0], S.dome[1], 260, [255, 190, 100], 0.15 * boost);
    ctx.globalCompositeOperation = "source-over";

    // Diyas: flames on the niche lamps; clay diyas on the pillar ledges.
    let n = 0;
    for (const [x, y] of S.niches) { ctx.globalCompositeOperation = "lighter"; glow(x, y - 5, 16, [255, 190, 90], 0.6); ctx.globalCompositeOperation = "source-over"; flame(x, y, 13, t, n++, boost); }
    for (const row of S.ledges) for (const [x, y] of row) { diyaBowl(x, y, 15, night * 0.6 + 0.4); flame(x, y - 1, 12, t, n++, boost);
      ctx.globalCompositeOperation = "lighter"; glow(x, y - 6, 14, [255, 200, 100], 0.5); ctx.globalCompositeOperation = "source-over"; }

    // Incense smoke rising from the ledges.
    ctx.globalCompositeOperation = "screen";
    const smokeC = mix([150, 160, 205], [235, 228, 220], dayness);
    for (const [x0, y0] of S.smoke) { ctx.fillStyle = "#6b3b1f"; ctx.fillRect(x0 - 0.8, y0 - 22, 1.6, 22);
      glow(x0, y0 - 22, 4, [255, 120, 40], 0.9);
      for (let k = 0; k < 40; k++) { const life = 8, age = ((t + (k * life) / 40 + x0) % life);
        const y = y0 - 22 - age * 21, x = x0 + Math.sin(age * 0.8 + k * 0.37 + t * 0.25) * (2 + age * 4.5) + age * 1.5 * Math.sin(x0);
        const r = 2.5 + age * 3.4, a = 0.13 * (1 - age / life) * Math.min(1, age / 0.6);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgb(smokeC, a)); g.addColorStop(1, rgb(smokeC, 0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); } }
    ctx.globalCompositeOperation = "source-over";

    // Aarti: a lit thali circling the lyric box, one turn every 4 beats.
    for (const [a, b] of wins) { if (t < a || t > b) continue;
      const vis = Math.min(sstep(a, a + 0.8, t), 1 - sstep(b - 0.8, b, t)), per = (60 / bpm) * 4, A = S.aarti;
      const pos = (tt) => { const th = ((tt - a) / per) * Math.PI * 2; return [A.cx + A.rx * Math.sin(th), A.cy - A.ry * Math.cos(th)]; };
      ctx.globalCompositeOperation = "lighter";
      for (let j = 18; j >= 1; j--) { const [x, y] = pos(t - j * 0.03); glow(x, y - 10, 26 - j * 0.6, [255, 170, 70], 0.32 * vis * (1 - j / 19)); }
      const [x, y] = pos(t); glow(x, y - 10, 90, [255, 170, 70], 0.4 * vis);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = vis;
      const pg = ctx.createLinearGradient(x - 24, 0, x + 24, 0); pg.addColorStop(0, "#9a6a12"); pg.addColorStop(0.45, "#ffe08a"); pg.addColorStop(1, "#a8761a");
      ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, y + 4, 24, 7.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#7a520c"; ctx.lineWidth = 1.2; ctx.stroke();
      for (let p = 0; p < 6; p++) { const an = (p / 6) * Math.PI * 2; ctx.fillStyle = p % 2 ? "#ff8c1a" : "#d01c2c"; ctx.beginPath(); ctx.arc(x + Math.cos(an) * 16, y + 4 + Math.sin(an) * 4.5, 2.6, 0, Math.PI * 2); ctx.fill(); }
      diyaBowl(x, y + 1, 15, 1); flame(x, y, 17, t, 99, 0.3);
      ctx.globalAlpha = 1; }

    // Falling marigolds and rose petals (lamp-lit at night, full colour by day).
    for (let m = 0; m < 26; m++) { const speed = 30 + seeded(m, 6) * 32, fall = H + 120;
      const y = -60 + ((t * speed + seeded(m, 7) * fall) % fall);
      const x = (((W * seeded(m, 8) + Math.sin(t * (0.5 + seeded(m, 9) * 0.6) + m) * 40 + t * 5 * (seeded(m, 10) - 0.5)) % W) + W) % W;
      const kind = m < 9 ? m % 2 : 2 + (m % 3), size = m < 9 ? 40 + seeded(m, 11) * 16 : 16 + seeded(m, 11) * 9;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * (0.4 + seeded(m, 12) * 0.8) + m); ctx.scale(1, m < 9 ? 1 : Math.cos(t * (1 + seeded(m, 14)) + m));
      const [nS, dS] = SPR[kind]; ctx.globalAlpha = 1 - dayness; ctx.drawImage(nS, -size / 2, -size / 2, size, size);
      ctx.globalAlpha = dayness; ctx.drawImage(dS, -size / 2, -size / 2, size, size); ctx.restore(); ctx.globalAlpha = 1; }

    // Soft vignette while it is dark.
    const vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, W * 0.75); vg.addColorStop(0, "rgba(0,0,10,0)"); vg.addColorStop(1, `rgba(0,0,10,${0.45 * night})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    return document.getElementById("c").toDataURL(type, 0.95).split(",")[1];
  };
}, src, W, H, scene, pulses, wins, strongBeats, beats.bpm);

if (args.still) {
  for (const ts of args.still.split(",")) {
    const out = args.out.replace(/(\.png)?$/, `_${ts}s.png`);
    writeFileSync(resolve(out), Buffer.from(await page.evaluate((t) => window.frame(t, "image/png"), Number(ts)), "base64"));
    console.log(`still: ${out}`);
  }
  await browser.close(); process.exit(0);
}
if (existsSync(args.out) && !args.overwrite) fail(`${args.out} exists; ask the user, then pass --overwrite`);
const frames = Math.round(Number(args.duration) * FPS);
const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-",
  "-vf", `scale=${W}:${H}:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`,
  "-frames:v", String(frames), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-profile:v", "high",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-movflags", "+faststart", resolve(args.out)],
  { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((ok) => ffmpeg.on("close", ok));
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const data = await page.evaluate((t) => window.frame(t, "image/jpeg"), i / FPS);
  if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((ok) => ffmpeg.stdin.once("drain", ok));
  if (i % 1500 === 0) console.log(`frame ${i}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
ffmpeg.stdin.end();
const code = await done;
await browser.close();
if (code !== 0) fail("ffmpeg failed");
console.log(`${args.out}: ${frames} frames`);
