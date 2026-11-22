#!/usr/bin/env node
// Draws the kinetic scene frame by frame in headless Chrome: contact sheet first, then the final H.264 video.
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
    beats: { type: "string" },
    drawings: { type: "string" },
    verses: { type: "string" },
    style: { type: "string", default: "kinetic" },
    greeting: { type: "string" },
    "end-text": { type: "string" },
    tail: { type: "string" },
    vertical: { type: "boolean", default: false },
    hd: { type: "boolean", default: false },
    green: { type: "boolean", default: false },
    background: { type: "string" },
    "text-box": { type: "string" },
    "screen-lines": { type: "string" },
    "no-panel": { type: "boolean", default: false },
    fade: { type: "string" },
    audio: { type: "string" },
    out: { type: "string" },
    "contact-sheet": { type: "string" },
    guides: { type: "boolean", default: false },
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
if (!args.align || !args.beats) fail("--align and --beats are required");
if (!args["contact-sheet"] && !args.out) fail("pass --contact-sheet <png> or --out <mp4>");
if (args.out && !args.audio) fail("--audio is required with --out");
for (const path of [args.out, args["contact-sheet"]]) {
  if (path && existsSync(path) && !args.overwrite) fail(`${path} exists; ask the user, then pass --overwrite`);
}

const song = JSON.parse(readFileSync(args.align, "utf8"));
song.beatData = JSON.parse(readFileSync(args.beats, "utf8"));
if (args.drawings) song.drawingData = JSON.parse(readFileSync(args.drawings, "utf8"));
// --verses lyrics.txt: blank rows in the lyrics file mark verse breaks; each verse is shown as one karaoke screen.
if (args.verses) {
  const groups = [[]];
  for (const row of readFileSync(args.verses, "utf8").split(/\r?\n/)) {
    if (!row.trim()) { if (groups[groups.length - 1].length) groups.push([]); continue; }
    if (/\p{L}/u.test(row)) groups[groups.length - 1].push(row.trim().split(/\s+/).join(" "));
  }
  if (!groups[groups.length - 1].length) groups.pop();
  const rows = groups.flat();
  if (rows.length !== song.lines.length) fail(`--verses has ${rows.length} lyric rows but the alignment has ${song.lines.length}; use the same lyrics file`);
  const bad = rows.findIndex((r, i) => r !== song.lines[i].text);
  if (bad >= 0) fail(`--verses row ${bad + 1} "${rows[bad]}" does not match the alignment "${song.lines[bad].text}"`);
  let at = 0;
  song.verses = groups.map((g) => g.map(() => at++));
}
song.title = args.title;
song.vertical = args.vertical;
// --hd renders 1920x1080 for big screens: the same layout drawn at 1.5x, not an upscale.
if (args.hd && args.vertical) fail("--hd is for landscape only; Shorts are already 1080x1920");
song.scale = args.hd ? 1.5 : 1;
const frameSize = args.vertical ? "1080:1920" : args.hd ? "1920:1080" : "1280:720";
if (!["kinetic", "sketch"].includes(args.style)) fail("--style is kinetic or sketch");
song.style = args.style;
song.green = args.green;
song.overlay = Boolean(args.background);
song.screenLines = Number(args["screen-lines"] ?? 0);
song.noPanel = args["no-panel"];
if (song.noPanel && !args.background) fail("--no-panel needs --background");
if (args["text-box"]) {
  song.textBox = args["text-box"].split(",").map(Number);
  if (song.textBox.length !== 4 || song.textBox.some((v) => !(v >= 0))) fail("--text-box is x,y,width,height in pixels");
}
if (args.background && args.green) fail("pass --green or --background, not both");
if (args.background && (args.style === "sketch" || args.drawings)) fail("--background shows lyrics only; drop --style sketch and --drawings");
if (args.background && !existsSync(args.background)) fail(`${args.background} not found`);
if (args.green && (args.style === "sketch" || args.drawings)) fail("--green shows lyrics only; drop --style sketch and --drawings");
song.greeting = args.greeting;
song.endText = args["end-text"];
// --tail holds the end scene for extra seconds after the song, over silence.
const tail = Number(args.tail ?? 0), songLength = song.duration;
song.duration += tail;
song.artist = args.artist;

const font = (subset) =>
  readFileSync(join(here, `../node_modules/@fontsource/poppins/files/poppins-${subset}-800-normal.woff2`)).toString("base64");
const fonts = [
  { base64: font("devanagari"), range: "U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+25CC, U+A830-A839, U+A8E0-A8FF" },
  { base64: font("latin"), range: "U+0000-00FF, U+2010-2027" },
];

const browser = await puppeteer.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error(e); process.exit(1); });
await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="c" width="1280" height="720"></canvas>');
await page.addScriptTag({ content: readFileSync(join(here, "drawings.js"), "utf8") });
await page.addScriptTag({ content: readFileSync(join(here, "sketch.js"), "utf8") });
await page.addScriptTag({ content: readFileSync(join(here, "scene.js"), "utf8") });
const issues = await page.evaluate((s, f) => window.init(s, f), song, fonts);
if (issues.length) {
  await browser.close();
  fail("Layout problems:\n" + issues.join("\n"));
}

if (args.verses) {
  const plan = await page.evaluate(() => screens.map((s) => `verse ${s.verse + 1}: rows ${s.rows[0] + 1}-${s.rows[s.rows.length - 1] + 1} at ${s.size}px`));
  console.log("verse screens:\n  " + plan.join("\n  "));
}

if (args.drawings) {
  const missing = await page.evaluate(() => (sketch ?? rush).missing);
  if (missing.length) console.log(`rows with no keyword (they will use idle drawings): ${missing.join(", ")}`);
}

