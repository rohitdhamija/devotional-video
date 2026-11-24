---
name: hindi-lyric-video
description: Turns a Hindi song MP3 and its Devanagari lyrics (one sung line per row) into a calm old-paper lyric video with an ink-wash scene and words that darken as they are sung. Use when the user runs /hindi-lyric-video or asks for a Hindi or Devanagari lyric video.
argument-hint: <song.mp3> <lyrics.txt> [title] [artist]
---

# Hindi lyric video

**Input:** a Hindi song MP3 and a UTF-8 lyrics file with one sung line per row. Repeated lines must be written out each time they are sung, because the aligner follows the file in order.

**Output:** a 1280x720 MP4 on procedurally drawn old paper. An original ink-wash landscape sits above the lyrics: the sun crosses the page once over the song and a small boat drifts along the river. The lyrics sit in the lower third, centred.

Everything is drawn in code. Use no stock footage or image generators. Use only songs and lyrics the user owns or is allowed to use, and do not add copyrighted characters, scenes or logos.

`SKILL` below means this skill's folder, `${CLAUDE_SKILL_DIR}`. `P` means the Python printed by `setup.sh` (default `~/.claude/video-tools/venv/bin/python`). Put outputs next to the song unless the user names another folder.

## Method

1. **Set up.** Run `SKILL/setup.sh`. It runs the kinetic-lyrics setup, which checks ffmpeg and Node, installs them if missing, and prepares the shared venv and renderer packages under `~/.claude/video-tools`. The first run downloads PyTorch and Chrome, a few GB, and takes several minutes.

2. **Check the lyrics.** Numbers and symbols must be spelled out as words, because the aligner rejects them. Do not edit the user's wording without asking.

3. **Align.** Never guess timing.
   ```bash
   $P SKILL/scripts/align.py --audio song.mp3 --lyrics lyrics.txt --out alignment.json
   ```
   - Add `--vocals stem.wav` to align against an isolated vocal stem while keeping the full song as the final audio.
   - **Read the scores.** Correct lyrics scored 0.83–0.90 per line on the test sample, and deliberately wrong lyrics scored 0.22–0.34. If any line is listed under `LOW CONFIDENCE` (below 0.6), stop and show those lines to the user. Likely causes are wrong lyrics, a line sung more times than it is written, or music too loud over the voice. Suggest correcting the lyrics or supplying a vocal stem.
   - **Repeating chants and mantras need extra care.** Identical rows can land on the wrong repeat, and real chanting scored only 0.2–0.4 even where the timing looked right, so a low score alone does not prove it wrong, and a tidy result does not prove it right. Confirm the repeat count with the user. Look for the rhythm in the line starts, then use `--sections "1-8:0-61,9-12:93-122"` to keep rows inside the time ranges where they are sung, down to one row per window if needed. Use the sections to restrict the search; the timing must still come from the aligner. Tell the user which rows remain weak.
   - **Vocal stems:** if needed, run `$P -m pip install demucs`, then `$P -m demucs --two-stems vocals -n htdemucs -d cpu -o <dir> song.mp3`. Compare it with the full mix, because a stem can make some rows worse.

4. **Show the contact sheet and wait.** Do not start the final render until the user approves it.
   ```bash
   cd SKILL && node scripts/render.mjs --align alignment.json --title "शीर्षक" --artist "कलाकार" --contact-sheet /abs/path/contact_sheet.png
   ```
   This draws 6 stills: the intro, mid-word moments across the song, and the longest instrumental gap if it runs over 6 seconds. Open the sheet for the user with `open`. The script stops with an error if any lyric row, the title or the artist leaves the safe area or runs past about 32 characters. If that happens, ask the user how to split the line.

5. **Render the final video** after approval, with the same `--title` and `--artist`.
   ```bash
   cd SKILL && node scripts/render.mjs --align alignment.json --audio song.mp3 --title "शीर्षक" --artist "कलाकार" --out /abs/path/video.mp4
   ```
   For a long song, run this in the background.

6. **Verify and report.** Use `ffprobe` to confirm the settings below, and check that the video and audio durations match. Give the user the file path and the timing scores.

**Lyrics strip for overlays:** add `--strip` to the contact-sheet and final commands to draw only a paper band of lyrics on solid green (`#00B140`), still 1280x720. The band closes during gaps over 6 seconds. In iMovie, put the clip above the footage and choose **Green/Blue Screen** under Video Overlay Settings.

**Text only at the top:** add `--text-top` to draw just the lyrics at the top of the frame on solid green, with no paper. Text is cream with a dark outline so it reads on any footage, and the current word turns saffron. Use only when the user asks for it, because captions default to bottom-centre. Key it out the same way as the strip.

**Text only at the bottom:** add `--text-bottom` for the same text-only look at bottom-centre, above the empty bottom 90 px.

**Next-line preview:** add `--no-preview` to hide the faint upcoming line, for example when every row of a chant is identical.

**Overwriting:** `align.py` and `render.mjs` refuse to replace an existing file. Ask the user first, and pass `--overwrite` only after they agree.

## Render settings

| Setting | Value |
|---|---|
| Frame | 1280x720 landscape, 30 fps |
| Video | H.264 High, yuv420p, CRF 18, BT.709 |
| Audio | The song's original audio, AAC 192 kbps |
| Safe area | Text and key graphics stay 64 px from left and right and 40 px from the top; the bottom 90 px holds only paper texture |
| Lyrics | Bottom-centre, Tiro Devanagari Hindi (OFL), 52 px; lines over about 32 characters wrap to 2 rows, or 3 rows at 42 px |
| Word timing | Unsung words are pale ink, the current word turns vermilion, and sung words settle to dark ink |
| Upcoming line | Shown faintly below the current line when it starts within 8 seconds |
| Long gaps | A faint `॥` appears during instrumental passages |

## Known limits

- Timing accuracy was measured with a spoken Hindi voice over synthesized music, not real singing. Check the scores and the first real result closely, especially for long held notes, heavy ornamentation and loud arrangements.
- Words are highlighted as whole words, because splitting Devanagari mid-word breaks conjuncts and matras.
- Audio stays lossy: the MP3 is decoded and re-encoded to AAC, with no other change.

## Files

- `setup.sh`: runs the kinetic-lyrics setup and links the shared `node_modules`.
- `scripts/align.py`: romanizes Devanagari and runs MMS_FA forced alignment.
- `scripts/scene.js`: the old-paper canvas scene and the safe-area check.
- `scripts/render.mjs`: contact sheet and final encode.
