// Kinetic lyric scene on a 2D canvas. Runs in headless Chrome; render.mjs calls init() then frame(t). Every frame depends only on t.
let W = 1280, H = 720;
let SAFE = { left: 64, right: W - 64, top: 40, bottom: H - 90 };
let BAND = { top: 356, bottom: SAFE.bottom };
let GRAPHIC_BOTTOM = 340;
const MAX_CHARS = 32;
let MAX_ROWS = 3, MAX_SIZE = 170, MIN_SIZE = 44;
// Drawing sizes and speed-line reach for the current frame shape.
let RUSH = { hero: 128, reach: 1, lineX: 1.5, lineY: 0.75 };
// Verse mode (--verses): a taller lyric band, so the drawings and bars shrink by ART_SCALE to fit the area above it.
let ART_SCALE = 1, VERSE_SIZE = [110, 40], screens = null;
// Verse type is smaller, so a row may hold more characters than in single-line mode.
const VERSE_CHARS = 48;
const FONT = "Kinetic";
const LINE_GAP = 1.3;
let SHADOW = 6;
// Peak motion the layout must leave room for, so the safe area holds at the top of every animation.
const KICK_SCALE = 0.035, KICK_RISE = 8, WORD_OVERSHOOT = 1.1;
const PALETTES = [
  { bg: "#14103a", accent: "#ffd21f", bars: "#ff4f79" },
  { bg: "#2a0a24", accent: "#ff8a24", bars: "#29d3c2" },
  { bg: "#06283d", accent: "#5cf2ff", bars: "#ffb703" },
  { bg: "#1c1c1c", accent: "#b7f000", bars: "#ff5a5a" },
];

