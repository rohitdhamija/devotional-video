// Old-paper lyric scene, drawn on a 2D canvas. Runs in headless Chrome; render.mjs calls init() then draw(t).
const W = 1280, H = 720;
const SAFE = { left: 64, right: W - 64, top: 40, bottom: H - 90 };
const MAX_CHARS = 32;
const RULE_Y = 428;
const INK = [43, 26, 16], ACTIVE = [140, 47, 22];
const FONT = "Tiro";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { willReadFrequently: false });
const GREEN = "#00b140";
// Strip mode: a paper band on solid green for chroma keying. Edges sit on the 16 px codec grid so they stay clean.
const BAND = { left: 64, right: 1216, bottom: 624 };
let song, paper, washes, rows, bandTop;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const offscreen = (w = W, h = H) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const graphemes = (s) => [...new Intl.Segmenter("hi", { granularity: "grapheme" }).segment(s)].length;

// Smooth 1D noise made of sines with seeded phases.
function ridge(r, octaves) {
  const parts = Array.from({ length: octaves }, (_, i) => ({ f: 0.004 * 2 ** i * (0.8 + r() * 0.4), p: r() * 7, a: 1 / 2 ** i }));
  return (x) => parts.reduce((sum, o) => sum + o.a * Math.sin(x * o.f + o.p), 0);
}

function makePaper() {
  const c = offscreen(), g = c.getContext("2d"), r = rng(11);
  g.fillStyle = "#e9d9b4";
  g.fillRect(0, 0, W, H);

  // Large soft tonal blotches, then foxing specks, then long fibres.
  for (let i = 0; i < 60; i++) {
    const x = r() * W, y = r() * H, rad = 80 + r() * 260;
    const tone = r() > 0.5 ? "120,84,40" : "255,244,214";
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${tone},${0.03 + r() * 0.05})`);
    grad.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 170; i++) {
    const x = r() * W, y = r() * H, rad = 0.6 + r() ** 3 * 5;
    g.fillStyle = `rgba(112,70,28,${0.05 + r() * 0.16})`;
    g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
  }
  g.lineWidth = 0.6;
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * H, a = r() * 6.3, len = 6 + r() * 26;
    g.strokeStyle = r() > 0.5 ? `rgba(90,60,28,${0.03 + r() * 0.06})` : `rgba(255,248,226,${0.05 + r() * 0.08})`;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + r() * 6 - 3, y + Math.sin(a) * len * 0.5 + r() * 6 - 3, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Fine per-pixel grain.
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 9;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9;
  }
  g.putImageData(img, 0, 0);

  // Faint fold creases and aged edges.
  for (const [x0, y0, x1, y1] of [[W * 0.5, 0, W * 0.5 + 4, H], [0, H * 0.5, W, H * 0.5 - 3]]) {
    g.strokeStyle = "rgba(92,62,28,0.10)"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = "rgba(255,248,226,0.14)";
    g.beginPath(); g.moveTo(x0 + 1.5, y0 + 1.5); g.lineTo(x1 + 1.5, y1 + 1.5); g.stroke();
  }
  const edge = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 1.02);
  edge.addColorStop(0, "rgba(82,48,16,0)");
  edge.addColorStop(0.7, "rgba(82,48,16,0.14)");
  edge.addColorStop(1, "rgba(58,30,8,0.5)");
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);
  return c;
}

// One translucent ink-wash hill layer, wider than the frame so it can drift.
function makeHill(seed, baseY, height, alpha) {
  const margin = 60, c = offscreen(W + margin * 2, H), g = c.getContext("2d"), r = rng(seed);
  const shape = ridge(r, 5), edgeY = (x) => baseY - height * (0.5 + 0.3 * shape(x));
  const floor = 372;
  g.beginPath(); g.moveTo(0, floor);
  for (let x = 0; x <= c.width; x += 2) g.lineTo(x, edgeY(x));
  g.lineTo(c.width, floor); g.closePath();
  const grad = g.createLinearGradient(0, baseY - height, 0, floor);
  grad.addColorStop(0, `rgba(58,40,28,${alpha})`);
  grad.addColorStop(1, `rgba(58,40,28,${alpha * 0.08})`);
  g.fillStyle = grad; g.fill();

  // Dry-brush bleed: small streaks that thin the wash, then a darker ridge line.
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 2600; i++) {
    const x = r() * c.width, y = edgeY(x) + r() ** 1.5 * (floor - edgeY(x));
    g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.14})`;
    g.fillRect(x, y, 3 + r() * 16, 0.6 + r() * 1.6);
  }
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = `rgba(40,26,18,${alpha * 1.15})`; g.lineWidth = 1.3;
  g.beginPath();
  for (let x = 0; x <= c.width; x += 3) { const y = edgeY(x) + (r() - 0.5) * 0.9; x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();

  // Loosen the outer edges so the wash stops inside the safe area.
  g.globalCompositeOperation = "destination-in";
  const fade = g.createLinearGradient(margin + SAFE.left, 0, margin + SAFE.right, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(0.14, "#000"); fade.addColorStop(0.86, "#000"); fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade; g.fillRect(0, 0, c.width, H);
  return { canvas: c, margin };
}

function fit(words, size) {
  ctx.font = `${size}px ${FONT}`;
  const space = ctx.measureText(" ").width;
  return words.reduce((w, word) => w + ctx.measureText(word.text).width, 0) + space * (words.length - 1);
}

// Long lyric rows break at the word boundary that keeps both rows within MAX_CHARS.
function wrap(words) {
  const text = (list) => list.map((w) => w.text).join(" ");
  if (graphemes(text(words)) <= MAX_CHARS || words.length < 2) return [words];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = graphemes(text(words.slice(0, i))), b = graphemes(text(words.slice(i)));
    const worst = Math.max(a, b);
    if (!best || worst < best.worst) best = { i, worst };
  }
  return [words.slice(0, best.i), ...wrap(words.slice(best.i))];
}

