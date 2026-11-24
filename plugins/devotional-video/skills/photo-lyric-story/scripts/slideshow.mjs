#!/usr/bin/env node
// Renders the photo track of a photo-lyric-story from story.json: beat-snapped cuts, Ken Burns moves, transitions,
// a title card and an end card. Lyrics are added afterwards by kinetic-lyrics (--background this video).
// Usage:
//   node slideshow.mjs --story story.json --align alignment.json --beats beats.json --photos work/photos --storyboard sb.png
//   node slideshow.mjs ... --out photos.mp4 [--hd] [--overwrite]
// --hd draws the same layout at 1.5x for a sharp 1920x1080 track (for big screens); pass --hd to kinetic-lyrics too.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer";

const FPS = 30;
const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    story: { type: "string" }, align: { type: "string" }, beats: { type: "string" }, photos: { type: "string" },
    out: { type: "string" }, storyboard: { type: "string" }, overwrite: { type: "boolean", default: false },
    hd: { type: "boolean", default: false },
  },
});
const fail = (m) => { console.error(m); process.exit(2); };
for (const k of ["story", "align", "beats", "photos"]) if (!args[k]) fail(`--${k} is required`);
if (!args.out && !args.storyboard) fail("pass --storyboard <png> or --out <mp4>");
for (const p of [args.out, args.storyboard]) if (p && existsSync(p) && !args.overwrite) fail(`${p} exists; ask the user, then pass --overwrite`);

const story = JSON.parse(readFileSync(args.story, "utf8"));
const song = JSON.parse(readFileSync(args.align, "utf8"));
const beatData = JSON.parse(readFileSync(args.beats, "utf8"));
const beats = beatData.beats, beat = 60 / beatData.bpm;
const tail = Number(story.tail ?? 0);
const duration = song.duration + tail;
const lines = song.lines;

// Transition lengths in beats. The middle of each transition lands on the cut.
const LENGTH = { cut: 0, fade: 2, push: 1, zoom: 1, flash: 1.5 };
const MOVES = ["in", "out", "left", "right", "still"];
const MOVE_ZOOM = { in: [1.0, 1.12], out: [1.12, 1.0], left: [1.12, 1.12], right: [1.12, 1.12], still: [1.04, 1.04] };

// Cut just before the voice comes in, on the nearest beat if one is close; otherwise exactly there.
function snap(target) {
  let best = null;
  for (const b of beats) if (!best || Math.abs(b.t - target) < Math.abs(best.t - target)) best = b;
  return best && Math.abs(best.t - target) <= 0.3 ? best.t : target;
}

const issues = [];
const photos = {};
const shots = (story.shots ?? []).map((s, i) => {
  const where = `shot ${i + 1} (${s.photo})`;
  const path = join(args.photos, s.photo ?? "");
  if (!s.photo || !existsSync(path)) { issues.push(`${where}: photo not found in ${args.photos}`); return null; }
  photos[s.photo] ??= path;
  let cut;
  if (i === 0) cut = 0;
  else if (s.line != null) {
    const line = lines[s.line - 1];
    if (!line) { issues.push(`${where}: there is no lyric line ${s.line}`); return null; }
    cut = snap(s.beats ? line.start + s.beats * beat : line.start - 0.12);
  } else if (s.at != null) cut = Number(s.at);
  else { issues.push(`${where}: give "line" (1-based lyric row) or "at" (seconds)`); return null; }
  const transition = s.transition ?? (i === 0 ? "cut" : "fade");
  if (!(transition in LENGTH)) issues.push(`${where}: transition must be one of ${Object.keys(LENGTH).join(", ")}`);
  const move = s.move ?? "in";
  if (!MOVES.includes(move)) issues.push(`${where}: move must be one of ${MOVES.join(", ")}`);
  const focus = s.focus ?? [0.5, 0.4];
  const focusTo = s.focusTo ?? focus;
  if ([...focus, ...focusTo].some((v) => !(v >= 0 && v <= 1))) issues.push(`${where}: focus values are fractions of the photo, 0 to 1`);
  return {
    photo: s.photo, line: s.line, cut, transition, length: (LENGTH[transition] ?? 0) * beat,
    move, zoom: s.zoom ?? MOVE_ZOOM[move] ?? [1, 1.1], focus, focusTo,
    fit: s.fit, pulse: Boolean(s.pulse), dir: s.dir, tilt: s.tilt ?? (i % 2 ? 1.6 : -1.6), why: s.why ?? "",
  };
});
if (!shots.length) issues.push("story.json has no shots");
if (issues.length) fail("Story problems:\n" + issues.join("\n"));