// --green: a flat chroma-key background with lyrics only. Solid colours, no transparency and nothing green in the
// text, so the key stays clean.
// --background: lyrics only on a transparent canvas, composited onto the user's video. A soft dark panel behind
// each verse keeps the type readable over bright footage.
const OVERLAY = { bg: "#000000", accent: "#ffd21f", ink: "#ffffff" };
// Current line white with a thick maroon edge and a gold sung word; every other line maroon with a thin cream edge.
const GREEN = { bg: "#00b140", accent: "#ffc21a", bars: "#ffc21a", ink: "#ffffff", edge: "#5a0f14", dim: "#e6d3ad", ghost: "#7a1c22", ghostEdge: "#f6ead0" };

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
let song, lines, beats, levels, rush;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const graphemes = (s) => [...new Intl.Segmenter("hi", { granularity: "grapheme" }).segment(s)].length;
let FONT_PX = 0;
const setFont = (size) => { FONT_PX = size; ctx.font = `800 ${size}px ${FONT}`; };
// Outlined text for --green: a thick solid edge drawn under the fill, so it reads over bright footage once keyed.
function edgedText(text, x, y, fill, edge, width) {
  ctx.lineJoin = "round"; ctx.lineWidth = width; ctx.strokeStyle = edge;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

// Scale at x seconds after a word lands: starts small, overshoots, settles at 1.
function slam(x) {
  if (x >= 0.24) return 1;
  if (x < 0.08) return 0.6 + (WORD_OVERSHOOT - 0.6) * (x / 0.08);
  return 1 + (WORD_OVERSHOOT - 1) * (1 - (x - 0.08) / 0.16) ** 2;
}

// Last index in sorted items with key <= t, or -1.
function lastAtOrBefore(items, t, key) {
  let lo = 0, hi = items.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(items[mid]) <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

function kickAt(t) {
  const i = lastAtOrBefore(beats, t, (b) => b.t);
  if (i < 0) return 0;
  return clamp(beats[i].s * Math.exp(-(t - beats[i].t) / 0.16));
}

// Split a line into at most `count` rows, keeping words whole and row lengths as even as possible.
function splitRows(words, count) {
  if (count === 1 || words.length <= 1) return [words];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const head = words.slice(0, i), tail = splitRows(words.slice(i), count - 1);
    const lengths = [head, ...tail].map((r) => graphemes(r.map((w) => w.text).join(" ")));
    const worst = Math.max(...lengths);
    if (!best || worst < best.worst) best = { worst, rows: [head, ...tail] };
  }
  return best.rows;
}

// Word boxes for one arrangement, centred horizontally and vertically in the band.
function arrange(rows, size, extra = 0) {
  setFont(size);
  const space = ctx.measureText(" ").width * 1.6; // wider than a normal space so landing words do not collide
  const placed = rows.map((row) => {
    const widths = row.map((w) => ctx.measureText(w.text).width);
    const metrics = row.map((w) => ctx.measureText(w.text));
    return {
      row, widths, metrics,
      width: widths.reduce((a, b) => a + b, 0) + space * (row.length - 1),
      ascent: Math.max(...metrics.map((m) => m.actualBoundingBoxAscent)),
      descent: Math.max(...metrics.map((m) => m.actualBoundingBoxDescent)),
    };
  });
  // Even row spacing, so rows without tall or hanging letters do not collide with their neighbours.
  const pitch = Math.max(size * 1.12, Math.max(...placed.map((r) => r.ascent)) + Math.max(...placed.map((r) => r.descent)) + size * 0.06) + extra;
  const height = placed[0].ascent + pitch * (placed.length - 1) + placed[placed.length - 1].descent;
  const top = (BAND.top + BAND.bottom - SHADOW) / 2 - height / 2;
  const items = [];
  placed.forEach((r, rowIndex) => {
    const baseline = top + placed[0].ascent + pitch * rowIndex;
    let x = W / 2 - r.width / 2;
    r.row.forEach((word, i) => {
      items.push({ word, x, baseline, width: r.widths[i], ascent: r.metrics[i].actualBoundingBoxAscent, descent: r.metrics[i].actualBoundingBoxDescent });
      x += r.widths[i] + space;
    });
  });
  return { size, items, cy: top + height / 2 };
}

// Furthest extent of any word at the peak of its landing, with the row kicked at full strength.
function worstBounds(layout, cx, cy) {
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  const k = 1 + KICK_SCALE;
  for (const it of layout.items) {
    const wx = it.x + it.width / 2, half = (it.width / 2) * WORD_OVERSHOOT * k;
    const px = cx + (wx - cx) * k, py = cy + (it.baseline - cy) * k - KICK_RISE;
    box.left = Math.min(box.left, px - half);
    box.right = Math.max(box.right, px + half + SHADOW);
    box.top = Math.min(box.top, py - it.ascent * WORD_OVERSHOOT * k);
    box.bottom = Math.max(box.bottom, cy + (it.baseline - cy) * k + it.descent * WORD_OVERSHOOT * k + SHADOW);
  }
  return box;
}

const fits = (b) => b.left >= SAFE.left && b.right <= SAFE.right && b.top >= BAND.top - 8 && b.bottom <= SAFE.bottom;

// Try each row count and keep whichever allows the largest type within the character limit.
function layoutLine(line) {
  let best = null;
  for (let count = 1; count <= Math.min(MAX_ROWS, line.words.length); count++) {
    const rows = splitRows(line.words, count);
    if (rows.some((r) => graphemes(r.map((w) => w.text).join(" ")) > MAX_CHARS)) continue;
    for (let size = MAX_SIZE; size >= MIN_SIZE; size -= 2) {
      const layout = arrange(rows, size);
      if (fits(worstBounds(layout, W / 2, layout.cy))) {
        if (!best || size > best.size) best = layout;
        break;
      }
    }
  }
  return best;
}

// Verse mode: the lyric band grows upward to hold several lines; the graphic area above shrinks to match.
function useVerseBand(vertical, green) {
  if (vertical) { BAND = { top: green ? 560 : 860, bottom: SAFE.bottom }; GRAPHIC_BOTTOM = 840; VERSE_SIZE = [130, 56]; }
  else { BAND = { top: green ? 180 : 296, bottom: SAFE.bottom }; GRAPHIC_BOTTOM = 280; VERSE_SIZE = [110, 40]; }
  ART_SCALE = 0.8;
  RUSH.hero *= ART_SCALE;
}

const rowText = (row) => row.map((w) => w.text).join(" ");
function centreOf(items) {
  const top = Math.min(...items.map((it) => it.baseline - it.ascent)), bottom = Math.max(...items.map((it) => it.baseline + it.descent));
  return (top + bottom) / 2;
}

// Several lyric lines on one screen at the largest size where each line, kicked at its peak, stays in the band.
// Each line takes one row, unless wrapping lines onto two rows gives type at least WRAP_GAIN larger (long lines in a
// tall box). Only if one row cannot fit at the minimum size may a line wrap onto up to MAX_ROWS rows.
const WRAP_GAIN = 1.25;
function layoutScreen(group) {
  const one = layoutScreenRows(group, [1]);
  if (!one) return layoutScreenRows(group, Array.from({ length: MAX_ROWS }, (_, i) => i + 1));
  const two = layoutScreenRows(group, [1, 2]);
  return two && two.size >= one.size * WRAP_GAIN ? two : one;
}
function layoutScreenRows(group, counts) {
  const [max, min] = VERSE_SIZE, room = SAFE.right - SAFE.left - SHADOW;
  for (let size = max; size >= min; size -= 2) {
    setFont(size);
    const space = ctx.measureText(" ").width * 1.6, rows = [];
    const wide = (row) => (row.reduce((a, w) => a + ctx.measureText(w.text).width, 0) + space * (row.length - 1)) * (1 + KICK_SCALE) * WORD_OVERSHOOT > room;
    for (const line of group) {
      const split = counts.map((n) => splitRows(line.words, n)).find((r) => r.every((row) => graphemes(rowText(row)) <= VERSE_CHARS && !wide(row)));
      if (!split) { rows.length = 0; break; }
      rows.push(...split);
    }
    if (!rows.length) continue;
    const layout = arrange(rows, size, KICK_RISE + size * KICK_SCALE * 2);
    const parts = group.map((line) => layout.items.filter((it) => line.words.includes(it.word)));
    if (parts.every((items) => fits(worstBounds({ items }, W / 2, centreOf(items))))) return { size, items: layout.items, parts };
  }
  return null;
}

// Each verse goes on one screen if it fits at the minimum size; otherwise it splits into the fewest even screens that do.
function buildScreens(verses, issues) {
  const out = [];
  for (const rows of verses) {
    let placed = false;
    // --screen-lines caps how many lyric lines share a screen, trading lines for larger type.
    for (let count = Math.ceil(rows.length / (song.screenLines || rows.length)); count <= rows.length && !placed; count++) {
      const base = Math.floor(rows.length / count), extra = rows.length % count, chunks = [];
      for (let k = 0, at = 0; k < count; k++) { const n = base + (k < extra ? 1 : 0); chunks.push(rows.slice(at, at + n)); at += n; }
      const layouts = chunks.map((c) => layoutScreen(c.map((r) => lines[r])));
      if (layouts.every(Boolean)) { chunks.forEach((c, k) => out.push({ rows: c, verse: verses.indexOf(rows), ...layouts[k] })); placed = true; }
    }
    if (!placed) issues.push(`a line in verse ${verses.indexOf(rows) + 1} does not fit at ${VERSE_SIZE[1]}px even on its own screen`);
  }
  out.forEach((s, k) => {
    const first = lines[s.rows[0]], prev = out[k - 1];
    s.start = first.start; s.end = lines[s.rows[s.rows.length - 1]].end;
    // Upcoming lines are shown ahead of the first one, but not before the previous screen's last line is done.
    s.show = prev ? Math.min(first.start, Math.max(prev.end + 0.3, first.start - 1.2)) : first.start;
    s.palette = k % PALETTES.length;
    for (const r of s.rows) lines[r].palette = s.palette;
  });
  out.forEach((s, k) => { s.hide = Math.min(out[k + 1] ? out[k + 1].show : song.duration, s.end + 2.5); });
  return out;
}

// YouTube Shorts: the margins keep content clear of the title and caption at the bottom and the buttons on the right.
function useVerticalFrame() {
  W = 1080; H = 1920;
  SAFE = { left: 120, right: W - 120, top: 220, bottom: 1500 };
  BAND = { top: 1010, bottom: SAFE.bottom };
  GRAPHIC_BOTTOM = 990;
  MAX_ROWS = 4; MAX_SIZE = 190; MIN_SIZE = 60; SHADOW = 8;
  RUSH = { hero: 240, reach: 1.6, lineX: 0.95, lineY: 1.25 };
  canvas.width = W; canvas.height = H;
}

// --hd: the canvas has SCALE times the pixels and every frame is drawn through that scale, so the layout,
// safe area and type sizes stay in 1280x720 units while the output is a sharp 1920x1080.
let SCALE = 1;

window.init = async (data, fonts) => {
  if (data.vertical) useVerticalFrame();
  SCALE = data.scale ?? 1;
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  if (data.verses) useVerseBand(data.vertical, data.green || data.overlay);
  // --text-box x,y,w,h: lyrics stay inside this rectangle, e.g. an opening in the background footage.
  if (data.textBox) {
    const [x, y, w, h] = data.textBox;
    SAFE = { ...SAFE, left: x, right: x + w, bottom: y + h };
    BAND = { top: y + 8, bottom: y + h };
    VERSE_SIZE = [VERSE_SIZE[0], Math.min(VERSE_SIZE[1], 34)];
  }
  for (const f of fonts) {
    const face = new FontFace(FONT, `url(data:font/woff2;base64,${f.base64})`, { weight: "800", unicodeRange: f.range });
    document.fonts.add(await face.load());
  }
  song = data;
  beats = data.beatData.beats;
  levels = data.beatData.levels;
  const issues = [];
  lines = data.lines.map((line, i) => {
    const layout = data.verses ? null : layoutLine(line);
    if (!layout && !data.verses) issues.push(`line ${i + 1} does not fit in ${MAX_ROWS} rows of up to ${MAX_CHARS} characters: "${line.text}"`);
    return { ...line, layout };
  });
  lines.forEach((line, i) => {
    const next = lines[i + 1];
    line.hide = next ? Math.min(next.start, line.end + 0.7) : Math.min(song.duration, line.end + 1.2);
    line.palette = i % PALETTES.length;
  });
  if (data.verses) screens = buildScreens(data.verses, issues);
  if (song.style === "sketch") {
    if (!data.drawingData) issues.push("--style sketch needs --drawings drawings.json");
    const found = data.drawingData && lineKeywords(data.drawingData, issues);
    if (found) {
      for (const name of [...(data.drawingData.intro ?? []), ...(data.drawingData.outro ?? [])]) if (!DRAWINGS[name]) issues.push(`unknown drawing "${name}"`);
      if (!issues.length) { buildSketch({ ...data.drawingData, perLine: found.perLine }); sketch.missing = found.missing; }
    }
    issues.push(...endCardIssues());
  } else if (data.drawingData) buildRush(data.drawingData, issues);
  for (const [label, text, size] of [["title", song.title, 86], ["artist", song.artist, 34], ["greeting", song.greeting, 50]]) {
    if (!text) continue;
    setFont(size);
    if (ctx.measureText(text).width + SHADOW > (SAFE.right - SAFE.left) / ((1 + KICK_SCALE) * WORD_OVERSHOOT)) issues.push(`${label} is too wide: "${text}"`);
  }
  return issues;
};

function drawBackground(t) {
  // --no-panel: the outlined --green text style on a transparent canvas.
  if (song.overlay) { ctx.clearRect(0, 0, W, H); return song.noPanel ? GREEN : OVERLAY; }
  if (song.green) { ctx.fillStyle = GREEN.bg; ctx.fillRect(0, 0, W, H); return GREEN; }
  const set = song.style === "sketch" ? SKETCH_PALETTES : PALETTES;
  const keyed = screens ?? lines, at = (s) => s.show ?? s.start;
  const i = lastAtOrBefore(keyed, t, at);
  const current = set[i < 0 ? 0 : keyed[i].palette];
  ctx.fillStyle = current.bg;
  ctx.fillRect(0, 0, W, H);
  if (i >= 1) {
    // Diagonal wipe from the outgoing colour. Slow enough that a full change is never a flash.
    const k = clamp((t - at(keyed[i])) / 0.26);
    if (k < 1) {
      const edge = (W + 240) * (1 - k * k);
      ctx.fillStyle = set[keyed[i - 1].palette].bg;
      ctx.beginPath(); ctx.moveTo(W - edge, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W - edge - 240, H); ctx.closePath(); ctx.fill();
    }
  }
  if (song.style === "sketch") drawPaper(current);
  return current;
}

function drawGraphics(t, palette) {
  const kick = kickAt(t);
  ctx.save();
  ctx.beginPath(); ctx.rect(SAFE.left, SAFE.top, SAFE.right - SAFE.left, GRAPHIC_BOTTOM - SAFE.top); ctx.clip();

  // Rings: one expands from each recent beat.
  const cx = W / 2, cy = (SAFE.top + GRAPHIC_BOTTOM) / 2;
  const last = lastAtOrBefore(beats, t, (b) => b.t);
  for (let i = Math.max(0, last - 3); i <= last; i++) {
    const age = t - beats[i].t;
    if (age > 0.9) continue;
    const k = age / 0.9;
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = (1 - k) ** 2 * 0.55 * beats[i].s;
    ctx.lineWidth = (6 + 10 * beats[i].s) * (1 - k * 0.7);
    ctx.beginPath(); ctx.arc(cx, cy, 40 + k * 520, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Bars mirrored from the centre, driven by the audio levels; low notes in the middle.
  const row = levels[clamp(Math.floor(t * song.beatData.fps), 0, levels.length - 1)];
  const count = row.length, slot = (SAFE.right - SAFE.left) / (count * 2), gap = 3;
  const maxHeight = GRAPHIC_BOTTOM - SAFE.top - 16;
  ctx.fillStyle = palette.bars;
  for (let i = 0; i < count; i++) {
    const height = 6 + maxHeight * (row[i] / 99) ** 1.7 * (0.85 + 0.15 * kick);
    for (const side of [-1, 1]) {
      const x = cx + side * (i * slot + slot / 2) - (slot - gap) / 2;
      ctx.fillRect(x, GRAPHIC_BOTTOM - height, slot - gap, height);
    }
  }
  ctx.restore();
}

const normalWord = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}]/gu, "");

