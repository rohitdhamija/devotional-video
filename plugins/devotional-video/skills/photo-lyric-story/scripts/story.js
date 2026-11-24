// Photo story scene on a 2D canvas. Runs in headless Chrome; slideshow.mjs calls init() then frame(t).
// Every frame depends only on t. Lyrics are not drawn here: kinetic-lyrics lays them over this video afterwards.
const W = 1280, H = 720;
const SAFE = { left: 64, right: W - 64, top: 40, bottom: H - 90 };
// The lyric band kinetic-lyrics fills (its --text-box). Faces are kept above it.
const BAND = { top: 452, bottom: SAFE.bottom };
// A shot's focus point sits at this height in the frame, clear of the lyric band.
const ANCHOR_Y = 0.36;
const FONT = "Story";
const GOLD = "#ffd21f", CREAM = "#fbf6ea", HEART = "#ff4f79";
const MOVES = {
  in: { zoom: [1.0, 1.12], ax: [0.5, 0.5] },
  out: { zoom: [1.12, 1.0], ax: [0.5, 0.5] },
  left: { zoom: [1.12, 1.12], ax: [0.57, 0.43] },
  right: { zoom: [1.12, 1.12], ax: [0.43, 0.57] },
  still: { zoom: [1.04, 1.04], ax: [0.5, 0.5] },
};

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
// --hd: every canvas has SCALE times the pixels and is drawn through that scale, so all layout stays in
// 1280x720 units while photos and type come out sharp at 1920x1080.
let SCALE = 1, layers;
function frameCanvas() {
  const c = document.createElement("canvas"); c.width = W * SCALE; c.height = H * SCALE;
  c.getContext("2d").setTransform(SCALE, 0, 0, SCALE, 0, 0);
  return c;
}
let story, shots, beats, duration, overlay;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const smooth = (x) => x * x * (3 - 2 * x);
const rand = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function kickAt(t) {
  let found = -1;
  for (let i = 0; i < beats.length && beats[i].t <= t; i++) found = i;
  return found < 0 ? 0 : clamp(beats[found].s * Math.exp(-(t - beats[found].t) / 0.16));
}

// Same landing curve as kinetic-lyrics: starts small, overshoots, settles at 1.
function slam(x) {
  if (x >= 0.24) return 1;
  if (x < 0.08) return 0.6 + 0.5 * (x / 0.08);
  return 1 + 0.1 * (1 - (x - 0.08) / 0.16) ** 2;
}

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

// Cover-fit with the focus point placed at (ax, ay) of the frame, never showing past the photo's edge.
function drawCover(c, img, fx, fy, zoom, ax, ay) {
  const s = Math.max(W / img.width, H / img.height) * zoom, w = img.width * s, h = img.height * s;
  const x = clamp(W * ax - fx * w, W - w, 0), y = clamp(H * ay - fy * h, H - h, 0);
  c.drawImage(img, x, y, w, h);
}

// A blurred, darkened fill of the photo, the backdrop for a portrait shown as a card.
function blurredFill(img) {
  const c = frameCanvas();
  const b = c.getContext("2d");
  b.filter = "blur(28px) saturate(1.1)";
  drawCover(b, img, 0.5, 0.4, 1.15, 0.5, 0.5);
  b.filter = "none";
  b.fillStyle = "rgba(10, 6, 2, 0.45)"; b.fillRect(0, 0, W, H);
  return c;
}

function drawShot(c, shot, t) {
  c.save();
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
  const p = clamp((t - shot.from) / (shot.to - shot.from));
  const move = MOVES[shot.move];
  let zoom = lerp(shot.zoom[0], shot.zoom[1], p);
  if (shot.pulse) zoom *= 1 + 0.012 * kickAt(t);
  const [fx, fy] = [lerp(shot.focus[0], shot.focusTo[0], p), lerp(shot.focus[1], shot.focusTo[1], p)];
  const ax = lerp(move.ax[0], move.ax[1], p);
  if (shot.fit === "cover") {
    drawCover(c, shot.img, fx, fy, zoom, ax, ANCHOR_Y);
  } else {
    // Card: the whole portrait in a cream border, slightly tilted, over its own blurred fill.
    c.translate(W / 2, H / 2); c.scale(zoom, zoom); c.translate(-W / 2, -H / 2);
    c.drawImage(shot.blur, 0, 0, W, H);
    c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    const k = 1 + (zoom - 1) * 0.3, h = 540 * k, w = (h * shot.img.width) / shot.img.height, border = 10;
    const cx = W / 2 + (ax - 0.5) * 300, cy = (SAFE.top + SAFE.bottom) / 2;
    c.translate(cx, cy); c.rotate((shot.tilt * Math.PI) / 180);
    c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 34; c.shadowOffsetY = 10;
    c.fillStyle = CREAM; c.fillRect(-w / 2 - border, -h / 2 - border, w + border * 2, h + border * 2);
    c.shadowColor = "transparent";
    c.drawImage(shot.img, -w / 2, -h / 2, w, h);
  }
  c.restore();
}

