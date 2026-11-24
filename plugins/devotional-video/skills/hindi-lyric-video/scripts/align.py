#!/usr/bin/env python3
"""Forced-align Devanagari lyrics to a song with torchaudio MMS_FA. Writes word timings as JSON."""
import argparse
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np
import torch
import torchaudio

CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
}
NUKTA = {"क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f"}
VOWELS = {
    "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri", "ए": "e", "ऐ": "ai",
    "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e", "ॐ": "om",
}
MATRAS = {
    "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
    "ॉ": "o", "ॅ": "e",
}
HALANT, NUKTA_SIGN = "्", "़"
NASALS = {"ं": "n", "ँ": "n", "ः": "h"}
PUNCTUATION = re.compile(r"[।॥,.;:!?\"'“”‘’()\[\]{}…\-–—]")


def romanize(word):
    """Devanagari word to the a-z alphabet MMS_FA expects, with Hindi schwa deletion."""
    word = PUNCTUATION.sub("", unicodedata.normalize("NFC", word))
    units = []  # [text, kind]: kind is "C" consonant, "V" vowel, "a" deletable schwa, "x" other
    i = 0
    while i < len(word):
        ch = word[i]
        if ch in CONSONANTS:
            nukta = i + 1 < len(word) and word[i + 1] == NUKTA_SIGN
            sound = NUKTA.get(ch, CONSONANTS[ch]) if nukta else CONSONANTS[ch]
            i += 2 if nukta else 1
            units.append([sound, "C"])
            following = word[i] if i < len(word) else ""
            if following == HALANT:
                i += 1
            elif following in MATRAS:
                units.append([MATRAS[following], "V"])
                i += 1
            else:
                units.append(["a", "a"])
        elif ch in VOWELS:
            units.append([VOWELS[ch], "V"])
            i += 1
        elif ch in NASALS:
            units.append([NASALS[ch], "x"])
            i += 1
        elif ch.isascii() and ch.isalpha():
            units.append([ch.lower(), "x"])
            i += 1
        else:
            raise ValueError(f"cannot romanize {ch!r} in {word!r}; spell numbers and symbols out as words")

    if not units:
        return ""
    is_vowel = lambda u: u[1] in ("V", "a")
    if units[-1][1] == "a" and sum(is_vowel(u) for u in units) > 1 and not (len(units) > 2 and units[-3][1] == "C"):
        units.pop()
    for k in range(len(units) - 3, 1, -1):  # V C [a] C V: the medial schwa is not spoken
        if (units[k][1] == "a" and units[k - 1][1] == "C" and is_vowel(units[k - 2])
                and units[k + 1][1] == "C" and is_vowel(units[k + 2])):
            units.pop(k)
    return "".join(u[0] for u in units)


def parse_lyrics(path):
    """One sung line per row; blank rows are ignored. Danda-only tokens stay on the previous word."""
    lines = []
    for row in Path(path).read_text(encoding="utf-8").splitlines():
        words = []
        for token in row.split():
            roman = romanize(token)
            if roman:
                words.append({"text": token, "roman": roman})
            elif words:
                words[-1]["text"] += " " + token
        if words:
            lines.append({"text": " ".join(w["text"] for w in words), "words": words})
    if not lines:
        sys.exit(f"no lyric lines found in {path}")
    return lines


def load_audio(path, rate):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return torch.from_numpy(np.frombuffer(raw, dtype=np.float32).copy())


def emissions(model, wave, rate, chunk_s=30, context_s=1):
    """Run the model in overlapping chunks so long songs fit in memory."""
    chunk, context = chunk_s * rate, context_s * rate
    frames = []
    with torch.inference_mode():
        for start in range(0, len(wave), chunk):
            left = max(0, start - context)
            piece = wave[left:start + chunk + context]
            out = model(piece.unsqueeze(0))[0][0]
            ratio = out.shape[0] / len(piece)  # frames per sample
            skip = round((start - left) * ratio)
            keep = round((min(start + chunk, len(wave)) - start) * ratio)
            frames.append(out[skip:skip + keep])
    return torch.cat(frames)


