#!/usr/bin/env node
// YouTube thumbnail (1280x720): a frame of the background video, a dark-maroon lower scrim, a big gold title with a
// thick maroon edge, a cream subtitle and an optional badge, in the same Poppins Devanagari 800 font as the lyrics.
// Usage: node thumbnail.mjs --bg bg.mp4 --at 205 --title "आरती पूजा" [--sub "गुरुमुख की पहचान"] [--tag "अमृत वेला भजन"] --out thumb.png [--overwrite]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer";

const { values: a } = parseArgs({ options: { bg: { type: "string" }, at: { type: "string", default: "0" }, title: { type: "string" }, sub: { type: "string", default: "" },
  tag: { type: "string", default: "" }, out: { type: "string" }, overwrite: { type: "boolean", default: false } } });
if (!a.bg || !a.title || !a.out) { console.error("--bg, --title and --out are required"); process.exit(2); }
if (existsSync(a.out) && !a.overwrite) { console.error(`${a.out} exists; ask the user, then pass --overwrite`); process.exit(2); }
const frame = join(mkdtempSync(join(tmpdir(), "thumb-")), "f.png");
if (/\.(png|jpe?g|webp)$/i.test(a.bg)) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", a.bg, "-vf", "scale=1280:720", frame]);
else execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", a.at, "-i", a.bg, "-frames:v", "1", "-vf", "scale=1280:720", frame]);
const fonts = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/@fontsource/poppins/files");
const font = (s) => readFileSync(join(fonts, `poppins-${s}-800-normal.woff2`)).toString("base64");
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const titlePx = Math.min(150, Math.floor(1900 / Math.max(4, [...a.title].length)));
const html = `<!doctype html><style>
@font-face{font-family:P;src:url(data:font/woff2;base64,${font("devanagari")}) format("woff2");unicode-range:U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+25CC,U+A830-A839,U+A8E0-A8FF;}
@font-face{font-family:P;src:url(data:font/woff2;base64,${font("latin")}) format("woff2");}
body{margin:0;width:1280px;height:720px;overflow:hidden;font-family:P}
.bg{position:absolute;inset:0;background:url(data:image/png;base64,${readFileSync(frame).toString("base64")}) center/cover}
.shade{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(20,5,10,0) 45%,rgba(40,8,12,.72) 78%,rgba(40,8,12,.85))}
.t{position:absolute;left:0;right:0;text-align:center}
.title{bottom:${a.sub ? 118 : 70}px;font-size:${titlePx}px;line-height:1;color:#ffd24a;-webkit-text-stroke:14px #5a0d12;paint-order:stroke fill;text-shadow:0 6px 24px rgba(0,0,0,.6)}
.sub{bottom:52px;font-size:58px;color:#fff6e0;-webkit-text-stroke:8px #5a0d12;paint-order:stroke fill}
.tag{top:34px;right:46px;left:auto;font-size:34px;color:#fff;background:rgba(122,20,26,.85);padding:6px 22px 10px;border-radius:40px;border:3px solid #ffc94a}
</style><div class=bg></div><div class=shade></div>
${a.tag ? `<div class="t tag">${esc(a.tag)}</div>` : ""}<div class="t title">${esc(a.title)}</div>${a.sub ? `<div class="t sub">${esc(a.sub)}</div>` : ""}`;
const b = await puppeteer.launch({ headless: true }); const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 }); await p.setContent(html); await p.evaluate(() => document.fonts.ready);
writeFileSync(a.out, await p.screenshot({ type: "png" })); await b.close(); console.log(`thumbnail: ${a.out}`);
