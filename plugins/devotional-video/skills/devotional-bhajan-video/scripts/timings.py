#!/usr/bin/env python3
"""Line timings, YouTube chapters and Shorts candidates from an alignment and the verses file.

Usage: python3 timings.py alignment.json verses.txt [--keyword आरती] [--max 58]
Verses are separated by blank rows in verses.txt (the same file passed to render.mjs --verses).
Chapters start at each verse; the first is moved to 0:00 as YouTube requires, and chapters closer than 10 s merge.
Shorts candidates: windows that start 0.5 s before a verse containing --keyword and extend over whole lines to the
last line ending before --max seconds, so each clip starts and ends on complete lines.
"""
import argparse, json

ap = argparse.ArgumentParser()
ap.add_argument("alignment"); ap.add_argument("verses")
ap.add_argument("--keyword", default="आरती"); ap.add_argument("--max", type=float, default=58.0)
a = ap.parse_args()
lines = json.load(open(a.alignment, encoding="utf-8"))["lines"]
rows = open(a.verses, encoding="utf-8").read().split("\n")
verses, cur = [], []
for r in rows:
    if r.strip(): cur.append(r.strip())
    elif cur: verses.append(cur); cur = []
if cur: verses.append(cur)
if sum(map(len, verses)) != len(lines):
    raise SystemExit(f"verses file has {sum(map(len, verses))} lyric rows but the alignment has {len(lines)}")
mmss = lambda t: f"{int(t // 60)}:{int(t % 60):02d}"

print("LINES")
for i, l in enumerate(lines, 1): print(f"{i:3d} {l['start']:7.2f} {l['end']:7.2f}  {l['text']}")

starts, i = [], 0
for v in verses: starts.append((i, v)); i += len(v)
print("\nCHAPTERS (paste into the description)")
chapters = []
for idx, v in starts:
    t = 0.0 if not chapters else lines[idx]["start"]
    if chapters and t - chapters[-1][0] < 10: continue
    chapters.append((t, v[0]))
for t, title in chapters: print(f"{mmss(t)} {title}")

print(f"\nSHORTS CANDIDATES (verses containing '{a.keyword}', under {a.max:.0f} s)")
for idx, v in starts:
    if not any(a.keyword in r for r in v): continue
    t0 = max(0.0, lines[idx]["start"] - 0.5)
    fits = lambda j: lines[j]["end"] + 0.4 - t0 <= a.max
    # Prefer ending on the last line of a verse; otherwise on an even number of lines (a whole couplet).
    ends = [s2 + len(v2) - 1 for s2, v2 in starts if s2 >= idx and fits(s2 + len(v2) - 1)]
    if ends: end = max(ends)
    else:
        end = idx
        while end + 1 < len(lines) and fits(end + 1): end += 1
        if (end - idx) % 2 == 0 and end > idx: end -= 1
    t1 = lines[end]["end"] + 0.4
    print(f"  --from {t0:.1f} --to {t1:.1f}  ({t1 - t0:.1f} s)  {lines[idx]['text']}  ->  {lines[end]['text']}")
