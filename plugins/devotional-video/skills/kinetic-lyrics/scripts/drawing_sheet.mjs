#!/usr/bin/env node
// Draws every drawing in the library on one labelled sheet, for checking them by eye and choosing names for drawings.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const out = process.argv[2], paper = process.argv[3] === "--paper";
if (!out) { console.error("usage: drawing_sheet.mjs <out.png> [--paper]"); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>');
await page.addScriptTag({ content: readFileSync(join(here, "drawings.js"), "utf8") });
const data = await page.evaluate((paper) => {
  const names = Object.keys(DRAWINGS), columns = 8, cell = 230, c = document.getElementById("c");
  c.width = columns * cell; c.height = Math.ceil(names.length / columns) * cell;
  const g = c.getContext("2d");
  const bg = paper ? "#fff4dc" : "#14103a", ink = "#2d2a4a";
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  names.forEach((name, i) => {
    const x = (i % columns) * cell + cell / 2, y = Math.floor(i / columns) * cell + cell / 2 - 10;
    paintLayers(g, DRAWINGS[name], x, y, 85, bg);
    if (paper) {
      // Ink outlines as the sketch style draws them.
      g.strokeStyle = ink; g.lineWidth = 2.6; g.lineJoin = "round";
      for (const layer of DRAWINGS[name]) {
        g.fillStyle = layer.colour === "bg" ? bg : layer.colour;
        g.beginPath(); layer.points.forEach(([px, py], i) => (i ? g.lineTo(x + px * 85, y + py * 85) : g.moveTo(x + px * 85, y + py * 85)));
        g.closePath(); g.fill(); if (layer.colour !== "bg") g.stroke();
      }
    }
    g.fillStyle = paper ? ink : "#fff"; g.font = "20px sans-serif"; g.textAlign = "center"; g.fillText(name, x, y + 112);
  });
  return c.toDataURL("image/png").split(",")[1];
}, paper);
await browser.close();
writeFileSync(resolve(out), Buffer.from(data, "base64"));
console.log(out);
