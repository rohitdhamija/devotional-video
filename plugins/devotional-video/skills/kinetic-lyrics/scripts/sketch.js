// Sketchbook style (--style sketch): pastel paper, drawings traced by a pencil as their keyword is sung and then
// coloured in, and lyrics typed out syllable by syllable. Loaded before scene.js and called from it; every frame
// still depends only on t.
const SKETCH_PALETTES = [
  { bg: "#fff4dc", ink: "#2d2a4a", accent: "#f0532c", shadow: "#efd9b0", dots: "#e9d3a6" },
  { bg: "#e6f6ec", ink: "#1e3a4c", accent: "#13956c", shadow: "#c6e6d2", dots: "#c1e0cc" },
  { bg: "#e9f1ff", ink: "#24305a", accent: "#3463e0", shadow: "#cddcf6", dots: "#c9d8f3" },
  { bg: "#ffeef4", ink: "#4a2340", accent: "#d6336f", shadow: "#f3d0dd", dots: "#efcbd8" },
];
const TRACE = 0.9, COLOUR = 0.4, EXIT = 0.28, LEAD = 0.15;
const MAX_SLOTS = 4;
// Drawing half-size and spacing by how many drawings share a line.
const SLOT_LAYOUT = { 1: [138, 0], 2: [128, 250], 3: [118, 380], 4: [104, 280] };
let sketch;

const outlineLength = (points) => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
}, 0);

// One placed drawing: when it starts being traced, where it sits and when it leaves.
function sketchItem(name, start, hide, slot, count) {
  const layers = DRAWINGS[name];
  const lengths = layers.map((l) => outlineLength(l.points));
  return { name, layers, lengths, total: lengths.reduce((a, b) => a + b, 0), start, hide, slot, count };
}

function buildSketch(map) {
  const { perLine, idle } = map;
  const items = [];
  // Drawings stay up through short pauses, so the picture does not blink off between lines.
  const hides = lines.map((line, row) => {
    const next = lines[row + 1];
    return next && next.start - line.hide < 3 ? next.start : line.hide;
  });
  lines.forEach((line, row) => {
    let picks = perLine[row].filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i).slice(0, MAX_SLOTS);
    if (!picks.length) picks = [{ name: idle[row % idle.length], start: line.start }];
    picks.forEach((p, i) => items.push(sketchItem(p.name, Math.max(line.start, p.start) - LEAD, hides[row], i, picks.length)));
  });
  // A group drawn side by side, each one starting a little after the last.
  const group = (names, from, to) => names.slice(0, MAX_SLOTS).forEach((name, i) => items.push(sketchItem(name, from + i * 0.6, to, i, Math.min(names.length, MAX_SLOTS))));
  const first = lines[0].start - LEAD, last = hides[lines.length - 1] + EXIT;
  if (map.intro?.length && first >= 2) group(map.intro, 0.3, first - EXIT);
  // The end scene starts once the last line has gone and holds to the final frame.
  sketch = { items, outroStart: map.outro?.length ? last : null };
  if (map.outro?.length) group(map.outro, last + 0.1, song.duration + 1);
  // Gaps of 2 seconds or more cycle through idle drawings, a new one about every 4 seconds.
  const gaps = lines.map((line, row) => [hides[row] + EXIT, lines[row + 1] ? lines[row + 1].start - LEAD : song.duration + 1]);
  if (!map.intro?.length) gaps.unshift([0, first]);
  if (map.outro?.length) gaps.pop();
  let cursor = 0;
  for (const [from, to] of gaps) {
    if (to - from < 2) continue;
    const count = Math.max(1, Math.round((to - from) / 4)), step = (to - from) / count;
    for (let n = 0; n < count; n++) items.push(sketchItem(idle[cursor++ % idle.length], from + n * step + 0.15, from + (n + 1) * step - EXIT, 0, 1));
  }
}

// Positions in the graphic area. The tall Shorts frame stacks a third and fourth drawing on a second row.
function slotPlace(item) {
  const cy = (SAFE.top + GRAPHIC_BOTTOM) / 2;
  if (song.vertical) {
    const size = { 1: 250, 2: 190, 3: 165, 4: 165 }[item.count] * ART_SCALE;
    if (item.count <= 2) return { x: W / 2 + (item.slot - (item.count - 1) / 2) * 420, y: cy, size };
    const top = item.slot < 2, inRow = top ? 2 : item.count - 2, k = top ? item.slot : item.slot - 2;
    return { x: W / 2 + (k - (inRow - 1) / 2) * 400, y: cy + (top ? -190 : 190) * ART_SCALE, size };
  }
  const [size, gap] = SLOT_LAYOUT[item.count];
  return { x: W / 2 + (item.slot - (item.count - 1) / 2) * gap, y: cy, size: size * ART_SCALE };
}

