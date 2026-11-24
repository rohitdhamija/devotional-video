---
name: photo-lyric-story
description: Turns a folder of photos, a song MP3 and its lyrics into a landscape photo-story video. Each photo is matched to the lyric line it fits, moves with a slow pan or zoom, changes on the beat, and bold kinetic words slam in as they are sung. Use when the user runs /photo-lyric-story or asks for a photo slideshow, montage or tribute video with lyrics, such as for a wedding, birthday or farewell.
argument-hint: <images-folder> <song.mp3> <lyrics.txt> [title] [end text]
---

# Photo lyric story

**Input:** a folder of photos (JPEG, PNG, WebP or HEIC, portrait or landscape), a song MP3, and a UTF-8 lyrics file with one sung line per row. Repeated lines must be written out each time they are sung.

**Output:** a 1280x720 MP4, or 1920x1080 with `--hd` for a big screen such as a wedding projector. Photos are shown in an order that tells the story of the lyrics. Each one drifts with a slow zoom or pan, and cuts land on detected beats. Portraits appear as tilted cards over a blurred copy of themselves. Words slam into the lower third as they are sung, using kinetic-lyrics. There is an optional title card at the start and an end card, such as two names with a heart, over the final photo.

Use only the user's own photos and songs. Do not add stock footage, generated images, or copyrighted characters or logos.

`SKILL` means this skill's folder, `${CLAUDE_SKILL_DIR}`. `KINETIC` means `${CLAUDE_SKILL_DIR}/../kinetic-lyrics`, the sibling skill in this plugin, whose alignment, beat detection and lyric renderer this skill reuses. Put working files in `<project>/work/` and the final video next to the song, unless the user names another folder.

## Method

1. **Set up.** Run `SKILL/setup.sh`. It runs the kinetic-lyrics setup (ffmpeg, Node, the shared venv and puppeteer under `~/.claude/video-tools`) and links the shared `node_modules`. It needs macOS, for `sips`.

2. **Prepare the photos.**
   ```bash
   bash SKILL/scripts/prepare.sh <images-folder> <work>
   ```
   This writes render copies to `work/photos/` (at most 2400 px, never enlarged), previews to `work/previews/`, and `work/photos.json` with each photo's upright shape. HEIC files become `<name>-heic.jpg`. Do not assume two files with the same base name are duplicates: look at both.

3. **Align the words and detect the beats.** Follow kinetic-lyrics steps 2 to 4, with outputs in `work/`. If lines come back `LOW CONFIDENCE`, retry against a demucs vocal stem with `--vocals`. If both runs agree on the word times to within about 0.1 s, keep the full-mix result and tell the user which lines to check in the test clip. If they disagree, stop and show the user those lines.

4. **Look at every photo and write the story.** Open each preview with Read. Note who is in it (the main person alone, with family, with a partner), the mood and setting, and where the faces are, as fractions of the width and height. Then write `work/story.json`:
   - **Shape the story.** Usually it goes from the main person alone, to friends and family, to the big moment. Match each photo to the meaning of its lyric line: a photo of someone mid-air for "hawa mein", a friend pointing at the main person when the lyric names them, the whole family for "baraat saji". The photo the user names as final goes last.
   - **Pick the energy.** Calm intro or emotional lines get `fade`, and memories get `fade` too. Chorus and punchy lines get `push` or `zoom`, plus `"pulse": true`. A last chorus can be a montage with a cut every 2 beats. Use `flash` once, for the reveal.
   - **Keep faces clear.** Set `focus` to the faces. They are placed at 36% of the frame height, above the lyric band. A group whose faces run low needs a larger `zoom`, or it should be used only briefly.
   - **Reusing photos.** Reuse a photo only with a clearly different framing (wide first, then tight), or in a recap montage.
   - **Timing.** Aim for one photo per lyric line, or one per two lines when a line is short.
   - **Notes.** Write a `why` for every shot, so the plan can be explained to the user.

5. **Show the storyboard and wait.**
   ```bash
   node SKILL/scripts/slideshow.mjs --story work/story.json --align work/alignment.json --beats work/beats.json --photos work/photos --storyboard work/storyboard.png
   ```
   This prints the shot table: cut time, length, transition, fit, move, photo and lyric line. It also writes one labelled still per shot. Fix any cropped heads or awkward cards before going on. Open the sheet for the user and summarise the story in a few lines.

6. **Render the photo track.** This takes about 30 s per minute of song.
   ```bash
   node SKILL/scripts/slideshow.mjs --story work/story.json --align work/alignment.json --beats work/beats.json --photos work/photos --out work/photos_track.mp4
   ```