function paint(shot, t, i) {
  const c = layers[i].getContext("2d");
  c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  c.clearRect(0, 0, W, H);
  drawShot(c, shot, t);
  return layers[i];
}

function drawPhotos(t) {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  for (let j = 1; j < shots.length; j++) {
    const a = shots[j - 1], b = shots[j], d = b.length;
    if (d > 0 && t >= b.cut - d / 2 && t < b.cut + d / 2) {
      const k = (t - (b.cut - d / 2)) / d, e = ease(k);
      const A = paint(a, t, 0), B = paint(b, t, 1);
      if (b.transition === "fade") {
        ctx.drawImage(A, 0, 0, W, H); ctx.globalAlpha = smooth(k); ctx.drawImage(B, 0, 0, W, H);
      } else if (b.transition === "push") {
        const dir = b.dir === "right" ? -1 : 1;
        ctx.drawImage(A, -dir * W * e, 0, W, H); ctx.drawImage(B, dir * W * (1 - e), 0, W, H);
      } else if (b.transition === "zoom") {
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(1.15 - 0.15 * e, 1.15 - 0.15 * e); ctx.drawImage(B, -W / 2, -H / 2, W, H); ctx.restore();
        ctx.save(); ctx.globalAlpha = 1 - e; ctx.translate(W / 2, H / 2); ctx.scale(1 + 0.3 * e, 1 + 0.3 * e); ctx.drawImage(A, -W / 2, -H / 2, W, H); ctx.restore();
      } else if (b.transition === "flash") {
        // One soft warm flash peaking on the beat; never a full white frame.
        ctx.drawImage(k < 0.5 ? A : B, 0, 0, W, H);
        ctx.globalAlpha = 0.8 * (1 - Math.abs(2 * k - 1)) ** 1.5;
        ctx.fillStyle = "#fff4d6"; ctx.fillRect(0, 0, W, H);
      }
      ctx.globalAlpha = 1;
      return;
    }
  }
  let i = 0;
  while (i + 1 < shots.length && shots[i + 1].cut <= t) i++;
  ctx.drawImage(paint(shots[i], t, 0), 0, 0, W, H);
}

// Darkens the edges and the lyric band so white and gold type read on any photo.
function makeOverlay() {
  const c = frameCanvas();
  const o = c.getContext("2d");
  const v = o.createRadialGradient(W / 2, H * 0.42, H * 0.35, W / 2, H * 0.42, W * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.5)");
  o.fillStyle = v; o.fillRect(0, 0, W, H);
  const s = o.createLinearGradient(0, BAND.top - 90, 0, H);
  s.addColorStop(0, "rgba(0,0,0,0)"); s.addColorStop(0.45, "rgba(0,0,0,0.5)"); s.addColorStop(1, "rgba(0,0,0,0.7)");
  o.fillStyle = s; o.fillRect(0, BAND.top - 90, W, H - BAND.top + 90);
  return c;
}

function star(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.28 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

// Original drawn gold sparkles, drifting up and twinkling, kept inside the safe area.
function sparkles(t, start, end, count) {
  const a = clamp((t - start) / 1) * clamp((end - t) / 0.6);
  if (a <= 0) return;
  ctx.save();
  ctx.fillStyle = GOLD; ctx.shadowColor = "rgba(255,210,31,0.8)"; ctx.shadowBlur = 10;
  for (let i = 0; i < count; i++) {
    const span = SAFE.bottom - SAFE.top - 40;
    const y = SAFE.top + 20 + ((rand(i + 50) * span - (t - start) * (14 + rand(i + 7) * 22)) % span + span) % span;
    const x = SAFE.left + 10 + rand(i) * (SAFE.right - SAFE.left - 20) + Math.sin(t * 0.8 + i) * 8;
    ctx.globalAlpha = a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (2 + rand(i + 3) * 3) + i * 1.7)));
    star(x, y, 3 + rand(i + 11) * 7);
  }
  ctx.restore();
}