function pathOf(points, x, y, size, upTo = points.length) {
  ctx.beginPath();
  for (let i = 0; i <= upTo && i <= points.length; i++) {
    const [px, py] = points[i % points.length];
    if (i) ctx.lineTo(x + px * size, y + py * size); else ctx.moveTo(x + px * size, y + py * size);
  }
}

// A small pencil whose tip sits on (x, y), leaning to the upper right.
function drawPencil(x, y, ink) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-Math.PI / 4);
  ctx.lineWidth = 2.5; ctx.strokeStyle = ink; ctx.lineJoin = "round";
  const shape = (pts, fill) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
  shape([[0, 0], [22, -8], [22, 8]], "#f3d2a2");
  shape([[0, 0], [7, -2.6], [7, 2.6]], ink);
  shape([[22, -8], [92, -8], [92, 8], [22, 8]], "#ffcf33");
  shape([[92, -8], [102, -8], [102, 8], [92, 8]], "#c7d0d9");
  shape([[102, -8], [114, -8], [118, -4], [118, 4], [114, 8], [102, 8]], "#ff8fb1");
  ctx.restore();
}

function drawSketchItem(item, t, palette, kick, beatIndex) {
  const age = t - item.start;
  if (age < 0 || t >= item.hide + EXIT) return;
  const place = slotPlace(item);
  const leave = clamp((t - item.hide) / EXIT);
  const traced = clamp(age / TRACE), coloured = clamp((age - TRACE) / COLOUR);
  // Once finished, the drawing bounces on the beat, tilting a little the other way each time.
  const done = coloured >= 1 ? 1 : 0;
  const tilt = done * (beatIndex % 2 ? 1 : -1) * 0.035 * kick;
  const scale = (1 + done * 0.05 * kick) * (1 - leave) ** 1.5;
  if (scale <= 0.03) return;
  const size = place.size * scale, x = place.x, y = place.y;
  const ink = palette.ink, width = Math.max(2.5, place.size * 0.03) * Math.min(1, scale * 1.5);
  ctx.save();
  ctx.globalAlpha = 1 - leave;
  ctx.translate(x, y); ctx.rotate(tilt); ctx.translate(-x, -y);
  ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = width; ctx.strokeStyle = ink;

  const paintColoured = () => {
    for (const layer of item.layers) {
      ctx.fillStyle = layer.colour === "bg" ? palette.bg : layer.colour;
      pathOf(layer.points, x, y, size); ctx.closePath(); ctx.fill();
      if (layer.colour !== "bg") ctx.stroke();
    }
  };
  if (coloured > 0) {
    // Crayon colour sweeps across from the left; the right part still shows the bare outline.
    const left = x - size * 1.05, edge = left + size * 2.1 * (1 - (1 - coloured) ** 2);
    for (const layer of item.layers) { pathOf(layer.points, x, y, size); ctx.closePath(); ctx.stroke(); }
    ctx.save(); ctx.beginPath(); ctx.rect(left - 40, y - size * 1.2, edge - left + 40, size * 2.4); ctx.clip();
    paintColoured();
    ctx.restore();
  } else {
    // The pencil walks along each outline in turn, at an even speed across the whole drawing.
    let remaining = traced * item.total, tip = null;
    for (let n = 0; n < item.layers.length && remaining > 0; n++) {
      const { points } = item.layers[n], length = item.lengths[n];
      const share = Math.min(1, remaining / length), upTo = Math.floor(share * points.length);
      pathOf(points, x, y, size, upTo); if (share >= 1) ctx.closePath(); ctx.stroke();
      remaining -= length;
      const p = points[Math.min(upTo, points.length - 1)];
      tip = [x + p[0] * size, y + p[1] * size];
    }
    if (tip && traced < 1) drawPencil(tip[0], tip[1], ink);
  }
  ctx.restore();
}

function drawSketch(t, palette) {
  const kick = kickAt(t), beatIndex = Math.max(0, lastAtOrBefore(beats, t, (b) => b.t));
  ctx.save();
  ctx.beginPath(); ctx.rect(SAFE.left, SAFE.top, SAFE.right - SAFE.left, GRAPHIC_BOTTOM - SAFE.top); ctx.clip();
  for (const item of sketch.items) drawSketchItem(item, t, palette, kick, beatIndex);
  ctx.restore();
}

// Faint dotted grid like a drawing book, kept above the bottom strip that holds only the background colour.
function drawPaper(palette) {
  ctx.fillStyle = palette.dots;
  for (let y = SAFE.top; y <= SAFE.bottom - 10; y += 36) {
    for (let x = 40; x < W - 20; x += 36) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
  }
}

// Grapheme clusters, so conjuncts and matras are always typed together.
const clusters = (text) => [...new Intl.Segmenter("hi", { granularity: "grapheme" }).segment(text)].map((s) => s.segment);

