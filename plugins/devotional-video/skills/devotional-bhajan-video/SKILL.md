---
name: devotional-bhajan-video
description: Turns a bhajan MP3, its Devanagari lyrics and one still image of a temple or gate into a full devotional lyric video. Night turns to sunrise behind the temple, diyas flicker in the niches, marigolds fall, a gold light ring spreads on every sung "जय", and an aarti thali circles the words on "आरती" lines. Lyrics sit inside the arch. Also makes 3 YouTube Shorts, a thumbnail and a YouTube details file. Use when the user runs /devotional-bhajan-video or asks for a bhajan, aarti, kirtan or satsang lyric video over a temple or gate image.
argument-hint: <song.mp3> <lyrics.txt> <gate-image.png>
---

# Devotional bhajan video

**Input:** a bhajan MP3, a UTF-8 lyrics file (Devanagari, one sung line per row, blank rows between verses), and one still image of a temple or gate. The image should be landscape and should show an arch the lyrics can sit in.

**Output** (next to the song unless the user names another folder):

| File | What |
|---|---|
| `<name>_devotional.mp4` | 1280x720, 30 fps, original audio. Verse screens, one line at a time, inside the arch, over the animated scene |
| `short1_…mp4`, `short2_…mp4`, `short3_…mp4` | 1080x1920 Shorts under 59 s, each starting and ending on whole lines |
| `thumbnail_sunrise.png` (+ one alternative) | 1280x720 YouTube thumbnail |
| `youtube_details.txt` | titles, description, chapters, tags, settings and a schedule for the main video and each Short |

**What the scene does**, all drawn in code over the user's still. The still never moves, so the text box stays aligned.

- **Amrit vela journey.** The sky starts at night with stars, moves through blue hour, and reaches sunrise and then morning. The sky is replaced through a colour-keyed sky mask. The sun rises behind the temple dome and stays hidden by anything that isn't sky. Light rays and gold dust appear in the arch at sunrise.
- **Lamps and smoke.** Diyas flicker in the wall niches and on the pillar ledges, with warm light pools and soft lamp uplight on the gate at night. The temple doors glow, and incense smoke rises.
- **Falling flowers.** Marigolds and rose petals fall, lamp-lit at night and in full colour by day.
- **Driven by the lyrics** (word times come from forced alignment, never guessed):
  - A gold ring of light spreads from the dome on every sung word containing `pulseKeyword` (default `जय`), and the diyas flare with it.
  - A lit aarti thali circles the lyric box during lines containing `aartiKeyword` (default `आरती`), one turn every 4 beats.

Use only songs, lyrics and images the user owns or may use. Use no stock footage or image generators. If the image may be AI-made, don't describe it as a real named mandir in the metadata.

`SKILL` means this skill's folder, `${CLAUDE_SKILL_DIR}`. `KINETIC` means `${CLAUDE_SKILL_DIR}/../kinetic-lyrics`, the sibling skill in this plugin, whose aligner, beat detector and lyric renderer this skill reuses. `P` means the Python printed by `setup.sh` (default `~/.claude/video-tools/venv/bin/python`). Put working files (stems, logs, alignment) in the song's folder.

## Method

1. **Set up.** Run `bash SKILL/setup.sh`. It runs the kinetic-lyrics setup, links the shared `node_modules`, and adds demucs to the shared venv. The first run downloads PyTorch, demucs and Chrome (a few GB).

2. **Vocal stem and beats.**
   ```bash
   $P -m demucs --two-stems vocals -n htdemucs -d cpu -o stems song.mp3
   $P -I KINETIC/scripts/beats.py --audio song.mp3 --out beats.json
   ```