function heartPath(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.4);
  ctx.bezierCurveTo(x - s * 0.62, y - s * 0.02, x - s * 0.38, y - s * 0.62, x, y - s * 0.24);
  ctx.bezierCurveTo(x + s * 0.38, y - s * 0.62, x + s * 0.62, y - s * 0.02, x, y + s * 0.4);
  ctx.closePath();
}

// Text where "♥" is drawn as a heart shape, since the font has no heart glyph.
function partsOf(text, size) {
  ctx.font = `800 ${size}px ${FONT}`;
  const gap = size * 0.3;
  return text.split("♥").map((s) => s.trim()).flatMap((s, i) => (i ? [{ heart: true, w: size * 0.8 + gap * 2 }] : []).concat(s ? [{ s, w: ctx.measureText(s).width }] : []));
}
function fitSize(text, max, width) {
  let size = max;
  while (size > 30 && partsOf(text, size).reduce((a, p) => a + p.w, 0) > width) size -= 2;
  return size;
}
function drawRich(text, cx, cy, size, fill) {
  const parts = partsOf(text, size);
  let x = cx - parts.reduce((a, p) => a + p.w, 0) / 2;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  for (const p of parts) {
    if (p.heart) {
      heartPath(x + p.w / 2, cy, size * 0.8);
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.save(); ctx.translate(5, 5); ctx.fill(); ctx.restore();
      ctx.fillStyle = HEART; ctx.fill();
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillText(p.s, x + 5, cy + 5);
      ctx.fillStyle = fill; ctx.fillText(p.s, x, cy);
    }
    x += p.w;
  }
}

function drawTitle(t) {
  const T = story.titleCard;
  if (!T || t < T.start || t >= T.end) return;
  const x = t - T.start, out = clamp((T.end - t) / 0.3);
  const k = slam(x);
  ctx.save();
  ctx.globalAlpha = clamp(x / 0.08) * out;
  ctx.translate(W / 2, T.y); ctx.scale(k, k);
  drawRich(story.title, 0, 0, T.size, GOLD);
  ctx.restore();
}

function drawEnd(t) {
  const E = story.endCard;
  if (!E || t < E.start) return;
  const x = t - E.start, a = clamp(x / 0.7);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(W / 2, E.y + (1 - smooth(a)) * 20);
  const breathe = 1 + 0.015 * Math.sin(x * 2.2);
  ctx.scale(breathe, breathe);
  drawRich(E.text, 0, 0, E.size, GOLD);
  ctx.restore();
}

window.init = async (data, font) => {
  SCALE = data.scale ?? 1;
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  layers = [frameCanvas(), frameCanvas()];
  const face = new FontFace(FONT, `url(data:font/woff2;base64,${font})`, { weight: "800" });
  document.fonts.add(await face.load());
  story = data.story; beats = data.beats; duration = data.duration;
  const images = {};
  for (const [name, src] of Object.entries(data.images)) images[name] = await loadImage(src);
  // Shape decides the fit unless the story says otherwise: portraits become cards, landscapes fill the frame.
  // naturalWidth/Height already have the camera's EXIF rotation applied.
  shots = data.shots.map((s) => {
    const img = images[s.photo];
    return { ...s, img, fit: s.fit ?? (img.naturalHeight > img.naturalWidth ? "card" : "cover") };
  });
  for (const s of shots) if (s.fit === "card") s.blur = blurredFill(s.img);
  overlay = makeOverlay();
  const issues = [];
  const width = SAFE.right - SAFE.left - 20;
  if (story.title) {
    const size = fitSize(story.title, 104, width / 1.1);
    story.titleCard = { ...data.titleCard, size, y: (BAND.top + BAND.bottom) / 2 };
  }
  if (data.endCard) {
    const size = fitSize(data.endCard.text, 76, width / 1.03);
    if (size < 40) issues.push(`end text is too long for one row: "${data.endCard.text}"`);
    story.endCard = { ...data.endCard, size, y: SAFE.top + 30 + size * 0.6 };
  }
  return { problems: issues, fits: shots.map((s) => s.fit) };
};

window.frame = (t, label) => {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.globalAlpha = 1;
  drawPhotos(t);
  ctx.drawImage(overlay, 0, 0, W, H);
  if (story.titleCard) sparkles(t, 0, story.titleCard.end + 0.4, 26);
  if (story.endCard) sparkles(t, story.endCard.start - 0.3, duration + 1, 34);
  drawTitle(t);
  drawEnd(t);
  if (label) {
    ctx.font = `800 26px ${FONT}`; ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0, 0, ctx.measureText(label).width + 24, 44);
    ctx.fillStyle = "#fff"; ctx.fillText(label, 12, 8);
  }
  return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
};
