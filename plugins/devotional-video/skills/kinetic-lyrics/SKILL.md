---
name: kinetic-lyrics
description: Turns a song MP3 and its lyrics (one sung line per row) into a landscape kinetic-typography video where big words slam in as they are sung and the type kicks on every detected beat. Use when the user runs /kinetic-lyrics or asks for kinetic typography or beat-synced lyrics.
argument-hint: <song.mp3> <lyrics.txt> [title] [artist]
---

# Kinetic lyrics

**Input:** a song MP3 and a UTF-8 lyrics file with one sung line per row, in Devanagari or Latin script. Repeated lines must be written out each time they are sung, because the aligner follows the file in order.

**Output:** a 1280x720 MP4. Big bold words slam into the lower third as they are sung, and the sung line kicks on each beat. Above them are original bars and rings driven by the audio, or, with `--drawings`, drawings that morph on each beat based on the lyrics. Each lyric line gets a new colour palette.

Everything is drawn in code. Use no stock footage or image generators. Use only songs and lyrics the user owns or is allowed to use, and do not add copyrighted characters, scenes or logos.

`SKILL` below means this skill's folder, `${CLAUDE_SKILL_DIR}`. `P` means the Python printed by `setup.sh` (default `~/.claude/video-tools/venv/bin/python`). Put outputs next to the song unless the user names another folder.

## Method

1. **Set up.** Run `SKILL/setup.sh`. It checks ffmpeg and Node, installs them if missing, and prepares the shared venv and renderer packages under `~/.claude/video-tools`. The first run downloads PyTorch and Chrome, a few GB, and takes several minutes.

2. **Check the lyrics.** Numbers and symbols must be spelled out as words, because the aligner rejects them. Do not edit the user's wording without asking.

3. **Align the words.** Never guess timing.
   ```bash
   $P SKILL/scripts/align.py --audio song.mp3 --lyrics lyrics.txt --out alignment.json
   ```
   - Add `--vocals stem.wav` to align against an isolated vocal stem. If any line is listed under `LOW CONFIDENCE`, stop and show those lines to the user. Likely causes are wrong lyrics, a line sung more times than it is written, or music too loud over the voice.
   - For repeated lines, use `--sections "1-8:0-61,9-12:93-122"` to keep rows inside the time ranges where they are sung. This restricts the search; the timing still comes from the aligner.
   - For a vocal stem, run `$P -m pip install demucs`, then `$P -m demucs --two-stems vocals -n htdemucs -d cpu -o <dir> song.mp3`. Compare the result with the full mix, because a stem can make some rows worse.

4. **Detect the beats.**
   ```bash
   $P SKILL/scripts/beats.py --audio song.mp3 --out beats.json
   ```
   Read the reported BPM. If the output says `LOW BEAT CONFIDENCE`, tell the user the kicks may not match the rhythm. Half-speed results are corrected only when the evidence is strong, so if the tempo is half or double what the song feels like, rerun with `--bpm <value>`.

5. **Show the contact sheet and wait.** Do not start the final render until the user approves it.
   ```bash
   cd SKILL && node scripts/render.mjs --align alignment.json --beats beats.json --title "Title" --artist "Artist" --contact-sheet /abs/path/contact_sheet.png
   ```
   This draws 6 stills: the intro, words just after they land across the song, and the longest instrumental gap if it runs over 4 seconds. Open the sheet for the user with `open`. The script stops with an error if any row would leave the safe area, even at the peak of its animation, or runs past about 32 characters. If that happens, ask the user how to split the line.

6. **Render the final video** after approval, with the same `--title` and `--artist`.
   ```bash
   cd SKILL && node scripts/render.mjs --align alignment.json --beats beats.json --audio song.mp3 --title "Title" --artist "Artist" --out /abs/path/video.mp4
   ```
   For a long song, run this in the background. Add `--from <sec> --to <sec>` to render a short test section.

7. **Verify and report.** Use `ffprobe` to confirm the settings below, and check that the video and audio durations match. Give the user the file path, the timing scores and the BPM.

