// Original vector drawings for lyric keywords. Each drawing is a list of layers: closed outlines of POINTS points
// plus a colour, in a box from -1 to 1 with y pointing down. A fixed point count lets any drawing morph into any other.
const POINTS = 160;

function resample(outline) {
  const lengths = outline.map((p, i) => Math.hypot(outline[(i + 1) % outline.length][0] - p[0], outline[(i + 1) % outline.length][1] - p[1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out = [];
  let segment = 0, walked = 0;
  for (let i = 0; i < POINTS; i++) {
    const target = (i / POINTS) * total;
    while (walked + lengths[segment] < target && segment < outline.length - 1) walked += lengths[segment++];
    const k = lengths[segment] ? (target - walked) / lengths[segment] : 0;
    const a = outline[segment], b = outline[(segment + 1) % outline.length];
    out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
  }
  // Same winding everywhere, so morphs do not turn shapes inside out.
  const area = out.reduce((sum, p, i) => { const q = out[(i + 1) % POINTS]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
  return area < 0 ? out.reverse() : out;
}

const polar = (cx, cy, radius) => Array.from({ length: 240 }, (_, i) => {
  const a = (i / 240) * Math.PI * 2, r = radius(a);
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});
const circle = (cx, cy, r) => polar(cx, cy, () => r);
const ellipse = (cx, cy, rx, ry) => circle(0, 0, 1).map(([x, y]) => [cx + x * rx, cy + y * ry]);
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
function rounded(x, y, w, h, r) {
  const out = [];
  for (const [cx, cy, start] of [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]]) {
    for (let d = 0; d <= 90; d += 15) out.push([cx + Math.cos(((start + d) * Math.PI) / 180) * r, cy + Math.sin(((start + d) * Math.PI) / 180) * r]);
  }
  return out;
}
function star(cx, cy, outer, inner, tips, turn = -90) {
  return Array.from({ length: tips * 2 }, (_, i) => {
    const a = ((turn + (i * 180) / tips) * Math.PI) / 180, r = i % 2 ? inner : outer;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}
function line(x1, y1, x2, y2, width) {
  const d = Math.hypot(x2 - x1, y2 - y1) || 1, nx = ((y2 - y1) / d) * (width / 2), ny = ((x1 - x2) / d) * (width / 2);
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
}
function arc(cx, cy, r, width, from, to) {
  const steps = 48, outer = [], inner = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    outer.push([cx + Math.cos(a) * (r + width / 2), cy + Math.sin(a) * (r + width / 2)]);
    inner.unshift([cx + Math.cos(a) * (r - width / 2), cy + Math.sin(a) * (r - width / 2)]);
  }
  return [...outer, ...inner];
}
// Closed Catmull-Rom curve through the given points.
function curve(points) {
  const out = [], n = points.length;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]];
    for (let s = 0; s < 12; s++) {
      const t = s / 12, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  return out;
}
const teardrop = (cx, cy, w, h) => [[cx, cy - h / 2], ...curve([[cx, cy - h / 2], [cx + w * 0.3, cy - h * 0.12], [cx + w / 2, cy + h * 0.2], [cx, cy + h / 2], [cx - w / 2, cy + h * 0.2], [cx - w * 0.3, cy - h * 0.12]]).slice(1)];
const turned = (shape, degrees, cx = 0, cy = 0) => {
  const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return shape.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
};
const heartShape = (cx, cy, size) => Array.from({ length: 240 }, (_, i) => {
  const t = (i / 240) * Math.PI * 2;
  return [cx + (size * (16 * Math.sin(t) ** 3)) / 17, cy + (-size * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 17];
});

const C = {
  flame: "#ff8f1f", yellow: "#ffd93b", pale: "#fff3b0", red: "#ef3e3e", white: "#ffffff", cream: "#ffe9c4", gold: "#f2b632", clay: "#c9632b", brown: "#7c4a24",
  pink: "#ff5d8f", magenta: "#d63aa8", teal: "#2fd6c3", blue: "#4aa8ff", green: "#56c95a", leaf: "#2e9e4f", purple: "#a66cff", silver: "#c7d0d9", dark: "#2a2230", bg: "bg",
  skin: "#f6c39b", hair: "#4a2c1d", mint: "#bfe8a0", sky: "#9fd3ff", grey: "#8a94a6",
};

// Moves and scales a list of layers, for drawings built from other drawings.
const placed = (layers, dx, dy, s) => layers.map(([outline, colour]) => [outline.map(([x, y]) => [dx + x * s, dy + y * s]), colour]);
const kidLayers = (shirt = C.teal, shorts = C.blue) => [
  [line(-0.17, 0.4, -0.27, 0.88, 0.15), C.skin], [line(0.17, 0.4, 0.27, 0.88, 0.15), C.skin],
  [ellipse(-0.31, 0.91, 0.15, 0.07), C.dark], [ellipse(0.31, 0.91, 0.15, 0.07), C.dark],
  [line(-0.27, -0.02, -0.72, -0.54, 0.13), C.skin], [line(0.27, -0.02, 0.72, -0.54, 0.13), C.skin],
  [circle(-0.75, -0.58, 0.1), C.skin], [circle(0.75, -0.58, 0.1), C.skin],
  [rounded(-0.33, -0.14, 0.66, 0.6, 0.16), shirt], [rect(-0.33, 0.32, 0.66, 0.2), shorts],
  [circle(0, -0.46, 0.3), C.skin],
  [curve([[-0.31, -0.46], [-0.3, -0.72], [0, -0.84], [0.3, -0.72], [0.31, -0.46], [0.18, -0.62], [-0.05, -0.6], [-0.2, -0.64]]), C.hair],
  [circle(-0.11, -0.44, 0.04), C.dark], [circle(0.11, -0.44, 0.04), C.dark],
  [arc(0, -0.38, 0.13, 0.045, 25, 155), C.dark],
  [ellipse(-0.2, -0.33, 0.06, 0.035), C.pink], [ellipse(0.2, -0.33, 0.06, 0.035), C.pink],
];
const face = (colour) => [[circle(0, 0, 0.9), colour], [circle(-0.32, -0.2, 0.09), C.dark], [circle(0.32, -0.2, 0.09), C.dark]];
const halfPill = (cx, len, r) => [...Array.from({ length: 25 }, (_, i) => {
  const a = ((90 + i * 7.5) * Math.PI) / 180;
  return [cx - len + r + Math.cos(a) * r, Math.sin(a) * r];
}), [cx, -r], [cx, r]];

const DRAWING_SOURCES = {
  diya: [
    [teardrop(0, -0.42, 0.72, 1.1), C.flame], [teardrop(0, -0.3, 0.42, 0.72), C.yellow], [teardrop(0, -0.2, 0.18, 0.36), C.pale],
    [curve([[-0.95, 0.12], [0, 0.2], [0.95, 0.12], [0.6, 0.72], [0, 0.85], [-0.6, 0.72]]), C.clay],
    [ellipse(0, 0.14, 0.92, 0.12), C.gold],
    [line(-0.45, 0.48, 0.45, 0.48, 0.07), C.gold],
  ],
  candle: [
    [teardrop(0, -0.66, 0.42, 0.62), C.flame], [teardrop(0, -0.58, 0.2, 0.34), C.yellow], [line(0, -0.34, 0, -0.18, 0.05), C.dark],
    [rounded(-0.28, -0.2, 0.56, 0.98, 0.06), C.pink],
    [curve([[-0.28, -0.2], [0.28, -0.2], [0.28, 0.2], [0.14, 0.12], [0.04, 0.32], [-0.1, 0.1], [-0.2, 0.26], [-0.28, 0.08]]), C.cream],
    [ellipse(0, 0.8, 0.62, 0.13), C.gold],
  ],
  firecracker: [
    [turned(star(0.62, -0.72, 0.3, 0.1, 8), 0), C.yellow], [circle(0.62, -0.72, 0.06), C.white],
    [arc(0.26, -0.72, 0.36, 0.05, 90, 180), C.silver],
    [turned(rounded(-0.32, -0.42, 0.64, 1.3, 0.05), 28, 0, 0.2), C.red],
    [turned(rect(-0.32, -0.2, 0.64, 0.14), 28, 0, 0.2), C.gold],
    [turned(rect(-0.32, 0.5, 0.64, 0.14), 28, 0, 0.2), C.gold],
    [turned(star(0, 0.15, 0.2, 0.09, 5), 28, 0, 0.15), C.yellow],
  ],
  rocket: [
    [teardrop(0, 0.72, 0.5, 0.56).map(([x, y]) => [x, 1.44 - y]), C.flame],
    [curve([[-0.32, 0.6], [-0.75, 0.82], [-0.72, 0.28], [-0.25, 0.1]]), C.red], [curve([[0.32, 0.6], [0.75, 0.82], [0.72, 0.28], [0.25, 0.1]]), C.red],
    [curve([[0, -0.98], [0.34, -0.45], [0.38, 0.2], [0.26, 0.62], [-0.26, 0.62], [-0.38, 0.2], [-0.34, -0.45]]), C.cream],
    [curve([[0, -0.98], [0.26, -0.56], [0, -0.48], [-0.26, -0.56]]), C.red],
    [circle(0, -0.1, 0.17), C.gold], [circle(0, -0.1, 0.11), C.blue],
  ],
  burst: [
    [star(0, 0, 0.98, 0.42, 16), C.gold], [star(0, 0, 0.72, 0.3, 12, -75), C.red], [star(0, 0, 0.46, 0.2, 8), C.yellow], [circle(0, 0, 0.14), C.white],
  ],
  sparkler: [
    [line(-0.8, 0.85, 0.22, -0.22, 0.05), C.silver],
    [star(0.3, -0.3, 0.68, 0.14, 14), C.gold], [star(0.3, -0.3, 0.42, 0.1, 10, -70), C.yellow], [circle(0.3, -0.3, 0.09), C.white],
  ],
  sun: [[star(0, 0, 0.98, 0.66, 14), C.flame], [circle(0, 0, 0.58), C.yellow], [circle(-0.14, -0.14, 0.2), C.pale]],
  star: [[star(0, 0.04, 1, 0.42, 5), C.gold], [star(0, 0.04, 0.6, 0.25, 5), C.yellow]],
  moon: [
    [circle(-0.12, 0, 0.82), C.cream], [circle(0.26, -0.14, 0.72), C.bg],
    [star(0.56, -0.5, 0.26, 0.08, 4), C.yellow], [star(0.72, 0.2, 0.16, 0.05, 4), C.white],
  ],
  heart: [[heartShape(0, 0, 0.98), C.red], [turned(ellipse(-0.42, -0.36, 0.2, 0.11), -40, -0.42, -0.36), C.pink]],
  smile: [
    [circle(0, 0, 0.94), C.yellow], [ellipse(-0.33, -0.25, 0.11, 0.17), C.dark], [ellipse(0.33, -0.25, 0.11, 0.17), C.dark],
    [arc(0, 0, 0.58, 0.12, 20, 160), C.dark],
  ],
  gift: [
    [curve([[0, -0.52], [-0.28, -0.98], [-0.66, -0.82], [-0.46, -0.52]]), C.yellow], [curve([[0, -0.52], [0.28, -0.98], [0.66, -0.82], [0.46, -0.52]]), C.yellow],
    [rect(-0.76, -0.14, 1.52, 1.06), C.red], [rect(-0.88, -0.52, 1.76, 0.42), C.pink],
    [rect(-0.13, -0.52, 0.26, 1.44), C.yellow],
  ],
  house: [
    [rect(-0.7, -0.08, 1.4, 1), C.cream], [[[-0.98, 0.02], [0, -0.92], [0.98, 0.02]], C.red],
    [rounded(-0.2, 0.34, 0.4, 0.58, 0.05), C.brown], [rect(-0.56, 0.2, 0.24, 0.26), C.blue], [rect(0.32, 0.2, 0.24, 0.26), C.blue],
    [teardrop(0, -0.32, 0.2, 0.3), C.flame],
  ],
  lights: [
    [arc(0, -1.75, 1.82, 0.04, 58, 122), C.silver],
    ...[[-0.82, C.red], [-0.41, C.yellow], [0, C.teal], [0.41, C.pink], [0.82, C.green]].map(([x, colour]) => {
      const y = -1.75 + Math.sqrt(1.82 ** 2 - x ** 2);
      return [teardrop(x, y + 0.34, 0.34, 0.62).map(([px, py]) => [px, 2 * (y + 0.34) - py]), colour];
    }),
  ],
  toran: [
    [rect(-0.98, -0.82, 1.96, 0.1), C.red],
    ...[-0.8, -0.27, 0.27, 0.8].map((x) => [teardrop(x, -0.08, 0.36, 1.04).map(([px, py]) => [px, -0.16 - py]), C.leaf]),
    ...[-0.8, -0.27, 0.27, 0.8].map((x) => [circle(x, 0.6, 0.2), C.flame]),
    ...[-0.53, 0, 0.53].map((x) => [circle(x, -0.5, 0.2), C.yellow]),
  ],
  flower: [
    [polar(0, 0, (a) => 0.62 + 0.36 * Math.cos(6 * a)), C.pink], [polar(0, 0, (a) => 0.38 + 0.18 * Math.cos(6 * a + Math.PI)), C.magenta], [circle(0, 0, 0.2), C.yellow],
  ],
  lotus: [
    [turned(teardrop(0, -0.08, 0.5, 1.2), -68, 0, 0.5), C.magenta], [turned(teardrop(0, -0.08, 0.5, 1.2), 68, 0, 0.5), C.magenta],
    [turned(teardrop(0, -0.14, 0.56, 1.28), -34, 0, 0.5), C.pink], [turned(teardrop(0, -0.14, 0.56, 1.28), 34, 0, 0.5), C.pink],
    [teardrop(0, -0.2, 0.6, 1.4), "#ff9ab8"],
    [ellipse(0, 0.72, 0.8, 0.13), C.teal],
  ],
  rangoli: [
    [polar(0, 0, (a) => 0.72 + 0.26 * Math.cos(8 * a)), C.magenta], [star(0, 0, 0.74, 0.46, 8, -67.5), C.yellow],
    [polar(0, 0, (a) => 0.42 + 0.14 * Math.cos(8 * a)), C.teal], [star(0, 0, 0.3, 0.15, 8), C.flame], [circle(0, 0, 0.1), C.white],
  ],
  laddu: [
    [ellipse(0, 0.74, 0.98, 0.18), C.silver],
    [circle(-0.56, 0.38, 0.32), C.flame], [circle(0, 0.38, 0.32), C.gold], [circle(0.56, 0.38, 0.32), C.flame],
    [circle(-0.28, -0.13, 0.32), C.gold], [circle(0.28, -0.13, 0.32), C.flame], [circle(0, -0.64, 0.32), C.gold],
  ],
  kurta: [
    [[[-0.34, -0.9], [0.34, -0.9], [0.92, -0.42], [0.72, -0.1], [0.42, -0.34], [0.5, 0.95], [-0.5, 0.95], [-0.42, -0.34], [-0.72, -0.1], [-0.92, -0.42]], C.teal],
    [arc(0, -0.92, 0.2, 0.1, 10, 170), C.gold], [rect(-0.05, -0.72, 0.1, 0.72), C.gold], [rect(-0.5, 0.74, 1, 0.09), C.gold],
  ],
  glasses: [
    [rect(-0.98, -0.18, 1.96, 0.1), C.white], [rounded(-0.92, -0.2, 0.82, 0.62, 0.22), C.magenta], [rounded(0.1, -0.2, 0.82, 0.62, 0.22), C.magenta],
    [line(-0.74, 0.22, -0.4, -0.08, 0.08), C.white], [line(0.28, 0.22, 0.62, -0.08, 0.08), C.white],
  ],
  bell: [
    [circle(0, -0.82, 0.13), C.gold], [circle(0, 0.74, 0.19), C.flame],
    [curve([[0, -0.76], [0.42, -0.52], [0.52, 0], [0.92, 0.6], [0, 0.68], [-0.92, 0.6], [-0.52, 0], [-0.42, -0.52]]), C.yellow],
    [line(-0.26, -0.34, -0.36, 0.2, 0.08), C.pale],
  ],
  note: [
    [turned(ellipse(-0.52, 0.66, 0.3, 0.22), -18, -0.52, 0.66), C.teal], [turned(ellipse(0.5, 0.42, 0.3, 0.22), -18, 0.5, 0.42), C.teal],
    [rect(-0.28, -0.78, 0.1, 1.42), C.teal], [rect(0.74, -0.98, 0.1, 1.42), C.teal], [[[-0.28, -0.78], [0.84, -0.98], [0.84, -0.66], [-0.28, -0.46]], C.yellow],
  ],
  mic: [
    [rounded(-0.34, -0.98, 0.68, 1.12, 0.33), C.silver], [line(-0.34, -0.5, 0.34, -0.5, 0.05), C.dark], [line(-0.34, -0.24, 0.34, -0.24, 0.05), C.dark],
    [arc(0, -0.2, 0.56, 0.09, 0, 180), C.gold], [rect(-0.05, 0.36, 0.1, 0.46), C.gold], [rounded(-0.42, 0.78, 0.84, 0.16, 0.07), C.gold],
  ],
  speaker: [
    [rounded(-0.72, -0.98, 1.44, 1.96, 0.12), C.purple], [circle(0, -0.56, 0.22), C.dark], [circle(0, -0.56, 0.09), C.silver],
    [circle(0, 0.32, 0.56), C.dark], [circle(0, 0.32, 0.4), C.silver], [circle(0, 0.32, 0.18), C.dark],
  ],
  envelope: [
    [rect(-0.96, -0.62, 1.92, 1.26), C.cream], [[[-0.96, 0.64], [0, -0.1], [0.96, 0.64]], "#f4d7a8"],
    [[[-0.96, -0.62], [0.96, -0.62], [0, 0.18]], C.gold], [heartShape(0, 0.06, 0.2), C.red],
  ],
  book: [
    [curve([[-0.98, -0.7], [-0.5, -0.82], [0, -0.66], [0, 0.82], [-0.5, 0.66], [-0.98, 0.78]]), C.cream],
    [curve([[0.98, -0.7], [0.5, -0.82], [0, -0.66], [0, 0.82], [0.5, 0.66], [0.98, 0.78]]), C.white],
    [rect(-0.03, -0.68, 0.06, 1.5), C.red],
    [line(-0.78, -0.4, -0.22, -0.4, 0.05), C.brown], [line(-0.78, -0.14, -0.22, -0.14, 0.05), C.brown], [line(0.22, -0.4, 0.78, -0.4, 0.05), C.brown], [line(0.22, -0.14, 0.78, -0.14, 0.05), C.brown],
  ],
  bulb: [
    [curve([[0, -0.98], [0.56, -0.74], [0.68, -0.2], [0.34, 0.26], [0.26, 0.5], [-0.26, 0.5], [-0.34, 0.26], [-0.68, -0.2], [-0.56, -0.74]]), C.yellow],
    [curve([[0, -0.72], [0.28, -0.56], [0.28, -0.18], [0, 0], [-0.28, -0.18], [-0.28, -0.56]]), C.pale],
    [rounded(-0.28, 0.5, 0.56, 0.14, 0.05), C.silver], [rounded(-0.24, 0.68, 0.48, 0.14, 0.05), C.silver], [rounded(-0.14, 0.84, 0.28, 0.12, 0.05), C.dark],
  ],
  speech: [
    [[[-0.5, 0.3], [-0.1, 0.3], [-0.62, 0.95]], C.white], [rounded(-0.98, -0.8, 1.96, 1.3, 0.3), C.white],
    [circle(-0.45, -0.15, 0.12), C.blue], [circle(0, -0.15, 0.12), C.blue], [circle(0.45, -0.15, 0.12), C.blue],
  ],
  globe: [
    [circle(0, 0, 0.96), C.blue],
    [curve([[-0.62, -0.62], [-0.15, -0.72], [0, -0.42], [-0.28, -0.14], [-0.2, 0.2], [-0.5, 0.1], [-0.82, -0.2]]), C.green],
    [curve([[0.28, -0.3], [0.72, -0.48], [0.88, -0.04], [0.6, 0.18], [0.54, 0.56], [0.26, 0.42], [0.14, 0]]), C.green],
    [curve([[-0.24, 0.5], [0.04, 0.48], [0.06, 0.74], [-0.14, 0.86]]), C.green],
  ],
  sprout: [
    [curve([[-0.82, 0.62], [0, 0.48], [0.82, 0.62], [0.6, 0.96], [-0.6, 0.96]]), C.brown],
    [rect(-0.05, -0.32, 0.1, 0.92), C.leaf],
    [curve([[0, -0.26], [-0.28, -0.82], [-0.92, -0.78], [-0.56, -0.26]]), C.green], [curve([[0, -0.08], [0.32, -0.68], [0.96, -0.56], [0.56, -0.04]]), C.green],
  ],
  bow: [
    [turned(arc(-0.58, 0, 1.08, 0.09, -62, 62), 0), C.gold], [line(-0.07, -0.95, -0.07, 0.95, 0.03), C.cream],
    [line(-0.98, 0, 0.72, 0, 0.05), C.silver], [[[0.98, 0], [0.62, -0.17], [0.62, 0.17]], C.flame],
    [[[-0.98, -0.14], [-0.74, -0.14], [-0.62, 0], [-0.74, 0.14], [-0.98, 0.14], [-0.86, 0]], C.red],
  ],
  coins: [
    [ellipse(0.42, 0.72, 0.5, 0.17), C.flame], [ellipse(0.42, 0.56, 0.5, 0.17), C.gold], [ellipse(0.42, 0.4, 0.5, 0.17), C.flame],
    [ellipse(-0.42, 0.72, 0.5, 0.17), C.gold], [ellipse(-0.42, 0.56, 0.5, 0.17), C.flame],
    [circle(0, -0.3, 0.68), C.flame], [circle(0, -0.3, 0.56), C.gold], [star(0, -0.3, 0.32, 0.13, 5), C.pale],
  ],

  // Health and kids' life.
  kid: kidLayers(),
  friends: [...placed(kidLayers(C.teal, C.blue), -0.5, 0.12, 0.6), ...placed(kidLayers(C.pink, C.purple), 0.5, 0.12, 0.6), [heartShape(0, -0.66, 0.22), C.red]],
  muscle: [
    [rounded(-0.98, -0.1, 0.32, 0.6, 0.08), C.red],
    [curve([[-0.7, 0.48], [0.1, 0.52], [0.52, 0.34], [0.6, -0.1], [0.5, -0.55], [0.26, -0.55], [0.22, -0.12], [0.02, -0.08], [-0.24, -0.42], [-0.52, -0.2], [-0.7, -0.06]]), C.skin],
    [circle(0.4, -0.68, 0.22), C.skin],
    [arc(-0.24, -0.08, 0.2, 0.06, 200, 300), C.pale],
    [star(0.82, -0.6, 0.16, 0.05, 4), C.yellow], [star(-0.52, -0.72, 0.13, 0.04, 4), C.yellow], [star(0.86, 0.1, 0.1, 0.035, 4), C.yellow],
  ],
  dumbbell: [
    [rect(-0.62, -0.06, 1.24, 0.12), C.silver],
    [rounded(-0.84, -0.46, 0.22, 0.92, 0.06), C.red], [rounded(-0.98, -0.32, 0.16, 0.64, 0.05), C.red],
    [rounded(0.62, -0.46, 0.22, 0.92, 0.06), C.red], [rounded(0.82, -0.32, 0.16, 0.64, 0.05), C.red],
    [star(0, -0.55, 0.2, 0.07, 4), C.yellow],
  ],
  crown: [
    [[[-0.85, 0.5], [-0.95, -0.42], [-0.45, 0.02], [0, -0.66], [0.45, 0.02], [0.95, -0.42], [0.85, 0.5]], C.gold],
    [rect(-0.86, 0.3, 1.72, 0.26), C.flame],
    [circle(-0.95, -0.48, 0.1), C.yellow], [circle(0, -0.74, 0.11), C.yellow], [circle(0.95, -0.48, 0.1), C.yellow],
    [circle(0, 0.43, 0.1), C.red], [circle(-0.5, 0.43, 0.08), C.teal], [circle(0.5, 0.43, 0.08), C.teal],
  ],
  gem: [
    [[[-0.92, -0.28], [-0.5, -0.74], [0.5, -0.74], [0.92, -0.28], [0, 0.92]], C.teal],
    [[[-0.92, -0.28], [-0.5, -0.74], [0.5, -0.74], [0.92, -0.28]], "#8ff0e6"],
    [[[-0.36, -0.28], [0.36, -0.28], [0, 0.92]], "#1fb5a8"],
    [star(0.72, -0.82, 0.18, 0.05, 4), C.white], [star(-0.8, 0.3, 0.13, 0.04, 4), C.yellow],
  ],
  sick: [
    ...face(C.mint).slice(0, 1),
    [arc(-0.32, -0.12, 0.14, 0.07, 200, 340), C.dark], [arc(0.32, -0.12, 0.14, 0.07, 200, 340), C.dark],
    [arc(0, 0.6, 0.26, 0.07, 215, 325), C.dark],
    [turned(rounded(0.05, 0.28, 0.78, 0.13, 0.065), -22, 0.05, 0.34), C.white], [circle(0.78, 0.07, 0.1), C.red],
    [teardrop(-0.72, -0.62, 0.2, 0.34), C.blue],
  ],
  thermometer: [
    [rounded(-0.15, -0.95, 0.3, 1.45, 0.15), C.white], [circle(0, 0.62, 0.3), C.red], [rect(-0.06, -0.35, 0.12, 0.9), C.red],
    [line(0.15, -0.65, 0.32, -0.65, 0.05), C.dark], [line(0.15, -0.4, 0.32, -0.4, 0.05), C.dark], [line(0.15, -0.15, 0.32, -0.15, 0.05), C.dark],
  ].map(([outline, colour]) => [turned(outline, 24), colour]),
  sad: [
    ...face(C.sky),
    [arc(0, 0.62, 0.3, 0.08, 215, 325), C.dark],
    [teardrop(-0.34, 0.12, 0.16, 0.3), C.blue],
  ],
  raincloud: [
    [teardrop(-0.5, 0.6, 0.16, 0.3), C.blue], [teardrop(0, 0.72, 0.16, 0.3), C.blue], [teardrop(0.5, 0.6, 0.16, 0.3), C.blue],
    [curve([[-0.82, 0.32], [-0.92, -0.04], [-0.62, -0.28], [-0.32, -0.6], [0.1, -0.66], [0.42, -0.44], [0.76, -0.36], [0.94, 0], [0.76, 0.32]]), "#b8c4d6"],
    [circle(-0.28, -0.08, 0.06), C.dark], [circle(0.28, -0.08, 0.06), C.dark], [arc(0, 0.2, 0.17, 0.05, 210, 330), C.dark],
  ],
  medicine: [
    [rounded(-0.5, -0.42, 0.8, 1.32, 0.12), "#ff9f43"], [rounded(-0.42, -0.7, 0.64, 0.3, 0.05), C.white],
    [rect(-0.5, -0.02, 0.8, 0.52), C.white], [rect(-0.15, 0.04, 0.1, 0.4), C.red], [rect(-0.3, 0.19, 0.4, 0.1), C.red],
    ...placed([[rounded(-0.4, -0.2, 0.8, 0.4, 0.2), C.white], [halfPill(0, 0.4, 0.2), C.red]].map(([o, c]) => [turned(o, -35), c]), 0.62, 0.62, 0.7),
  ],
  stethoscope: [
    [line(-0.42, -0.88, -0.5, -0.2, 0.08), C.teal], [line(0.42, -0.88, 0.5, -0.2, 0.08), C.teal],
    [arc(0, -0.2, 0.5, 0.08, 0, 180), C.teal], [arc(0.42, 0.3, 0.42, 0.08, 90, 180), C.teal],
    [circle(-0.42, -0.9, 0.08), C.dark], [circle(0.42, -0.9, 0.08), C.dark],
    [circle(0.48, 0.72, 0.22), C.silver], [circle(0.48, 0.72, 0.12), C.dark],
  ],
  doctorbag: [
    [arc(0, -0.38, 0.32, 0.12, 180, 360), C.dark],
    [rounded(-0.9, -0.38, 1.8, 1.2, 0.16), "#c0392b"], [rect(-0.9, -0.2, 1.8, 0.1), "#962d22"],
    [rect(-0.1, 0.02, 0.2, 0.6), C.white], [rect(-0.3, 0.22, 0.6, 0.2), C.white],
  ],
  apple: [
    [curve([[0, -0.45], [0.45, -0.7], [0.88, -0.3], [0.8, 0.35], [0.4, 0.85], [0, 0.72], [-0.4, 0.85], [-0.8, 0.35], [-0.88, -0.3], [-0.45, -0.7]]), C.red],
    [line(0, -0.45, 0.08, -0.88, 0.08), C.brown], [turned(ellipse(0.34, -0.78, 0.26, 0.1), -25, 0.34, -0.78), C.green],
    [turned(ellipse(-0.45, -0.22, 0.1, 0.2), 20, -0.45, -0.22), "#ff9a9a"],
  ],
  banana: [
    [curve([[-0.86, -0.42], [-0.56, 0.22], [0.1, 0.48], [0.84, 0.16], [0.9, 0.34], [0.3, 0.84], [-0.5, 0.7], [-0.94, 0.02]]), C.yellow],
    [rounded(-0.98, -0.58, 0.16, 0.22, 0.05), C.brown], [circle(0.88, 0.24, 0.06), C.brown],
    [arc(-0.1, -0.3, 0.86, 0.04, 70, 135), C.gold],
  ],
  carrot: [
    [teardrop(-0.16, -0.72, 0.24, 0.5), C.green], [teardrop(0, -0.8, 0.24, 0.56), C.leaf], [teardrop(0.16, -0.72, 0.24, 0.5), C.green],
    [teardrop(0, 0.16, 0.6, 1.36).map(([x, y]) => [x, 0.32 - y]), C.flame],
    [line(-0.2, -0.16, 0.0, -0.16, 0.05), C.clay], [line(0.04, 0.12, 0.2, 0.12, 0.05), C.clay], [line(-0.12, 0.4, 0.02, 0.4, 0.05), C.clay],
  ],
  broccoli: [
    [rounded(-0.18, 0.05, 0.36, 0.9, 0.12), "#9bd46a"],
    [circle(-0.46, -0.16, 0.34), C.leaf], [circle(0.46, -0.16, 0.34), C.leaf], [circle(0, -0.46, 0.42), C.green],
    [circle(-0.22, 0.06, 0.28), C.green], [circle(0.22, 0.06, 0.28), C.leaf],
    [circle(-0.12, -0.56, 0.1), C.mint], [circle(0.4, -0.24, 0.08), C.mint],
  ],
  thali: [
    [circle(0, 0, 0.96), C.silver], [circle(0, 0, 0.82), "#eef2f5"],
    [circle(-0.4, -0.32, 0.26), C.flame], [circle(0.38, -0.38, 0.24), C.green], [circle(0.42, 0.3, 0.26), C.yellow],
    [circle(-0.3, 0.34, 0.32), "#e2b46b"], [circle(-0.38, 0.28, 0.05), C.brown], [circle(-0.2, 0.42, 0.05), C.brown],
  ],
  toothbrush: [
    [turned(rounded(-0.95, -0.09, 1.5, 0.18, 0.09), -30), C.blue],
    [turned(rect(0.32, -0.3, 0.5, 0.22), -30), C.white],
    [turned(curve([[0.3, -0.36], [0.45, -0.5], [0.6, -0.4], [0.75, -0.52], [0.86, -0.36], [0.6, -0.3]]), -30), C.teal],
    [circle(-0.5, -0.6, 0.12), C.sky], [circle(-0.22, -0.82, 0.08), C.sky], [circle(0.66, 0.42, 0.1), C.sky],
  ],
  soap: [
    [rounded(-0.78, -0.12, 1.4, 0.8, 0.28), C.pink], [rounded(-0.58, 0.04, 1.0, 0.22, 0.11), "#ffb3cb"],
    [circle(0.34, -0.5, 0.3), C.sky], [circle(0.34, -0.5, 0.2), "#e3f3ff"], [circle(-0.3, -0.62, 0.2), C.sky], [circle(-0.3, -0.62, 0.12), "#e3f3ff"],
    [circle(0.82, -0.12, 0.14), C.sky], [circle(-0.66, -0.36, 0.1), C.sky],
  ],
  nature: [
    [rect(-0.98, -0.8, 1.96, 1.6), C.sky], [circle(0.56, -0.48, 0.22), C.yellow],
    [[[-0.98, 0.5], [-0.42, -0.42], [0.18, 0.5]], "#7f8fb3"], [[[-0.56, -0.2], [-0.42, -0.42], [-0.28, -0.2], [-0.42, -0.26]], C.white],
    [[[-0.2, 0.5], [0.36, -0.12], [0.98, 0.5]], "#6577a1"],
    [rect(-0.98, 0.42, 1.96, 0.38), C.green],
    [rect(0.62, 0.12, 0.08, 0.36), C.brown], [circle(0.66, 0.06, 0.18), C.leaf],
    [polar(-0.5, 0.6, (a) => 0.09 + 0.04 * Math.cos(5 * a)), C.pink],
  ],
  // Celebrations (Children's Day and other parties).
  balloons: [
    [line(-0.45, 0.06, 0.04, 0.9, 0.025), C.grey], [line(0.1, -0.1, 0.04, 0.9, 0.025), C.grey], [line(0.56, 0.13, 0.04, 0.9, 0.025), C.grey],
    [ellipse(-0.45, -0.34, 0.3, 0.38), C.red], [[[-0.45, 0.02], [-0.39, 0.1], [-0.51, 0.1]], C.red],
    [ellipse(0.56, -0.26, 0.28, 0.36), C.blue], [[[0.56, 0.08], [0.62, 0.16], [0.5, 0.16]], C.blue],
    [ellipse(0.1, -0.52, 0.3, 0.38), C.yellow], [[[0.1, -0.16], [0.16, -0.08], [0.04, -0.08]], C.yellow],
    [turned(ellipse(-0.55, -0.48, 0.06, 0.12), 25, -0.55, -0.48), C.white], [turned(ellipse(0, -0.66, 0.06, 0.12), 25, 0, -0.66), C.white], [turned(ellipse(0.47, -0.4, 0.06, 0.11), 25, 0.47, -0.4), C.white],
  ],
  kite: [
    [line(0, 0.42, 0.22, 0.62, 0.025), C.dark], [line(0.22, 0.62, 0.04, 0.8, 0.025), C.dark], [line(0.04, 0.8, 0.2, 0.96, 0.025), C.dark],
    [[[0.22, 0.62], [0.06, 0.52], [0.08, 0.7]], C.teal], [[[0.22, 0.62], [0.38, 0.72], [0.36, 0.54]], C.teal],
    [[[0.04, 0.8], [-0.12, 0.7], [-0.1, 0.88]], C.teal], [[[0.04, 0.8], [0.2, 0.9], [0.18, 0.72]], C.teal],
    [[[0, -0.92], [0.58, -0.2], [0, 0.44], [-0.58, -0.2]], C.magenta],
    [[[0, -0.92], [0.58, -0.2], [0, -0.2]], C.yellow], [[[0, -0.2], [-0.58, -0.2], [0, 0.44]], C.yellow],
    [line(0, -0.92, 0, 0.44, 0.03), C.brown], [line(-0.58, -0.2, 0.58, -0.2, 0.03), C.brown],
  ],
  rose: [
    [line(0, -0.1, 0.04, 0.95, 0.07), C.leaf],
    [turned(ellipse(-0.24, 0.42, 0.24, 0.1), -30, -0.24, 0.42), C.green], [turned(ellipse(0.28, 0.6, 0.24, 0.1), 30, 0.28, 0.6), C.green],
    [polar(0, -0.4, (a) => 0.46 + 0.07 * Math.cos(5 * a)), C.red], [circle(0, -0.42, 0.3), "#d81e3c"],
    [arc(0, -0.42, 0.2, 0.05, 160, 420), "#a3102a"], [arc(0.02, -0.44, 0.1, 0.045, 0, 270), "#a3102a"],
  ],
  rainbow: [
    [arc(0, 0.46, 0.9, 0.14, 180, 360), C.red], [arc(0, 0.46, 0.76, 0.14, 180, 360), C.flame], [arc(0, 0.46, 0.62, 0.14, 180, 360), C.yellow],
    [arc(0, 0.46, 0.48, 0.14, 180, 360), C.green], [arc(0, 0.46, 0.34, 0.14, 180, 360), C.blue],
    [curve([[-1, 0.62], [-0.98, 0.42], [-0.8, 0.32], [-0.6, 0.38], [-0.5, 0.5], [-0.56, 0.64]]), C.white],
    [curve([[1, 0.62], [0.98, 0.42], [0.8, 0.32], [0.6, 0.38], [0.5, 0.5], [0.56, 0.64]]), C.white],
  ],
  partyhat: [
    [[[0, -0.8], [0.55, 0.72], [-0.55, 0.72]], C.purple],
    [circle(-0.12, -0.2, 0.08), C.yellow], [circle(0.14, 0.12, 0.09), C.teal], [circle(-0.22, 0.42, 0.09), C.yellow], [circle(0.3, 0.5, 0.07), C.pink], [circle(0.04, -0.48, 0.06), C.teal],
    [rounded(-0.62, 0.64, 1.24, 0.18, 0.09), C.pink],
    [star(0, -0.86, 0.16, 0.07, 6), C.yellow],
    [star(-0.72, -0.4, 0.12, 0.04, 4), C.flame], [star(0.74, -0.2, 0.1, 0.035, 4), C.blue],
  ],
  tree: [
    [rect(-0.12, 0.1, 0.24, 0.8), C.brown], [ellipse(0, 0.9, 0.6, 0.08), C.green],
    [circle(-0.4, -0.2, 0.4), C.leaf], [circle(0.4, -0.2, 0.4), C.leaf], [circle(0, -0.5, 0.48), C.green], [circle(0, 0, 0.38), C.green],
    [circle(-0.32, -0.36, 0.08), C.red], [circle(0.28, -0.6, 0.08), C.red], [circle(0.42, -0.06, 0.08), C.red], [circle(-0.1, 0.1, 0.08), C.red],
  ],
};

const DRAWINGS = Object.fromEntries(Object.entries(DRAWING_SOURCES).map(([name, layers]) =>
  [name, layers.map(([outline, colour]) => ({ points: resample(outline), colour }))]));

// Paints a drawing centred at (x, y); `size` is half its box. `bg` fills layers that act as cut-outs.
function paintLayers(ctx, layers, x, y, size, bg) {
  for (const layer of layers) {
    ctx.fillStyle = layer.colour === "bg" ? bg : layer.colour;
    ctx.beginPath();
    layer.points.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * size, y + py * size) : ctx.moveTo(x + px * size, y + py * size)));
    ctx.closePath();
    ctx.fill();
  }
}
