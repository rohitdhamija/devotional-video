#!/usr/bin/env node
// Draws the lyric scene frame by frame in headless Chrome: contact sheet first, then the final H.264 video.
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
    align: { type: "string" },
    audio: { type: "string" },
    out: { type: "string" },
    "contact-sheet": { type: "string" },
    guides: { type: "boolean", default: false },
    strip: { type: "boolean", default: false },
    "no-preview": { type: "boolean", default: false },
    "text-top": { type: "boolean", default: false },
    "text-bottom": { type: "boolean", default: false },
    title: { type: "string" },
    artist: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    overwrite: { type: "boolean", default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(2);
}
function guard(path) {
  if (existsSync(path) && !args.overwrite) fail(`${path} exists; ask the user, then pass --overwrite`);
}
if (!args.align) fail("--align is required");
if (!args["contact-sheet"] && !args.out) fail("pass --contact-sheet <png> or --out <mp4>");
if (args.out && !args.audio) fail("--audio is required with --out");
if (args["text-top"] && args["text-bottom"]) fail("pass only one of --text-top and --text-bottom");
for (const path of [args.out, args["contact-sheet"]]) if (path) guard(path);

const song = JSON.parse(readFileSync(args.align, "utf8"));
song.title = args.title;
song.artist = args.artist;
song.strip = args.strip;
song.noPreview = args["no-preview"];
song.textTop = args["text-top"];
song.textBottom = args["text-bottom"];

const font = (subset) =>
  readFileSync(join(here, `../node_modules/@fontsource/tiro-devanagari-hindi/files/tiro-devanagari-hindi-${subset}-400-normal.woff2`)).toString("base64");
const fonts = [
  { base64: font("devanagari"), range: "U+0900-097F, U+200C-200D, U+25CC, U+A8E0-A8FF" },
  { base64: font("latin"), range: "U+0000-00FF, U+2010-2027" },
];

const browser = await puppeteer.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error(e); process.exit(1); });
await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="c" width="1280" height="720"></canvas>');
await page.addScriptTag({ content: readFileSync(join(here, "scene.js"), "utf8") });
const issues = await page.evaluate((s, f) => window.init(s, f), song, fonts);
if (issues.length) {
  await browser.close();
  fail("Layout problems:\n" + issues.join("\n"));
}

function contactSheetTimes() {
  // Intro, a mid-word moment in evenly spaced lines, and the longest instrumental gap if there is one.
  const lines = song.lines;
  const midWord = (line) => { const w = line.words[Math.floor(line.words.length / 2)]; return (w.start + w.end) / 2; };
  const times = [Math.min(lines[0].start * 0.6, 3.5)];
  let gap = { size: 0, at: 0 };
  lines.slice(0, -1).forEach((line, i) => {
    const size = lines[i + 1].start - line.end;
    if (size > gap.size) gap = { size, at: line.end + size * 0.6 };
  });
  const wantLines = Math.min(gap.size > 6 ? 4 : 5, lines.length);
  for (let i = 0; i < wantLines; i++) times.push(midWord(lines[wantLines > 1 ? Math.round((i * (lines.length - 1)) / (wantLines - 1)) : 0]));
  if (gap.size > 6) times.push(gap.at);
  return times.sort((a, b) => a - b).slice(0, 6);
}

if (args["contact-sheet"]) {
  const dir = mkdtempSync(join(tmpdir(), "lyric-stills-"));
  const times = contactSheetTimes();
  for (const [i, t] of times.entries()) {
    const data = await page.evaluate((x, g) => (g ? window.guidedFrame(x) : window.frame(x, "image/png")), t, args.guides);
    writeFileSync(join(dir, `s${i}.png`), Buffer.from(data, "base64"));
  }
  await browser.close();
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", join(dir, "s%d.png"),
    "-vf", "scale=640:360:flags=lanczos,tile=3x2:padding=6:color=0x241a12", "-frames:v", "1", resolve(args["contact-sheet"])], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) process.exit(1);
  console.log(`contact sheet: ${args["contact-sheet"]}`);
  console.log(`stills at: ${times.map((t) => t.toFixed(2) + "s").join(", ")}`);
  process.exit(0);
}

const start = Number(args.from ?? 0);
const end = Math.min(Number(args.to ?? song.duration), song.duration);
const frames = Math.ceil((end - start) * FPS);
const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y",
  "-framerate", String(FPS), "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-",
  "-ss", String(start), "-t", String(end - start), "-i", args.audio,
  "-map", "0:v:0", "-map", "1:a:0",
  "-vf", "scale=1280:720:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709:flags=lanczos,format=yuv420p",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-r", String(FPS),
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", resolve(args.out)], { stdio: ["pipe", "inherit", "inherit"] });
const finished = new Promise((ok) => ffmpeg.on("close", ok));

const began = Date.now();
for (let i = 0; i < frames; i++) {
  const data = await page.evaluate((t) => window.frame(t, "image/jpeg", 0.98), start + i / FPS);
  if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((ok) => ffmpeg.stdin.once("drain", ok));
  if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
}
ffmpeg.stdin.end();
const code = await finished;
await browser.close();
if (code !== 0) fail("ffmpeg failed");
console.log(`${args.out}: ${frames} frames in ${((Date.now() - began) / 1000).toFixed(0)}s`);