function contactSheetTimes() {
  // The intro, words just after they land across the song, and the longest instrumental gap if there is one.
  const from = Number(args.from ?? 0), to = Number(args.to ?? song.duration);
  const lines = song.lines.filter((line) => line.start >= from && line.end <= to);
  if (!lines.length) fail("no lyric lines inside --from and --to");
  const landed = (line) => line.words[Math.floor(line.words.length / 2)].start + 0.1;
  const times = args.from ? [] : [Math.min(lines[0].start * 0.6, 3.5)];
  let gap = { size: 0, at: 0 };
  lines.slice(0, -1).forEach((line, i) => {
    const size = lines[i + 1].start - line.end;
    if (size > gap.size) gap = { size, at: line.end + size * 0.6 };
  });
  const wantLines = Math.min((gap.size > 4 ? 4 : 5) + (args.from ? 1 : 0), lines.length);
  for (let i = 0; i < wantLines; i++) times.push(landed(lines[wantLines > 1 ? Math.round((i * (lines.length - 1)) / (wantLines - 1)) : 0]));
  if (gap.size > 4) times.push(gap.at);
  return times.sort((a, b) => a - b).slice(0, 6);
}

if (args["contact-sheet"]) {
  const dir = mkdtempSync(join(tmpdir(), "kinetic-stills-"));
  const times = contactSheetTimes();
  for (const [i, t] of times.entries()) {
    const data = await page.evaluate((x, g) => window.frame(x, "image/png", undefined, g), t, args.guides);
    writeFileSync(join(dir, `s${i}.png`), Buffer.from(data, "base64"));
    if (args.background) {
      // The background loops, so wrap the time into its length.
      const length = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.background]).stdout.toString());
      const lyrics = join(dir, `l${i}.png`);
      writeFileSync(lyrics, Buffer.from(data, "base64"));
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t % length), "-i", args.background, "-i", lyrics, "-filter_complex",
        `[0:v]scale=${frameSize}:force_original_aspect_ratio=increase,crop=${frameSize}[bg];[bg][1:v]overlay`, "-frames:v", "1", join(dir, `s${i}.png`)], { stdio: "inherit" });
      if (r.status !== 0) fail("could not composite the contact sheet onto --background");
    }
  }
  await browser.close();
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", join(dir, "s%d.png"),
    "-vf", `${args.vertical ? "scale=360:640:flags=lanczos,tile=6x1" : "scale=640:360:flags=lanczos,tile=3x2"}:padding=6:color=0x101010`, "-frames:v", "1", resolve(args["contact-sheet"])], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  if (result.status !== 0) process.exit(1);
  console.log(`contact sheet: ${args["contact-sheet"]}`);
  console.log(`stills at: ${times.map((t) => t.toFixed(2) + "s").join(", ")}`);
  process.exit(0);
}

const start = Number(args.from ?? 0);
const end = Math.min(Number(args.to ?? song.duration), song.duration);
const frames = Math.ceil((end - start) * FPS);
const size = frameSize;
// --fade closes a clip cleanly: a brief audio fade-in at the cut, then sound and picture fade out together.
const fade = Number(args.fade ?? 0), fadeStart = (end - start - fade).toFixed(3);
const videoFade = fade ? `,fade=t=out:st=${fadeStart}:d=${fade}` : "";
const audioFade = fade ? ["-af", `afade=t=in:d=0.05,afade=t=out:st=${fadeStart}:d=${fade}`]
  : tail && end > songLength ? ["-af", `afade=t=out:st=${(songLength - start - 0.6).toFixed(3)}:d=0.6,apad`] : [];
// With --background, frames come as transparent PNGs and are laid over the (looping) background video.
const videoInputs = args.background
  ? ["-framerate", String(FPS), "-f", "image2pipe", "-c:v", "png", "-i", "-", "-stream_loop", "-1", "-ss", String(start), "-i", args.background]
  : ["-framerate", String(FPS), "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-"];
const audioIndex = args.background ? 2 : 1;
const picture = args.background
  ? ["-filter_complex", `[1:v]scale=${size}:force_original_aspect_ratio=increase,crop=${size},fps=${FPS},setpts=PTS-STARTPTS[bg];[bg][0:v]overlay=format=auto:shortest=1,scale=out_range=tv:out_color_matrix=bt709,format=yuv420p${videoFade}[v]`, "-map", "[v]"]
  : ["-map", "0:v:0", "-vf", `scale=${size}:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709:flags=lanczos,format=yuv420p${videoFade}`];
const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y",
  ...videoInputs,
  "-ss", String(start), "-t", String(end - start), "-i", args.audio,
  ...picture, "-map", `${audioIndex}:a:0`, ...audioFade,
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-r", String(FPS),
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "aac", "-b:a", "192k", "-t", String(end - start), "-movflags", "+faststart", resolve(args.out)], { stdio: ["pipe", "inherit", "inherit"] });
const finished = new Promise((ok) => ffmpeg.on("close", ok));

const began = Date.now();
for (let i = 0; i < frames; i++) {
  const data = await page.evaluate((t, png) => window.frame(t, png ? "image/png" : "image/jpeg", 0.98), start + i / FPS, Boolean(args.background));
  if (!ffmpeg.stdin.write(Buffer.from(data, "base64"))) await new Promise((ok) => ffmpeg.stdin.once("drain", ok));
  if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
}
ffmpeg.stdin.end();
const code = await finished;
await browser.close();
if (code !== 0) fail("ffmpeg failed");
console.log(`${args.out}: ${frames} frames in ${((Date.now() - began) / 1000).toFixed(0)}s`);