// Keywords sung in each line, as [{ name, start }]. "rows" in drawings.json overrides "words" for one row
// (numbered from 1); a null value there means that word gets no drawing in that row.
function lineKeywords(map, issues) {
  const table = (entries) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [normalWord(k), v === null ? null : [v].flat()]));
  const words = table(map.words ?? {}), rows = Object.fromEntries(Object.entries(map.rows ?? {}).map(([r, w]) => [Number(r) - 1, table(w)]));
  const all = [...Object.values(words), ...Object.values(rows).flatMap(Object.values), map.idle ?? []].flat().filter(Boolean);
  for (const name of all) if (!DRAWINGS[name]) issues.push(`unknown drawing "${name}"; run drawing_sheet.mjs to see the names`);
  for (const r of Object.keys(rows)) if (!lines[r]) issues.push(`drawings.json "rows" names row ${Number(r) + 1}, but there are only ${lines.length} rows`);
  if (!map.idle?.length) issues.push("drawings.json needs at least one idle drawing");
  if (issues.length) return null;
  const uses = {}, missing = [];
  const perLine = lines.map((line, row) => {
    const found = [];
    for (const word of line.words) {
      const key = normalWord(word.text), own = rows[row] && key in rows[row];
      const list = own ? rows[row][key] : words[key];
      if (!list) continue;
      const useKey = own ? `${row}:${key}` : key;
      found.push({ name: list[(uses[useKey] = (uses[useKey] ?? -1) + 1) % list.length], start: word.start });
    }
    if (!found.length) missing.push(row + 1);
    return found;
  });
  return { perLine, missing };
}