7. **Lyric contact sheet, test clip and approval.** Run from `KINETIC`, passing `--tail` with the story's `tail` value:
   ```bash
   node scripts/render.mjs --align work/alignment.json --beats work/beats.json --background work/photos_track.mp4 --text-box 64,452,1152,178 --tail 4 --contact-sheet /abs/work/contact_sheet.png
   node scripts/render.mjs ... --audio song.mp3 --from 43 --to 58 --out /abs/work/test_clip.mp4
   ```
   Choose a test section that covers the busiest part, usually the last chorus, and any low-confidence lines. Open both for the user. Do not render the final video until the user approves.

8. **Final render and checks.** Run the same command without `--from` and `--to`, with `--out <project>/<name>.mp4`.
   - **1080p for a big screen:** add `--hd` to the `slideshow.mjs --out` command, writing `work/photos_track_1080.mp4`. Then add `--hd` to the `render.mjs` command and point its `--background` at that track. Both draw the same layout at 1.5x, so a 1080p version matches the approved 720p one. It is not an upscale. Use `ffprobe` to confirm the settings below, and check that the video and audio durations match: song plus tail. Report the file path, the shot count, the BPM and any lines that were flagged.

## story.json

```json
{
  "title": "Rahul Ki Baraat",
  "end": { "text": "Rahul ♥ Priya", "at": 62.0 },
  "tail": 4,
  "shots": [
    { "photo": "river.jpg", "move": "in", "focus": [0.39, 0.3], "why": "opening, under the title" },
    { "line": 6, "photo": "family8.jpg", "transition": "push", "move": "right", "focus": [0.55, 0.38], "pulse": true },
    { "line": 18, "beats": 2, "photo": "family5.jpg", "transition": "cut" },
    { "line": 23, "photo": "couple.jpg", "transition": "flash", "zoom": [1.0, 1.1], "focus": [0.53, 0.5] }
  ]
}
```

| Field | Meaning |
|---|---|
| `title` | Slams into the lyric band before the first sung line, with gold sparkles. Leave it out for no title card. |
| `end.text` | Shown at the top over the last shot, with sparkles. `♥` is drawn as a heart. `at` defaults to 1.5 s after the last cut. |
| `tail` | Seconds of extra hold after the song ends. The audio fades out. |
| `line` / `beats` | The cut lands on the beat nearest the start of that lyric row (1-based). `beats: n` cuts n beats after the row starts. `at: <sec>` gives an exact time instead. The first shot always starts at 0. |
| `transition` | How this shot comes in. `fade` is 2 beats, `push` and `zoom` are 1 beat, `flash` is 1.5 beats (a soft warm flash, never full white), and `cut` is instant. The middle of the transition is on the beat. `dir: "right"` reverses a push. |
| `move` | `in`, `out`, `left`, `right` or `still`. `zoom: [from, to]` overrides the zoom amount. |
| `focus` / `focusTo` | The point to keep in frame, as a fraction of the photo, with (0, 0) at the top left. `focusTo` drifts the camera across the shot. |
| `fit` | `cover` fills the frame. `card` is the default for portraits. Use `cover` with a focus for a close-up of a portrait. |
| `pulse` | The photo kicks slightly on each beat. |

The script refuses a story where any photo is on screen alone for less than 0.8 s.

## Render settings

| Setting | Value |
|---|---|
| Frame | 1280x720 landscape, 30 fps. With `--hd`, 1920x1080, with the same layout drawn at 1.5x |
| Video | H.264 High, yuv420p, CRF 18, BT.709. The photo track is an intermediate at CRF 10. |
| Audio | The song's original audio, AAC 192 kbps |
| Safe area | Lyrics, title, end text and cards stay 64 px from left and right, 40 px from the top, and above the bottom 90 px. Photos fill the frame edge to edge. |
| Lyrics | kinetic-lyrics overlay inside `--text-box 64,452,1152,178`, over a dark gradient scrim. Words slam in as they are sung and kick on beats. |
| Photos | Ken Burns zoom or pan on every shot, cuts snapped to the beat within 0.3 s, vignette and lower scrim |

## Known limits

- Faces are placed from the focus points written in the story. There is no automatic face detection, so check the storyboard.
- Photo shape comes from Chrome, which applies the camera's EXIF rotation. `prepare.sh` copies keep the EXIF tag, so do not open them in tools that ignore it.
- `prepare.sh` uses macOS `sips` for HEIC.
- A photo smaller than the output width gets soft when zoomed: 1280 px, or 1920 px with `--hd`. Keep its `zoom` at or below 1.1 and ask the user for a larger original if it is a hero shot.

## Files

- `setup.sh`: runs the kinetic-lyrics setup and links the shared `node_modules`.
- `scripts/prepare.sh`: makes render copies, previews and `photos.json`.
- `scripts/exif_orientation.py`: reads a JPEG's EXIF orientation.
- `scripts/slideshow.mjs`: checks the story, snaps cuts to beats, and renders the storyboard and photo track.
- `scripts/story.js`: the canvas scene, with photo moves, transitions, title, end card and sparkles.