shots.forEach((s, i) => {
  const next = shots[i + 1];
  s.from = s.cut - s.length / 2;
  s.to = next ? next.cut + next.length / 2 : duration;
  if (next) {
    const room = next.cut - s.cut - (s.length + next.length) / 2;
    if (next.cut <= s.cut) issues.push(`shot ${i + 2} (${next.photo}) starts at ${next.cut.toFixed(2)}s, not after shot ${i + 1}`);
    else if (room < 0.8) issues.push(`shot ${i + 1} (${s.photo}) is on screen alone for only ${Math.max(0, room).toFixed(2)}s; use fewer shots or shorter transitions`);
  }
  if (s.fit && !["cover", "card"].includes(s.fit)) issues.push(`shot ${i + 1}: fit must be cover or card`);
});

const firstLine = lines[0]?.start ?? 3;
const titleCard = story.title ? { start: 0.25, end: Math.max(1.5, Math.min(firstLine - 0.2, 6)) } : null;
let endCard = null;
if (story.end?.text) {
  const last = shots[shots.length - 1];
  endCard = { text: story.end.text, start: story.end.at ?? last.cut + 1.5 };
}
if (issues.length) fail("Story problems:\n" + issues.join("\n"));

const font = readFileSync(join(here, "../node_modules/@fontsource/poppins/files/poppins-latin-800-normal.woff2")).toString("base64");
const images = Object.fromEntries(Object.entries(photos).map(([n, p]) => [n, `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`]));
const browser = await puppeteer.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error(e); process.exit(1); });
await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="c" width="1280" height="720"></canvas>');
await page.addScriptTag({ content: readFileSync(join(here, "story.js"), "utf8") });
const plain = shots.map(({ why, ...s }) => s);
const { problems, fits } = await page.evaluate((d, f) => window.init(d, f), { story, shots: plain, beats, duration, images, titleCard, endCard, scale: args.hd ? 1.5 : 1 }, font);
if (problems.length) { await browser.close(); fail("Layout problems:\n" + problems.join("\n")); }
shots.forEach((s, i) => { s.fit = fits[i]; });
console.log(`song ${song.duration.toFixed(2)}s + tail ${tail}s, ${beatData.bpm} BPM, ${shots.length} shots`);
for (const [i, s] of shots.entries()) {
  const text = s.line ? `L${s.line} "${lines[s.line - 1].text}"` : "";
  console.log(`  ${String(i + 1).padStart(2)}  ${s.cut.toFixed(2).padStart(6)}s  ${(s.to - s.from).toFixed(1).padStart(4)}s  ${s.transition.padEnd(5)} ${s.fit.padEnd(5)} ${s.move.padEnd(5)} ${s.photo.padEnd(26)} ${text}`);
}


if (args.storyboard) {
  // One still per shot, halfway through the time it is on screen alone, labelled with its number and lyric row.
  const dir = mkdtempSync(join(tmpdir(), "story-"));
  for (const [i, s] of shots.entries()) {
    const next = shots[i + 1];
    const t = (s.cut + s.length / 2 + (next ? next.cut - next.length / 2 : duration)) / 2;
    const label = `${i + 1}  ${t.toFixed(1)}s${s.line ? `  L${s.line}` : ""}  ${s.photo}`;
    writeFileSync(join(dir, `s${String(i).padStart(3, "0")}.jpg`), Buffer.from(await page.evaluate((x, l) => window.frame(x, l), t, label), "base64"));
  }
  await browser.close();
  const cols = 4, rows = Math.ceil(shots.length / cols);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-pattern_type", "glob", "-i", join(dir, "s*.jpg"),
    "-vf", `scale=480:270:flags=lanczos,tile=${cols}x${rows}:padding=6:color=0x101010`, "-frames:v", "1", resolve(args.storyboard)], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) process.exit(1);
  console.log(`storyboard: ${args.storyboard}`);
  process.exit(0);
}

// The photo track is an intermediate, so it is encoded near-lossless; the final encode happens in kinetic-lyrics.
const frames = Math.ceil(duration * FPS);
const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-",
  "-vf", `scale=${args.hd ? "1920:1080" : "1280:720"}:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709:flags=lanczos,format=yuv420p`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-r", String(FPS),
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-t", String(frames / FPS), resolve(args.out)], { stdio: ["pipe", "inherit", "inherit"] });
const finished = new Promise((ok) => ffmpeg.on("close", ok));
const began = Date.now();
for (let i = 0; i < frames; i++) {
  const data = await page.evaluate((t) => window.frame(t), i / FPS);
  if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((ok) => ffmpeg.stdin.once("drain", ok));
  if (i % 300 === 0) console.log(`frame ${i}/${frames}`);
}
ffmpeg.stdin.end();
const code = await finished;
await browser.close();
if (code !== 0) fail("ffmpeg failed");
console.log(`${args.out}: ${frames} frames (${(frames / FPS).toFixed(2)}s) in ${((Date.now() - began) / 1000).toFixed(0)}s`);