const baselinesFor = (count) => {
  if (song.textTop) return count === 1 ? [106] : count === 2 ? [106, 168] : [96, 152, 208];
  if (song.textBottom) return count === 1 ? [600] : count === 2 ? [538, 600] : [488, 544, 600];
  return count === 1 ? [538] : count === 2 ? [500, 562] : [474, 530, 586];
};

function layoutLine(line) {
  const display = wrap(line.words);
  let size = display.length > 2 ? 42 : 52;
  const widest = () => Math.max(...display.map((row) => fit(row, size)));
  while (widest() > SAFE.right - SAFE.left && size > 24) size -= 1;
  return { ...line, display, size };
}

function lineWindow(i) {
  const line = rows[i], next = rows[i + 1], prev = rows[i - 1];
  const show = Math.max(line.start - 0.7, prev ? prev.end + 0.05 : 0);
  const hide = Math.min(next ? next.start - 0.2 : song.duration, line.end + 3);
  return { show, hide };
}

function drawText(text, x, y, size, color, alpha) {
  if (alpha <= 0) return;
  ctx.font = `${size}px ${FONT}`;
  ctx.fillStyle = `rgba(${color.join(",")},${alpha})`;
  ctx.fillText(text, x, y);
}

function drawLyrics(t) {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.globalCompositeOperation = "multiply";
  let active = false;
  rows.forEach((line, i) => {
    const { show, hide } = lineWindow(i);
    if (t < show || t > hide) return;
    active = true;
    const alpha = ease((t - show) / 0.45) * ease((hide - t) / 0.45);
    const count = line.display.length;
    const baselines = baselinesFor(count);
    line.display.forEach((row, k) => {
      const size = line.size, space = (ctx.font = `${size}px ${FONT}`, ctx.measureText(" ").width);
      let x = W / 2 - fit(row, size) / 2;
      for (const word of row) {
        const ramp = Math.max(0.12, Math.min(0.22, word.end - word.start));
        const sung = ease((t - word.start) / ramp);
        const glow = sung * (1 - ease((t - word.end) / 0.5));
        const a = alpha * (0.34 + 0.66 * sung);
        drawText(word.text, x, baselines[k], size, mix(INK, ACTIVE, glow), a);
        x += fit([word], size) + space;
      }
    });

    // The upcoming line waits faintly below when it follows closely.
    const next = rows[i + 1];
    if (next && !song.noPreview && count < 3 && next.start - line.end < 8) {
      const preview = next.display[0].map((w) => w.text).join(" ") + (next.display.length > 1 ? " …" : "");
      const py = count === 1 ? 604 : 616;
      ctx.font = `25px ${FONT}`;
      const px = W / 2 - ctx.measureText(preview).width / 2;
      drawText(preview, px, py, 25, INK, alpha * 0.36);
    }
  });

  // Title before the first line; a quiet double danda during long instrumental passages.
  const first = rows[0];
  if (song.title && t < first.start - 0.7) {
    const a = ease((t - 0.3) / 1.2) * ease((first.start - 0.7 - t) / 0.6);
    ctx.font = `50px ${FONT}`;
    drawText(song.title, W / 2 - ctx.measureText(song.title).width / 2, 525, 50, INK, a);
    if (song.artist) {
      ctx.font = `26px ${FONT}`;
      drawText(song.artist, W / 2 - ctx.measureText(song.artist).width / 2, 580, 26, INK, a * 0.65);
    }
  } else if (!active && t > first.start && !song.strip) {
    const span = gapAround(t);
    const a = 0.42 * ease((t - span.from) / 1) * ease((span.to - t) / 1);
    ctx.font = `38px ${FONT}`;
    drawText("॥", W / 2 - ctx.measureText("॥").width / 2, 540, 38, INK, a);
  }
  ctx.restore();
}