// Decide one drawing per beat. A keyword takes the beat nearest to when it is sung; other beats cycle through the
// line's own keywords, or the idle list between lines, so the picture changes on nearly every beat.
function buildRush(map, issues) {
  const found = lineKeywords(map, issues);
  if (!found) return;
  const slots = new Array(beats.length).fill(null), { missing } = found;
  lines.forEach((line, row) => {
    line.drawings = [];
    for (const word of found.perLine[row]) {
      const name = word.name;
      line.drawings.push(name);
      let i = lastAtOrBefore(beats, word.start, (b) => b.t);
      if (i < 0) i = 0;
      if (i + 1 < beats.length && beats[i + 1].t - word.start < word.start - beats[i].t) i++;
      if (slots[i] && i + 1 < beats.length && !slots[i + 1]) i++;
      if (!slots[i]) slots[i] = name;
    }
  });

  let idleAt = 0;
  const cursors = new Map();
  const pick = (list, previous, cursorKey) => {
    let at = cursors.get(cursorKey) ?? 0;
    for (let tries = 0; tries < list.length; tries++) {
      const name = list[at++ % list.length];
      if (name !== previous || tries === list.length - 1) { cursors.set(cursorKey, at); return name; }
    }
  };
  slots.forEach((slot, i) => {
    if (slot) return;
    const row = lastAtOrBefore(lines, beats[i].t, (l) => l.start), line = lines[row];
    const inLine = line && beats[i].t < line.hide && line.drawings.length;
    slots[i] = inLine ? pick(line.drawings, slots[i - 1], row) : pick(map.idle, slots[i - 1], "idle");
  });
  rush = { slots: slots.map((name) => DRAWINGS[name]), matches: new Map(), missing };
}