def parse_sections(spec, count):
    """'1-8:0-61,9-12:93-122' means rows 1-8 are sung between 0 s and 61 s, and so on."""
    sections = []
    for part in spec.split(","):
        rows, times = part.split(":")
        first, last = map(int, rows.split("-"))
        start, end = map(float, times.split("-"))
        sections.append((first - 1, last, start, end))
    covered = [i for first, last, _, _ in sections for i in range(first, last)]
    if covered != list(range(count)):
        sys.exit(f"--sections must cover rows 1-{count} once each, in order")
    return sections


def align(wave, lines, rate, wildcard, sections=None):
    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model(with_star=True).eval()
    tokenizer, aligner = bundle.get_tokenizer(), bundle.get_aligner()
    emission = emissions(model, wave, rate)
    seconds_per_frame = len(wave) / rate / emission.shape[0]

    for first, last, start, end in sections or [(0, len(lines), 0, len(wave) / rate)]:
        offset = round(start / seconds_per_frame)
        words = [w for line in lines[first:last] for w in line["words"]]
        if wildcard:  # a * token between lines absorbs instrumental passages
            sequence, index = ["*"], []
            for line in lines[first:last]:
                for word in line["words"]:
                    index.append(len(sequence))
                    sequence.append(word["roman"])
                sequence.append("*")
        else:
            sequence, index = [w["roman"] for w in words], list(range(len(words)))

        spans = aligner(emission[offset:round(end / seconds_per_frame)], tokenizer(sequence))
        for word, i in zip(words, index):
            s = spans[i]
            word["start"] = round((s[0].start + offset) * seconds_per_frame, 3)
            word["end"] = round((s[-1].end + offset) * seconds_per_frame, 3)
            frames = sum(t.end - t.start for t in s)
            word["score"] = round(sum(t.score * (t.end - t.start) for t in s) / frames, 3)
    for line in lines:
        line["start"], line["end"] = line["words"][0]["start"], line["words"][-1]["end"]
        line["score"] = round(float(np.mean([w["score"] for w in line["words"]])), 3)
    return lines


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--audio", required=True, help="song used for the final audio")
    ap.add_argument("--lyrics", required=True, help="UTF-8 text, one sung line per row")
    ap.add_argument("--out", required=True)
    ap.add_argument("--vocals", help="isolated vocal stem to align against instead of the full mix")
    ap.add_argument("--no-wildcard", action="store_true", help="do not insert * tokens between lines")
    ap.add_argument("--sections", help="limit rows to time ranges, e.g. 1-8:0-61,9-12:93-122")
    ap.add_argument("--low-score", type=float, default=0.6, help="flag lines scoring below this")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()

    if Path(args.out).exists() and not args.overwrite:
        sys.exit(f"{args.out} exists; ask the user, then pass --overwrite")

    rate = torchaudio.pipelines.MMS_FA.sample_rate
    wave = load_audio(args.vocals or args.audio, rate)
    lines = parse_lyrics(args.lyrics)
    sections = parse_sections(args.sections, len(lines)) if args.sections else None
    lines = align(wave, lines, rate, not args.no_wildcard, sections)
    flagged = [i + 1 for i, line in enumerate(lines) if line["score"] < args.low_score]
    result = {
        "audio": str(Path(args.audio).resolve()),
        "duration": round(len(wave) / rate, 3),
        "method": "torchaudio MMS_FA" + (" on vocal stem" if args.vocals else " on full mix"),
        "low_confidence_lines": flagged,
        "lines": lines,
    }
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    for i, line in enumerate(lines, 1):
        print(f"{i:3d} {line['start']:8.2f} {line['end']:8.2f}  score {line['score']:.2f}  {line['text']}")
    if flagged:
        print(f"LOW CONFIDENCE lines: {flagged}")


if __name__ == "__main__":
    main()