function gapAround(t) {
  let from = 0, to = song.duration;
  rows.forEach((_, i) => {
    const w = lineWindow(i);
    if (w.hide <= t) from = Math.max(from, w.hide);
    if (w.show >= t) to = Math.min(to, w.show);
  });
  return { from, to };
}

function drawIllustration(t) {
  const progress = clamp(t / song.duration);
  const reveal = ease(t / 4);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  // The sun crosses the page once over the length of the song.
  const sx = 340 + 600 * progress, sy = 148 - 56 * Math.sin(Math.PI * progress);
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, 50);
  sun.addColorStop(0, `rgba(196,74,34,${0.72 * reveal})`);
  sun.addColorStop(0.78, `rgba(204,84,40,${0.62 * reveal})`);
  sun.addColorStop(0.9, `rgba(214,110,62,${0.12 * reveal})`);
  sun.addColorStop(1, "rgba(214,110,62,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(sx - 50, sy - 50, 100, 100);

  washes.forEach((hill, i) => {
    const shift = Math.sin(t * 0.03 + i) * (2 + i * 3);
    ctx.globalAlpha = reveal;
    ctx.drawImage(hill.canvas, -hill.margin + shift, 0);
  });
  ctx.globalAlpha = 1;

  // River ripples: long thin strokes that shimmer slowly.
  const r = rng(29);
  ctx.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const y = 376 + r() * 38, cx = 150 + r() * 980, len = 30 + r() * 120, phase = r() * 6.3;
    const edge = clamp((cx - len / 2 - SAFE.left) / 60) * clamp((SAFE.right - cx - len / 2) / 60);
    const a = (0.14 + 0.15 * Math.sin(t * 0.55 + phase)) * reveal * edge;
    if (a <= 0) continue;
    const drift = Math.sin(t * 0.18 + phase) * 7;
    ctx.strokeStyle = `rgba(50,34,24,${a})`;
    ctx.lineWidth = 0.9 + r() * 0.9;
    ctx.beginPath(); ctx.moveTo(cx - len / 2 + drift, y); ctx.lineTo(cx + len / 2 + drift, y); ctx.stroke();
  }

  drawBoat(430 + 400 * progress, 382 + Math.sin(t * 0.7) * 1.6, Math.sin(t * 0.5) * 0.012, reveal);
  drawBirds(t, reveal);

  // Hairline rule with a small lozenge separates picture and lyrics.
  ctx.strokeStyle = `rgba(60,38,22,${0.5 * reveal})`;
  ctx.lineWidth = 1;
  for (const [a, b] of [[300, 628], [652, 980]]) { ctx.beginPath(); ctx.moveTo(a, RULE_Y); ctx.lineTo(b, RULE_Y); ctx.stroke(); }
  ctx.fillStyle = `rgba(140,47,22,${0.8 * reveal})`;
  ctx.beginPath(); ctx.moveTo(640, RULE_Y - 6); ctx.lineTo(646, RULE_Y); ctx.lineTo(640, RULE_Y + 6); ctx.lineTo(634, RULE_Y); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawBoat(x, y, tilt, alpha) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(tilt);
  ctx.fillStyle = `rgba(34,22,14,${0.86 * alpha})`;
  ctx.beginPath(); // hull
  ctx.moveTo(-46, -9); ctx.quadraticCurveTo(-24, 7, 0, 7); ctx.quadraticCurveTo(26, 7, 48, -11);
  ctx.quadraticCurveTo(22, -2, 0, -2); ctx.quadraticCurveTo(-22, -2, -46, -9); ctx.fill();
  ctx.beginPath(); // canopy
  ctx.moveTo(-17, -3); ctx.quadraticCurveTo(-13, -22, 4, -22); ctx.quadraticCurveTo(18, -22, 21, -3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = `rgba(34,22,14,${0.86 * alpha})`; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(35, -38); ctx.lineTo(25, 7); ctx.stroke(); // pole
  ctx.restore();
  ctx.strokeStyle = `rgba(34,22,14,${0.22 * alpha})`; ctx.lineWidth = 1.2;
  for (const [w, dy] of [[42, 11], [28, 17]]) { ctx.beginPath(); ctx.moveTo(x - w, y + dy); ctx.lineTo(x + w, y + dy); ctx.stroke(); }
}