// Pair each point of one layer with the nearest starting point of the other, so outlines do not twist while morphing.
function matchOffset(a, b) {
  let best = 0, bestCost = Infinity;
  for (let shift = 0; shift < POINTS; shift += 4) {
    let cost = 0;
    for (let i = 0; i < POINTS; i += 8) {
      const q = b[(i + shift) % POINTS];
      cost += (a[i][0] - q[0]) ** 2 + (a[i][1] - q[1]) ** 2;
    }
    if (cost < bestCost) { bestCost = cost; best = shift; }
  }
  return best;
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Layers without a partner grow from, or shrink into, the centre of the matching layer's position.
function morphLayers(from, to, k, bg) {
  const out = [], count = Math.max(from.length, to.length);
  const centre = (points) => points.reduce((sum, p) => [sum[0] + p[0] / POINTS, sum[1] + p[1] / POINTS], [0, 0]);
  const shade = (colour) => hexRgb(colour === "bg" ? bg : colour);
  for (let n = 0; n < count; n++) {
    const a = from[n], b = to[n];
    const partnerA = a ?? { points: new Array(POINTS).fill(centre(b.points)), colour: b.colour };
    const partnerB = b ?? { points: new Array(POINTS).fill(centre(a.points)), colour: a.colour };
    const shift = a && b ? matchOffset(a.points, b.points) : 0;
    const rgbA = shade(partnerA.colour), rgbB = shade(partnerB.colour), c = clamp(k);
    out.push({
      points: partnerA.points.map((p, i) => {
        const q = partnerB.points[(i + shift) % POINTS];
        return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
      }),
      colour: `#${rgbA.map((v, i) => Math.round(v + (rgbB[i] - v) * c).toString(16).padStart(2, "0")).join("")}`,
    });
  }
  return out;
}

// Seeded per beat so every frame depends only on t.
const seeded = (seed, n) => { const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x); };