3. **Align the lyrics.** Run against both the full mix and the vocal stem, then compare. The stem is usually better for bhajans with harmonium and chorus.
   ```bash
   $P -I KINETIC/scripts/align.py --audio song.mp3 --lyrics lyrics.txt --out alignment-mix.json
   $P -I KINETIC/scripts/align.py --audio stems/htdemucs/<song>/vocals.wav --lyrics lyrics.txt --out alignment-vocals.json
   ```
   How to read the result (learned on a 5-minute aarti with harmonium and chorus):
   - **Low scores on repeated lines.** Chorus answers often score 0.0–0.4 while the lead copy scores 0.7 or more. If the voice is present (check a loudness strip of `vocals.wav`) and the lines fall on the song's steady line grid, usually 2 bars = 8 beats, the timing is fine. Tell the user which lines to spot-check.
   - **A line squeezed under 1 s, or several lines crammed into a short tail.** The text has lines that aren't sung. Find how many lines the sung time can hold (sung seconds ÷ line spacing). Try removing each candidate line, and keep the version that scores best. Pin the search with `--sections "1-58:0-257,59-61:255-281.5"`. If no version fits, **stop** and cut the ending (`ffmpeg -ss <t> … check_ending.m4a`) for the user to listen to, then ask what is sung there.
   - **Lyric fixes.** Never change the user's lyrics file. Write fixes and removed lines to `<name>_video.txt`, keeping the blank rows between verses, and list every change for the user.
   - Use the stem alignment as `alignment.json` unless the mix alignment is clearly better.

4. **Measure the image.** Run `bash SKILL/scripts/grid.sh gate.png <scratch>`. Read `grid.png` and the two zoomed crops (the script prints how to map crop pixels back to frame pixels). Then write `scene.json`, starting from `SKILL/examples/aarti_scene.json`:

   | Field | Meaning |
   |---|---|
   | `zoom` | Keep at 1, so the whole gate is visible. Zooming in (for example 1.3) cuts off the top of the gate. |
   | `horizon` | Lowest y of sky seen through the arch. The sky mask is cut below it. |
   | `timeline` | `[[sec, stage]]`, where stage 0 is night, 1 blue hour, 2 sunrise and 3 morning. Scale the Aarti values to the song length: 0→0, 9%→0.15, 39%→1, 68%→2, 89%→3. |
   | `dome` | Centre of the jaikara rings: the temple dome or the main shrine. |
   | `sun` | `x`, start `y0` (below the horizon) and end `y1` (just under the arch apex), and radius `r`. |
   | `arch` | Opening `x0`, `x1`, `spring` (where the curve starts), `top` (apex) and `bottom`. Rays and dust stay inside it. |
   | `niches` | Flame points on top of the lamps in the wall niches. |
   | `ledges` | Rows of clay diyas on the pillar plinths. |
   | `smoke` | Incense stick positions. |
   | `templeLights` | `[x, y, radius]` warm glows on the temple doors and windows at night. |
   | `aarti` | Centre and radii of the thali's circle around the lyric box. |
   | `pulseKeyword`, `aartiKeyword` | Change them for other bhajans, for example `जय` or `नमः` and `आरती` or `ज्योत`. |

   The lyric `--text-box` is the arch opening, kept inside the safe area. For the example scene it is `462,385,362,245`.

5. **Test stills, then the full background.** Render stills across the journey and check them at full size: the sky mask edges, flames sitting on the lamps, the sun inside the arch, and sunrise not over-saturated. Fix `scene.json` and repeat. Then render the full background. It takes about 2 minutes for a 5-minute song.
   ```bash
   cd SKILL && node scripts/devotional.mjs --image gate.png --scene scene.json --align alignment.json --beats beats.json --still 8,45,150,200,265 --out /abs/scratch/s.png
   node scripts/devotional.mjs --image gate.png --scene scene.json --align alignment.json --beats beats.json --duration <song sec> --out /abs/devotional_background.mp4
   ```

6. **Contact sheet, approval, final render.** Run from `KINETIC`:
   ```bash
   node scripts/render.mjs --align A --beats B --verses <name>_video.txt --background devotional_background.mp4 --no-panel --text-box 462,385,362,245 --screen-lines 1 --contact-sheet /abs/contact_sheet_devotional.png
   node scripts/render.mjs … --audio song.mp3 --out /abs/<name>_devotional.mp4
   ```
   - Show the contact sheet first, and wait for approval before the final render.
   - `--screen-lines 1` keeps type at 42–72 px in the small arch. Two lines per screen drops to about 34 px.
   - Check the final with `ffprobe`: 1280x720, 30 fps, and video duration equal to audio duration. Grab frames during an आरती line and a जय line to confirm the thali and the rings.