function drawBirds(t, alpha) {
  const crossing = 48, phase = (t + 14) % crossing / crossing;
  const flock = [[0, 0], [-34, 13], [-29, -15], [-66, 22], [-60, -6]];
  ctx.lineWidth = 1.5; ctx.lineCap = "round";
  flock.forEach(([dx, dy], i) => {
    const x = SAFE.left + phase * (SAFE.right - SAFE.left + 90) + dx, y = 104 + dy + Math.sin(t * 0.4 + i) * 2;
    const a = alpha * clamp((x - SAFE.left - 8) / 50) * clamp((SAFE.right - x - 8) / 50) * 0.72;
    if (a <= 0) return;
    const flap = 3.4 + Math.sin(t * 2.1 + i * 1.7) * 2.2, span = 8;
    ctx.strokeStyle = `rgba(34,22,14,${a})`;
    ctx.beginPath(); ctx.moveTo(x - span, y - flap); ctx.quadraticCurveTo(x - span * 0.4, y - flap * 0.2, x, y);
    ctx.quadraticCurveTo(x + span * 0.4, y - flap * 0.2, x + span, y - flap); ctx.stroke();
  });
}

// Measures every lyric row against the safe area; render.mjs refuses to continue if this reports problems.
function checkLayout() {
  const issues = [];
  ctx.textBaseline = "alphabetic";
  rows.forEach((line, i) => {
    const count = line.display.length;
    const baselines = baselinesFor(count);
    line.display.forEach((row, k) => {
      const text = row.map((w) => w.text).join(" ");
      ctx.font = `${line.size}px ${FONT}`;
      const m = ctx.measureText(text);
      const left = W / 2 - m.width / 2, right = W / 2 + m.width / 2;
      const bottom = baselines[k] + m.actualBoundingBoxDescent, top = baselines[k] - m.actualBoundingBoxAscent;
      if (left < SAFE.left || right > SAFE.right || top < (song.textTop || song.textBottom ? SAFE.top : (song.strip ? bandTop : RULE_Y) + 6) || bottom > SAFE.bottom) issues.push(`line ${i + 1} row ${k + 1} leaves the safe area: "${text}"`);
      if (graphemes(text) > MAX_CHARS + 2) issues.push(`line ${i + 1} row ${k + 1} has ${graphemes(text)} characters: "${text}"`);
    });
    if (count > 3) issues.push(`line ${i + 1} needs ${count} rows; split it in the lyrics file`);
  });
  for (const [label, text, size] of [["title", song.title, 50], ["artist", song.artist, 26]]) {
    if (!text) continue;
    ctx.font = `${size}px ${FONT}`;
    if (ctx.measureText(text).width > SAFE.right - SAFE.left) issues.push(`${label} is too wide: "${text}"`);
    if (graphemes(text) > MAX_CHARS + 2) issues.push(`${label} has ${graphemes(text)} characters: "${text}"`);
  }
  return issues;
}

function drawGuides() {
  ctx.save();
  ctx.setLineDash([8, 6]); ctx.strokeStyle = "#00a0ff"; ctx.lineWidth = 2;
  ctx.strokeRect(SAFE.left, SAFE.top, SAFE.right - SAFE.left, SAFE.bottom - SAFE.top);
  ctx.restore();
}

window.init = async (data, fonts) => {
  for (const f of fonts) {
    const face = new FontFace(FONT, `url(data:font/woff2;base64,${f.base64})`, { unicodeRange: f.range });
    document.fonts.add(await face.load());
  }
  song = data;
  rows = data.lines.map(layoutLine);
  const mostRows = Math.max(...rows.map((line) => line.display.length));
  bandTop = mostRows === 1 ? 464 : mostRows === 2 ? 432 : 416;
  paper = makePaper();
  washes = [makeHill(5, 238, 110, 0.2), makeHill(8, 288, 94, 0.36), makeHill(17, 336, 66, 0.56)];
  return checkLayout();
};

// Text-only mode: solid colours and a dark outline on green. No transparency, because it would blend with the key colour.
const TEXT_AREA = 260;
const UNSUNG = [186, 178, 160], SUNG = [255, 248, 230], SAFFRON = [255, 170, 50], OUTLINE = "rgb(28,16,8)";

function outlined(text, x, y, size, color) {
  ctx.font = `${size}px ${FONT}`;
  ctx.lineJoin = "round"; ctx.lineWidth = Math.max(4, size * 0.1); ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = `rgb(${color.join(",")})`;
  ctx.fillText(text, x, y);
}