function drawRush(t, palette) {
  const i = Math.max(0, lastAtOrBefore(beats, t, (b) => b.t));
  const beat = beats[i], age = Math.max(0, t - beat.t);
  const period = beats[i + 1] ? beats[i + 1].t - beat.t : 0.5;
  const kick = kickAt(t), cx = W / 2, cy = (SAFE.top + GRAPHIC_BOTTOM) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(SAFE.left, SAFE.top, SAFE.right - SAFE.left, GRAPHIC_BOTTOM - SAFE.top); ctx.clip();

  // Speed lines streak outward from the centre after each beat.
  const travel = clamp(age / 0.45);
  ctx.strokeStyle = palette.accent;
  ctx.lineCap = "round";
  for (let n = 0; n < 34; n++) {
    const angle = seeded(i, n) * Math.PI * 2, near = (150 + seeded(i, n + 50) * 90 + travel * 420) * RUSH.reach, length = (30 + seeded(i, n + 90) * 90 * (1 - travel)) * RUSH.reach;
    ctx.globalAlpha = (1 - travel) ** 1.4 * 0.7 * (0.4 + 0.6 * beat.s);
    ctx.lineWidth = 2 + seeded(i, n + 130) * 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * near * RUSH.lineX, cy + Math.sin(angle) * near * RUSH.lineY);
    ctx.lineTo(cx + Math.cos(angle) * (near + length) * RUSH.lineX, cy + Math.sin(angle) * (near + length) * RUSH.lineY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Earlier drawings fly out to alternating sides, shrinking as they go.
  const push = 1 - (1 - clamp(age / Math.min(0.3, period))) ** 3;
  for (let back = 3; back >= 1; back--) {
    const k = i - back;
    if (k < 0) continue;
    const side = k % 2 ? -1 : 1, place = back - 1 + push;
    const size = song.vertical ? 120 - place * 22 : 92 - place * 16;
    if (size <= 0) continue;
    const up = k % 4 < 2 ? -1 : 1; // on a tall frame they fly towards the corners, because the sides are narrow
    const x = cx + side * (song.vertical ? 200 + place * 70 : 225 + place * 150);
    const y = cy + (song.vertical ? up * (240 + place * 30) : (k % 3 - 1) * 26);
    ctx.globalAlpha = clamp(1 - place / 3) * 0.85;
    paintLayers(ctx, rush.slots[k], x, y, size, palette.bg);
  }
  ctx.globalAlpha = 1;

  // The main drawing morphs on the beat, overshoots slightly and settles.
  const x = clamp(age / Math.min(0.34, period * 0.65)), eased = 1 + 1.7 * (x - 1) ** 3 + 0.7 * (x - 1) ** 2;
  const current = rush.slots[i], previous = rush.slots[Math.max(0, i - 1)];
  const layers = x >= 1 || previous === current ? current : morphLayers(previous, current, eased, palette.bg);
  const size = RUSH.hero * (1 + 0.07 * kick), spin = ((i % 2 ? 1 : -1) * 16 * (1 - x) ** 2 * Math.PI) / 180;
  ctx.translate(cx, cy); ctx.rotate(spin);
  paintLayers(ctx, layers, 0, 0, size, palette.bg);
  ctx.restore();
}

function drawWord(it, x0, t, palette) {
  const age = t - it.word.start;
  if (age < 0) return;
  const sung = t < it.word.end;
  const scale = slam(age), cx = x0, cy = it.baseline - it.ascent / 2;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
  ctx.textAlign = "center";
  if (palette.edge) { edgedText(it.word.text, x0, it.baseline, sung ? palette.accent : palette.ink, palette.edge, FONT_PX * 0.16); ctx.restore(); return; }
  ctx.fillStyle = "#000";
  ctx.fillText(it.word.text, x0 + SHADOW, it.baseline + SHADOW);
  ctx.fillStyle = sung ? palette.accent : "#ffffff";
  ctx.fillText(it.word.text, x0, it.baseline);
  ctx.restore();
}

// Karaoke verse screen: lines still to come are faint outlines, sung lines are dimmed, and the current line slams in
// word by word and kicks on the beat.
function ghostWord(it, palette, size, alpha) {
  ctx.save();
  if (palette.ghostEdge) { ctx.textAlign = "center"; edgedText(it.word.text, it.x + it.width / 2, it.baseline, palette.ghost, palette.ghostEdge, size * 0.1); ctx.restore(); return; }
  ctx.globalAlpha = palette.ghost ? 1 : song.overlay ? Math.min(1, alpha * 1.4) : alpha; ctx.textAlign = "center"; ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1.5, size * 0.03); ctx.strokeStyle = palette.ghost ?? palette.ink ?? "#ffffff";
  ctx.strokeText(it.word.text, it.x + it.width / 2, it.baseline);
  ctx.restore();
}
function dimWord(it, palette, alpha) {
  ctx.save();
  // Sung lines return to the upcoming style, so only the current line stands out.
  if (palette.ghostEdge) { ctx.textAlign = "center"; edgedText(it.word.text, it.x + it.width / 2, it.baseline, palette.ghost, palette.ghostEdge, FONT_PX * 0.1); ctx.restore(); return; }
  ctx.globalAlpha = palette.dim ? 1 : song.overlay ? Math.min(1, alpha * 1.4) : alpha; ctx.textAlign = "center"; ctx.fillStyle = palette.dim ?? palette.ink ?? "#ffffff";
  ctx.fillText(it.word.text, it.x + it.width / 2, it.baseline);
  ctx.restore();
}

