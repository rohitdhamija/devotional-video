# devotional-video — Claude Code plugin

Turn a **bhajan MP3**, its **Devanagari lyrics** and **one still image of a temple or gate** into a finished devotional lyric video:

- Night turns to sunrise behind the temple: stars, blue hour, the sun rising behind the dome, light rays in the arch
- Diyas flicker in the niches, incense smoke rises, marigolds and rose petals fall
- Every word is timed by forced alignment (never guessed); a gold ring of light spreads on every sung **जय**, and an aarti thali circles the lyrics on **आरती** lines
- 1280x720 main video, **3 YouTube Shorts** (1080x1920, under 59 s, starting and ending on whole verses), a **thumbnail**, and a `youtube_details.txt` with titles, description, chapters and tags

Everything is drawn in code over your own image. No stock footage, no image generators.

## Install

In Claude Code:

```
/plugin marketplace add rohitdhamija/devotional-video
/plugin install devotional-video@devotional-video
```

## Use

```
/devotional-bhajan-video song.mp3 lyrics.txt gate.png
```

Lyrics: UTF-8, one sung line per row, blank rows between verses, repeated lines written out each time they are sung.
Image: landscape, with a **blue sky** and an arch the lyrics can sit in.

Claude stops for your approval at a contact sheet before each final render, and asks you when the lyrics don't match what is sung. It never edits your lyrics file.

The plugin also includes `/kinetic-lyrics` (beat-synced kinetic typography for any song).

## Requirements

- macOS with [Homebrew](https://brew.sh) (ffmpeg, Node and Python are installed automatically if missing). On Linux, install `ffmpeg`, `nodejs` and Python 3.10–3.13 yourself.
- About 4 GB free disk for PyTorch, demucs and headless Chrome. The first run downloads them into `~/.claude/video-tools` (set `VIDEO_TOOLS_HOME` to change it, or `VIDEO_ENV` to reuse an existing venv with torch/torchaudio 2.8).
- A 5-minute song takes roughly 10–20 minutes end to end on an Apple-silicon Mac (CPU only).

## Your content

Use only songs, lyrics and images you own or have permission to use. The plugin does not upload anything; all processing is local.

## License

MIT — see [LICENSE](LICENSE).