**Drawings instead of bars:** add `--drawings drawings.json` to the contact-sheet and final commands when the user wants lyric-driven pictures. A large drawing morphs into the next on every beat while earlier ones fly outward. Run `node scripts/drawing_sheet.mjs /abs/path/library.png` to see the names, then write the map from the actual lyrics:
```json
{ "words": { "patakhe": "firecracker", "diwali": ["diya", "burst", "rocket"] }, "idle": ["diya", "star", "sparkler"] }
```
Keys are lyric words in any case without punctuation, and a list cycles on each use. A keyword takes the beat nearest to when it is sung; other beats cycle through that line's keywords, and `idle` fills the gaps between lines. The script lists rows with no keyword. Add any missing drawing to `scripts/drawings.js`. Represent deities through respectful symbols such as a lotus or a bow, not as figures, unless the user asks otherwise.

**Sketchbook style (good for kids' songs):** add `--style sketch --drawings drawings.json` to the contact-sheet and final commands. Pastel paper replaces the dark palettes. Each keyword's drawing is traced in ink by a pencil as the word is sung, coloured in with a left-to-right sweep, then bounces on the beat; a line shows up to 4 drawings side by side. Lyrics are typed grapheme by grapheme, so conjuncts and matras stay whole, with a caret, and the sung word in the accent colour. Drawings stay up through pauses under 3 seconds; the intro, the outro and longer gaps get an `idle` drawing. Long gaps cycle through `idle` drawings, a new one about every 4 seconds. For occasions, `drawings.json` can add `"intro": [...]` (drawn side by side under the title card) and `"outro": [...]` (the end scene, after the last line), and the commands take `--greeting "text"` (typed under the title), `--end-text "row one|row two"` (typed in the end scene, with confetti) and `--tail <sec>` (holds the end scene after the song over silence, with a short audio fade so the song does not click off). Check the library in this style with `node scripts/drawing_sheet.mjs /abs/path/library.png --paper`. In either style, `drawings.json` can hold `"rows": { "9": { "शरीर": null, "बीमार": "sick" } }` to override words for one row (numbered from 1), where `null` gives that word no drawing.

**Whole verses (karaoke screens):** add `--verses lyrics.txt` to the contact-sheet and final commands, where blank rows in the lyrics file separate verses. The aligner ignores blank rows, so the existing alignment is reused; the script stops if the file's lyric rows do not match the alignment. Each verse is shown on one screen: lines still to come are faint outlines, sung lines are dimmed, and the current line slams in word by word and kicks on the beat. Each screen appears up to 1.2 seconds before its first line and gets its own palette. The lyric band grows, so bars and drawings shrink to 80%. Each line stays on one row when it fits; type runs 40–110 px (56–130 px for Shorts). A verse that would go below the minimum splits automatically into the fewest even screens, and the script prints the screens and their sizes. Without blank rows, the whole song counts as one verse and is split into screens the same way. Works with both styles and with `--vertical`.

**Green screen (lyrics only):** add `--green` to the contact-sheet and final commands for a flat chroma-key background (#00B140) with no title card, graphics or colour wipes. Text uses fixed solid colours with no transparency and nothing green, so it keys cleanly: the current line is white with a thick maroon edge and a gold sung word, sung lines are cream with the same edge, and upcoming lines are maroon with a thin cream edge. The edges keep it readable over bright footage without a panel. With `--verses`, the lyric band grows to the top of the lower three-quarters, so verses of about 6 lines fit on one screen. Not combinable with `--style sketch` or `--drawings`.

**Lyrics over the user's own video:** add `--background clip.mp4` to the contact-sheet and final commands. Lyrics are drawn on a transparent canvas and composited straight onto the clip, which is scaled to fill the frame and looped, with no title card, graphics or chroma key. With `--verses`, each screen sits on a rounded dark panel so it reads over bright footage. Prefer this to keying a `--green` render, which loses the thin outlines and shifts the colours. Use only footage the user owns or may use.

**Fitting lyrics into part of the picture:** `--text-box x,y,w,h` keeps every screen inside that rectangle (for example an archway in the background), and `--screen-lines N` caps the lines per screen so a narrow box gets larger type. Measure the box on a gridded frame of the actual background.

**Long lines:** a line wraps onto two rows when that gives type at least 25% larger (`WRAP_GAIN` in scene.js). For Shorts of songs with long lines (more than about 22 characters), use `--screen-lines 1`: one wrapped line per screen gives about 80–126 px type, where 2 lines per screen gives about 40–60 px.

**Background from a still image:** `node scripts/background.mjs --image pic.png --duration <song seconds> --out bg.mp4` makes a 30 fps background with original drawn blossoms and sparkles drifting over the still. The image never moves, so a `--text-box` stays aligned. `--zoom 1.3 --focus-y 0.85` enlarges it about a point (0 top, 1 bottom); `--still <sec> --out frame.png` renders one frame for measuring. Combine with a `--green` render by keying (`chromakey=0x00AE3D:0.12:0.05`), which stays clean thanks to the dark outlines.

**Devotional bhajan videos** (dawn journey, diyas, aarti thali, jaikara rings over a temple or gate still) now have their own skill in this plugin, `devotional-bhajan-video`.

**YouTube Shorts:** when the user asks for Shorts, add `--vertical --from <sec> --to <sec> --fade 0.8` to the contact-sheet and final commands, using the alignment and beats of the full song. This is the only exception to landscape output: 1080x1920 at 30 fps, with content kept 120 px from the sides, 220 px from the top and 420 px from the bottom, clear of the Shorts controls. Keep each clip under 59 seconds. Start just before a line begins and end just after a line that completes a thought, and do not cut mid-line. Contact sheets show that clip's lines only. Title cards appear only before the song's first line, so clips normally have none.

**1080p for a big screen:** add `--hd` to the contact-sheet and final commands to get 1920x1080. The same layout and safe area are drawn at 1.5x, so this is not an upscale. A `--background` video should also be 1920x1080. Landscape only.

**Overwriting:** `align.py`, `beats.py` and `render.mjs` refuse to replace an existing file. Ask the user first, and pass `--overwrite` only after they agree.

## Render settings

| Setting | Value |
|---|---|
| Frame | 1280x720 landscape, 30 fps |
| Video | H.264 High, yuv420p, CRF 18, BT.709 |
| Audio | The song's original audio, AAC 192 kbps |
| Safe area | Text and key graphics stay 64 px from left and right and 40 px from the top; the bottom 90 px holds only the background colour |
| Lyrics | Lower third, bottom-centre, Poppins ExtraBold (OFL); 1 or 2 rows, whichever gives the bigger type, up to 170 px; lines over about 32 characters wrap, with 3 rows as the limit |
| Word timing | Each word lands at its aligned start, turns the accent colour while sung, then settles to white |
| Beat motion | The sung line and the graphics kick on each detected beat, scaled by that beat's strength |
| Line changes | A colour wipe at each new line; no full-frame flashing |

## Known limits

- Word timing was measured with a spoken Hindi voice over synthesized music, not real singing. Check the scores and the first real result closely, especially for long held notes and loud arrangements.
- Beat accuracy was measured on synthesized drum patterns. Songs with no steady pulse, such as free-time alaap, will not get meaningful kicks.
- Words are animated as whole words, because splitting Devanagari mid-word breaks conjuncts and matras.
- Audio stays lossy: the MP3 is decoded and re-encoded to AAC, with no other change.

## Files

- `setup.sh`: installs and checks dependencies.
- `scripts/align.py`: romanizes the lyrics and runs MMS_FA forced alignment.
- `scripts/beats.py`: finds the tempo, beats and audio levels using only NumPy.
- `scripts/scene.js`: the canvas scene, the layout and the safe-area check.
- `scripts/drawings.js`: the library of original morphable drawings.
- `scripts/sketch.js`: the sketchbook style (pencil tracing, colour sweep, typed lyrics).
- `scripts/drawing_sheet.mjs`: draws the whole library on one labelled sheet.
- `scripts/render.mjs`: contact sheet and final encode.