// Lines open with a wipe from the centre.
function wiped(k, drawContent) {
  if (k <= 0) return;
  const half = (W / 2) * k;
  ctx.save();
  ctx.beginPath(); ctx.rect(W / 2 - half, 0, half * 2, H); ctx.clip();
  drawContent();
  ctx.restore();
}

function drawTextOnly(t) {
  const areaY = song.textBottom ? H - 280 : 0;
  const titleY = song.textBottom ? 538 : 106, artistY = titleY + 44;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  rows.forEach((line, i) => {
    const { show, hide } = lineWindow(i);
    if (t < show || t > hide) return;
    wiped(ease((t - show) / 0.35) * ease((hide - t) / 0.35), () => {
      const baselines = baselinesFor(line.display.length);
      line.display.forEach((row, k) => {
        const space = (ctx.font = `${line.size}px ${FONT}`, ctx.measureText(" ").width);
        let x = W / 2 - fit(row, line.size) / 2;
        for (const word of row) {
          const ramp = Math.max(0.12, Math.min(0.22, word.end - word.start));
          const sung = ease((t - word.start) / ramp), glow = sung * (1 - ease((t - word.end) / 0.5));
          outlined(word.text, x, baselines[k], line.size, mix(mix(UNSUNG, SUNG, sung), SAFFRON, glow));
          x += fit([word], line.size) + space;
        }
      });
    });
  });
  const firstShow = lineWindow(0).show;
  if (song.title && t < firstShow) {
    wiped(ease((t - 0.3) / 0.5) * ease((firstShow - t) / 0.4), () => {
      ctx.font = `50px ${FONT}`;
      outlined(song.title, W / 2 - ctx.measureText(song.title).width / 2, titleY, 50, SUNG);
      if (song.artist) {
        ctx.font = `26px ${FONT}`;
        outlined(song.artist, W / 2 - ctx.measureText(song.artist).width / 2, artistY, 26, SUNG);
      }
    });
  }

  // Harden the outer edge so no pixel blends with the key colour; edges inside the text stay smooth.
  const img = ctx.getImageData(0, areaY, W, TEXT_AREA), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
  ctx.putImageData(img, 0, areaY);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
}

// How far the band is open: it closes during gaps over 6 s so the footage underneath shows fully.
function bandOpen(t) {
  const first = lineWindow(0).show;
  if (song.title && t < first) return ease(t / 0.4);
  if (rows.some((_, i) => { const w = lineWindow(i); return t >= w.show && t <= w.hide; })) return 1;
  const { from, to } = gapAround(t);
  if (to - from <= 6) return 1;
  return Math.max(1 - ease((t - from) / 0.4), to < song.duration ? ease((t - (to - 0.4)) / 0.4) : 0);
}

function drawStrip(t) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, W, H);
  const height = 2 * Math.round(((BAND.bottom - bandTop) * bandOpen(t)) / 2);
  if (height <= 0) return;
  const top = BAND.bottom - height, width = BAND.right - BAND.left;
  ctx.save();
  ctx.beginPath(); ctx.rect(BAND.left, top, width, height); ctx.clip();
  ctx.drawImage(paper, BAND.left, bandTop, width, BAND.bottom - bandTop, BAND.left, bandTop, width, BAND.bottom - bandTop);
  ctx.strokeStyle = "rgba(60,38,22,0.45)"; ctx.lineWidth = 1;
  ctx.strokeRect(BAND.left + 8.5, bandTop + 8.5, width - 17, BAND.bottom - bandTop - 17);
  drawLyrics(t);
  ctx.restore();
}

window.draw = (t, guides = false) => {
  if (song.textTop || song.textBottom) {
    drawTextOnly(t);
    if (guides) drawGuides();
    return;
  }
  if (song.strip) {
    drawStrip(t);
    if (guides) drawGuides();
    return;
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(paper, 0, 0);
  // Very slow change of light across the page.
  const lx = W * (0.3 + 0.4 * clamp(t / song.duration)), light = ctx.createRadialGradient(lx, 240, 40, lx, 240, 780);
  light.addColorStop(0, "rgba(255,240,205,0.14)");
  light.addColorStop(1, "rgba(255,240,205,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  drawIllustration(t);
  drawLyrics(t);
  if (guides) drawGuides();
};

window.frame = (t, type, quality) => { window.draw(t); return canvas.toDataURL(type, quality).split(",")[1]; };
window.guidedFrame = (t) => { window.draw(t, true); return canvas.toDataURL("image/png").split(",")[1]; };