function typedWord(word, t) {
  const parts = word.parts ?? (word.parts = clusters(word.text));
  const duration = clamp(word.end - word.start, 0.15, 0.5);
  const count = Math.max(1, Math.ceil(parts.length * clamp((t - word.start) / duration)));
  return { text: parts.slice(0, count).join(""), done: count >= parts.length };
}

function drawTypedWord(it, t, palette, caret) {
  if (t < it.word.start) return null;
  const { text, done } = typedWord(it.word, t);
  const sung = t < it.word.end;
  ctx.textAlign = "left";
  ctx.fillStyle = palette.shadow;
  ctx.fillText(text, it.x + SHADOW * 0.6, it.baseline + SHADOW * 0.6);
  ctx.fillStyle = sung ? palette.accent : palette.ink;
  ctx.fillText(text, it.x, it.baseline);
  return { x: it.x + ctx.measureText(text).width, done };
}

function drawCaret(at, it, t, palette, size) {
  // Solid while typing, blinking once the word is complete.
  if (at.done && Math.floor(t * 3) % 2) return;
  ctx.fillStyle = palette.accent;
  ctx.fillRect(at.x + size * 0.05, it.baseline - it.ascent, Math.max(4, size * 0.06), it.ascent + it.descent * 0.4);
}

// Typed text for title-card lines that are not sung: one grapheme every `pace` seconds from `from`.
function typedAt(text, t, from, pace = 0.06) {
  const parts = clusters(text), count = Math.floor((t - from) / pace) + 1;
  return count <= 0 ? null : { text: parts.slice(0, count).join(""), done: count >= parts.length };
}

// The end scene: one or two typed rows in the lyric band, with confetti once the drawings are coloured in.
function drawEndCard(t, palette) {
  if (sketch.outroStart === null || t < sketch.outroStart || !song.endText) return;
  const [main, second] = song.endText.split("|");
  const begin = sketch.outroStart + 0.4, cy = (BAND.top + BAND.bottom - SHADOW) / 2;
  const rows = [[main, END_SIZES[0], palette.ink, begin], ...(second ? [[second, END_SIZES[1], palette.accent, begin + clusters(main).length * 0.06 + 0.3]] : [])];
  const gapY = second ? END_SIZES[0] * 0.75 : 0;
  rows.forEach(([text, size, colour, from], i) => {
    const typed = typedAt(text, t, from);
    if (!typed) return;
    setFont(size);
    const full = ctx.measureText(text).width, left = W / 2 - full / 2, y = cy + (i ? gapY : second ? -gapY * 0.35 : size * 0.35);
    ctx.textAlign = "left";
    ctx.fillStyle = palette.shadow; ctx.fillText(typed.text, left + SHADOW * 0.6, y + SHADOW * 0.6);
    ctx.fillStyle = colour; ctx.fillText(typed.text, left, y);
  });
}

// Confetti for the end scene, drawn under the drawings and text, once the drawings are coloured in.
function drawEndConfetti(t) {
  if (sketch.outroStart !== null && song.endText) drawConfetti(t - (sketch.outroStart + 2.2));
}
const END_SIZES = [84, 56];

// Paper confetti falling with a gentle sway; seeded, so each frame depends only on t. Kept inside the safe area.
function drawConfetti(age) {
  if (age < 0) return;
  const colours = ["#f0532c", "#ffcf33", "#2fd6c3", "#4aa8ff", "#ff5d8f", "#56c95a", "#a66cff"];
  ctx.save();
  ctx.beginPath(); ctx.rect(SAFE.left, SAFE.top, SAFE.right - SAFE.left, SAFE.bottom - SAFE.top); ctx.clip();
  for (let n = 0; n < 140; n++) {
    const delay = seeded(n, 1) * 1.6, a = age - delay;
    if (a < 0) continue;
    // Each piece starts again at the top after it falls out, so the confetti keeps going to the last frame.
    const speed = (110 + seeded(n, 2) * 120) * (H / 720), fall = SAFE.bottom - SAFE.top + 80;
    const y = SAFE.top - 30 + ((a * speed) % fall), x = SAFE.left + seeded(n, 3) * (SAFE.right - SAFE.left) + Math.sin(a * 2.4 + n) * 26;
    const w = (10 + seeded(n, 4) * 8) * (H / 720), h = w * 0.55;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a * (2 + seeded(n, 5) * 4) + n);
    ctx.scale(1, Math.cos(a * 5 + n)); // flips like paper
    ctx.fillStyle = colours[n % colours.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
}

// Checks that end-card rows fit the frame at their fixed sizes.
function endCardIssues() {
  if (!song.endText) return [];
  return song.endText.split("|").slice(0, 2).flatMap((text, i) => {
    setFont(END_SIZES[i]);
    return ctx.measureText(text).width + SHADOW > SAFE.right - SAFE.left ? [`end text row ${i + 1} is too wide: "${text}"`] : [];
  });
}