// Rounded dark panel behind a verse screen, fading in as the screen appears.
function drawPanel(s, t) {
  if (!s.panel) {
    const pad = s.size * 0.45, b = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    for (const it of s.items) {
      b.l = Math.min(b.l, it.x); b.r = Math.max(b.r, it.x + it.width);
      b.t = Math.min(b.t, it.baseline - it.ascent); b.b = Math.max(b.b, it.baseline + it.descent);
    }
    const l = Math.max(SAFE.left - 24, b.l - pad * 1.6), r = Math.min(SAFE.right + 24, b.r + pad * 1.6);
    s.panel = { x: l, y: b.t - pad, w: r - l, h: b.b - b.t + pad * 2, radius: s.size * 0.5 };
  }
  const p = s.panel;
  ctx.save();
  ctx.globalAlpha = 0.72 * clamp((t - s.show) / 0.25);
  ctx.fillStyle = "#000000";
  ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, p.radius); ctx.fill();
  ctx.restore();
}

function drawVerse(t, palette) {
  const s = screens[lastAtOrBefore(screens, t, (x) => x.show)];
  if (!s || t >= s.hide) return;
  setFont(s.size);
  const current = s.rows.reduce((c, r, k) => (lines[r].start <= t ? k : c), -1);
  const close = clamp((s.hide - t) / 0.1), mid = centreOf(s.items), kick = kickAt(t);
  ctx.save();
  ctx.translate(0, mid); ctx.scale(1, close); ctx.translate(0, -mid);
  if (song.overlay && !song.noPanel) drawPanel(s, t);
  s.parts.forEach((items, k) => {
    if (k > current) { for (const it of items) ghostWord(it, palette, s.size, 0.45); return; }
    if (k < current) { for (const it of items) dimWord(it, palette, 0.5); return; }
    const cx = W / 2, cy = centreOf(items), m = 1 + KICK_SCALE * kick;
    ctx.save();
    ctx.translate(cx, cy - KICK_RISE * kick); ctx.scale(m, m); ctx.translate(-cx, -cy);
    if (song.style === "sketch") {
      let caret = null;
      for (const it of items) {
        if (t < it.word.end) ghostWord(it, palette, s.size, 0.35);
        const at = drawTypedWord(it, t, palette); if (at) caret = [at, it];
      }
      if (caret && t < lines[s.rows[k]].end + 0.3) drawCaret(caret[0], caret[1], t, palette, s.size);
    } else for (const it of items) {
      if (t < it.word.start) ghostWord(it, palette, s.size, 0.45); else drawWord(it, it.x + it.width / 2, t, palette);
    }
    ctx.restore();
  });
  ctx.restore();
}