7. **Shorts.**
   ```bash
   python3 SKILL/scripts/timings.py alignment.json <name>_video.txt --keyword आरती
   bash SKILL/scripts/vertical_bg.sh devotional_background.mp4 shorts_background_vertical.mp4
   ```
   - `timings.py` prints chapters and Shorts windows. Each window starts 0.5 s before a verse with the keyword and ends on a verse boundary under 58 s. Prefer three windows in different light (night, blue hour, sunrise).
   - Render each window from `KINETIC` with `--vertical --fade 0.8 --background shorts_background_vertical.mp4 --no-panel --text-box 120,1185,840,315 --screen-lines 1 --from <t0> --to <t1>`. Do contact sheets first, then the `--out` renders.
   - Name the Shorts after their first line, for example `short1_pehli_seedhi_aarti_pooja.mp4`.

8. **Thumbnail.**
   ```bash
   cd SKILL && node scripts/thumbnail.mjs --bg devotional_background.mp4 --at <sunrise sec> --title "आरती पूजा" --sub "गुरुमुख की पहचान" --tag "अमृत वेला भजन" --out /abs/thumbnail_sunrise.png
   ```
   Make one at sunrise (stage about 2.2) and one in the morning, and recommend the sunrise one.

9. **`youtube_details.txt`.** Write it in this format:
   - **Files:** each file with its length and song range.
   - **Schedule:** the main video on a Sunday at 5:30 AM IST, and the Shorts on Monday, Wednesday and Friday at 6:30 AM, after anything the user already has scheduled (ask, or check other `youtube_details.txt` files in their folders).
   - **Main video:** 3 titles under about 70 characters, then a description with a lyric hook, credits left as `____`, chapters from `timings.py` with the first at 0:00, and hashtags. Then tags under 500 characters, settings, and a before-publishing checklist that lists every lyric change.
   - **Each Short:** a title, its lyrics, `[FULL VIDEO LINK]`, `#Shorts`, tags and a thumbnail frame time.
   - Ask the user for their channel or sangat name, playlist and credits, and use the same branding in every title and hashtag. Don't invent a mandir, guru or organisation name.

## Render settings

| Setting | Value |
|---|---|
| Main video | 1280x720, 30 fps, H.264 High yuv420p, CRF 18, BT.709, original audio as AAC |
| Shorts | 1080x1920, 30 fps, under 59 s, 0.8 s fades, text 120 px from the sides, 220 px from the top and 420 px from the bottom |
| Safe area (landscape) | Lyrics 64 px from the sides and 40 px from the top, with the bottom 90 px clear. The arch box sits well inside this. |
| Lyric style | kinetic-lyrics `--no-panel`: cream text with a thick maroon edge and a gold sung word, one line per screen |

## Known limits

- The sky mask keys on blue (`b - r > 22`). A grey, white or sunset sky in the source image won't be replaced. Ask for a blue-sky image.
- Positions are measured by hand from the grid, so check the test stills at full size.
- Upcoming lyric lines are dark maroon, which is faint on the night sky. That's fine with one line per screen.
- The dawn is paced by `timeline`, not by the lyrics. If the user wants sunrise on a particular line, set that line's start time as the stage-2 keyframe.

## Files

- `setup.sh`: kinetic-lyrics setup, the shared `node_modules` link, and demucs.
- `scripts/devotional.mjs`: the animated scene (dawn, diyas, smoke, marigolds, rays, rings, thali). Use `--still t1,t2` for test frames.
- `scripts/grid.sh`: measuring grid and zoomed crops for `scene.json`.
- `scripts/vertical_bg.sh`: the Shorts background, with a sharp gate band over a blurred fill.
- `scripts/thumbnail.mjs`: the YouTube thumbnail from a background frame.
- `scripts/timings.py`: line timings, chapters and Shorts windows.
- `examples/aarti_scene.json`: a measured scene for a 1736x906 ivory gate image with a central arch, a dome and six wall niches. Use it as a starting point only; every position must be re-measured for a new image.