function drawLyrics(t, palette) {
  if (screens) return drawVerse(t, palette);
  const kick = kickAt(t);
  for (const line of lines) {
    if (t < line.start || t >= line.hide) continue;
    const { layout } = line;
    setFont(layout.size);
    // The row snaps shut in the last moments before it hides.
    const close = clamp((line.hide - t) / 0.1);
    const k = 1 + KICK_SCALE * kick, cx = W / 2, cy = layout.cy;
    ctx.save();
    ctx.translate(cx, cy - KICK_RISE * kick); ctx.scale(k, k * (t >= line.end ? close : 1)); ctx.translate(-cx, -cy);
    if (song.style === "sketch") {
      // Typed in order; the caret follows the latest word until the line is sung.
      let caret = null;
      for (const it of layout.items) { const at = drawTypedWord(it, t, palette); if (at) caret = [at, it]; }
      if (caret && t < line.end + 0.3) drawCaret(caret[0], caret[1], t, palette, layout.size);
    } else for (const it of layout.items) drawWord(it, it.x + it.width / 2, t, palette);
    ctx.restore();
  }
}

function drawTitle(t, palette) {
  const first = lines[0].start;
  if (!song.title || t >= first) return;
  const kick = kickAt(t), k = 1 + KICK_SCALE * kick, cx = W / 2, cy = (BAND.top + BAND.bottom) / 2;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(k * slam(t), k * slam(t) * clamp((first - t) / 0.12)); ctx.translate(-cx, -cy);
  ctx.textAlign = "center";
  setFont(86);
  ctx.fillStyle = palette.shadow ?? "#000"; ctx.fillText(song.title, cx + SHADOW, cy + 20 + SHADOW);
  ctx.fillStyle = palette.ink ?? "#ffffff"; ctx.fillText(song.title, cx, cy + 20);
  if (song.artist) {
    setFont(34);
    ctx.fillStyle = palette.accent; ctx.fillText(song.artist, cx, cy + 78);
  }
  if (song.greeting) {
    // Typed under the title, after the title has landed.
    const typed = typedAt(song.greeting, t, 1.2);
    if (typed) {
      setFont(50);
      const left = cx - ctx.measureText(song.greeting).width / 2, y = cy + (song.artist ? 140 : 92);
      ctx.textAlign = "left";
      ctx.fillStyle = palette.shadow ?? "#000"; ctx.fillText(typed.text, left + 3, y + 3);
      ctx.fillStyle = palette.accent; ctx.fillText(typed.text, left, y);
    }
  }
  ctx.restore();
}

function drawGuides() {
  ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
  ctx.strokeRect(SAFE.left, SAFE.top, SAFE.right - SAFE.left, SAFE.bottom - SAFE.top);
  ctx.setLineDash([]);
}

window.frame = (t, type, quality, guides = false) => {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1;
  const palette = drawBackground(t);
  if (song.green || song.overlay) {} else if (sketch) { drawEndConfetti(t); drawSketch(t, palette); } else if (rush) drawRush(t, palette); else drawGraphics(t, palette);
  if (!song.green && !song.overlay) drawTitle(t, palette);
  drawLyrics(t, palette);
  if (sketch) drawEndCard(t, palette);
  if (guides) drawGuides();
  return canvas.toDataURL(type, quality).split(",")[1];
};
