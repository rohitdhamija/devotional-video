#!/usr/bin/env python3
"""Find a song's tempo and beats with dynamic programming over spectral flux. Also writes audio levels for the bars."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

RATE = 22050
N_FFT = 1024
HOP = 256
FPS = 30
BARS = 28
FRAME_RATE = RATE / HOP
MIN_PULSE = 0.2  # measured: drum patterns 0.83-0.89, real songs 0.25-0.36, unpulsed pads 0.05-0.17


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def power_spectrogram(wave):
    window = np.hanning(N_FFT)
    # Pad by half a window so frame i is centred on sample i * HOP.
    padded = np.pad(wave, N_FFT // 2)
    count = max(1, (len(padded) - N_FFT) // HOP + 1)
    rows = [np.abs(np.fft.rfft(padded[i * HOP:i * HOP + N_FFT] * window)) ** 2 for i in range(count)]
    return np.array(rows)


def log_bands(power, edges_hz):
    """Sum power into bands; bands narrower than one FFT bin still get their nearest bin."""
    bins = np.minimum(np.round(np.array(edges_hz) * N_FFT / RATE).astype(int), power.shape[1] - 1)
    return np.stack([power[:, lo:max(hi, lo + 1)].sum(axis=1) for lo, hi in zip(bins[:-1], bins[1:])], axis=1)


def smooth(x, frames):
    kernel = np.hanning(frames + 2)[1:-1]
    return np.convolve(x, kernel / kernel.sum(), mode="same")


def onset_envelope(power):
    bands = log_bands(power, np.geomspace(35, 10000, 41))
    compressed = np.log1p(bands / max(np.percentile(bands, 99), 1e-9) * 1000)
    flux = np.maximum(0, np.diff(compressed, axis=0, prepend=compressed[:1])).sum(axis=1)
    local = smooth(flux, int(FRAME_RATE))  # remove slow loudness changes
    return smooth(np.maximum(0, flux - local), 3)


def autocorrelation(env):
    size = 2 ** int(np.ceil(np.log2(len(env) * 2)))
    centred = env - env.mean()
    ac = np.fft.irfft(np.abs(np.fft.rfft(centred, size)) ** 2)[:len(env)]
    return ac / max(ac[0], 1e-9)


def pulse_at(ac, period):
    """How strongly the onsets repeat at this period: near 1 for a drum machine, near 0 with no pulse."""
    lag = int(round(period))
    return float(ac[max(0, lag - 1):lag + 2].max())


def estimate_period(ac):
    """Autocorrelation weighted towards common tempos. Returns the beat period in frames (not rounded)."""
    low, high = int(60 * FRAME_RATE / 200), int(60 * FRAME_RATE / 55)
    lags = np.arange(low, min(high, len(ac) // 3))
    if len(lags) == 0:
        sys.exit("the song is too short to find a tempo")
    # Reward a lag whose multiples also repeat, and prefer tempos near 110 BPM to settle half/double ambiguity.
    comb = ac[lags] + 0.5 * ac[lags * 2] + 0.25 * ac[lags * 3]
    prior = np.exp(-0.5 * (np.log2(60 * FRAME_RATE / lags / 110) / 0.8) ** 2)
    best = int(np.argmax(comb * prior))
    if 0 < best < len(lags) - 1:  # parabolic refinement between lags
        a, b, c = comb[best - 1], comb[best], comb[best + 1]
        denominator = a - 2 * b + c
        return float(lags[best] + (0.5 * (a - c) / denominator if denominator else 0))
    return float(lags[best])


def track_beats(env, period, tightness=100):
    """Ellis (2007) dynamic programming: favour strong onsets spaced close to one period."""
    norm = env / max(env.std(), 1e-9)
    best, back = norm.copy(), np.full(len(env), -1)
    offsets = np.arange(int(round(period / 2)), int(round(period * 2)) + 1)
    penalty = -tightness * np.log(offsets / period) ** 2
    for i in range(int(round(period / 2)), len(env)):
        valid = offsets <= i
        candidates = best[i - offsets[valid]] + penalty[valid]
        k = int(np.argmax(candidates))
        if candidates[k] > 0:
            best[i] = norm[i] + candidates[k]
            back[i] = i - offsets[valid][k]
    # Start from the strongest score in the last period, then walk back.
    tail = max(0, len(env) - int(period))
    frame = tail + int(np.argmax(best[tail:]))
    beats = []
    while frame >= 0:
        beats.append(frame)
        frame = back[frame]
    return np.array(beats[::-1])


def fill_silence(beats, period, frames):
    """The tracker can break across silence; carry the grid through gaps and out to both ends."""
    grid = []
    for a, b in zip(beats[:-1], beats[1:]):
        grid.append(a)
        steps = int(round((b - a) / period))
        if steps > 1:
            grid.extend(a + (b - a) * k / steps for k in range(1, steps))
    grid.append(beats[-1])
    head = list(np.arange(beats[0] - period, -1, -period))[::-1]
    tail = list(np.arange(beats[-1] + period, frames, period))
    return np.array(head + grid + tail)


def beat_contrast(env, beats):
    """How much stronger onsets are on the beats than halfway between them."""
    at = lambda frames: env[np.clip(np.round(frames).astype(int), 0, len(env) - 1)]
    return float(at(beats).mean() / max(at((beats[:-1] + beats[1:]) / 2).mean(), 1e-9))


def is_half_tempo(env, ac, period, beats):
    """A strong pulse at half the period, with midpoints as strong as beats, means the tempo came out half speed.
    Deliberately strict: songs with busy eighth notes (deepon: half-period pulse 0.39) must not be doubled."""
    half = pulse_at(ac, period / 2)
    return half >= 0.5 and half >= 0.7 * pulse_at(ac, period) and beat_contrast(env, beats) < 1.4


def levels(power, duration):
    """Per-frame bar heights (0-99) at the video frame rate, from loudness relative to each band's own peak."""
    bands = log_bands(power, np.geomspace(50, 8000, BARS + 1))
    db = 10 * np.log10(bands + 1e-10)
    top = np.percentile(db, 99, axis=0)
    scaled = np.clip((db - (top - 40)) / 40, 0, 1)
    frames = int(np.ceil(duration * FPS))
    index = np.minimum(np.round(np.arange(frames) / FPS * FRAME_RATE).astype(int), len(scaled) - 1)
    return np.round(scaled[index] * 99).astype(int).tolist()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--bpm", type=float, help="use this tempo instead of estimating it")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()
    if Path(args.out).exists() and not args.overwrite:
        sys.exit(f"{args.out} exists; ask the user, then pass --overwrite")

    wave = load(args.audio)
    duration = len(wave) / RATE
    power = power_spectrogram(wave)
    env = onset_envelope(power)
    ac = autocorrelation(env)
    period = 60 * FRAME_RATE / args.bpm if args.bpm else estimate_period(ac)
    beats = fill_silence(track_beats(env, period), period, len(env))
    if not args.bpm and 60 * FRAME_RATE / period <= 100 and is_half_tempo(env, ac, period, beats):
        period /= 2
        beats = fill_silence(track_beats(env, period), period, len(env))
    contrast = beat_contrast(env, beats)
    pulse = pulse_at(ac, period)

    strength = env[np.clip(np.round(beats).astype(int), 0, len(env) - 1)]
    strength = np.clip(strength / max(np.percentile(strength, 95), 1e-9), 0, 1) ** 0.5
    times = beats / FRAME_RATE
    bpm = 60 / float(np.polyfit(np.arange(len(times)), times, 1)[0])
    result = {
        "bpm": round(bpm, 2),
        "pulse": round(pulse, 2),
        "contrast": round(contrast, 2),
        "duration": round(duration, 3),
        "fps": FPS,
        "beats": [{"t": round(float(t), 3), "s": round(float(s), 3)} for t, s in zip(times, strength)],
        "levels": levels(power, duration),
    }
    Path(args.out).write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"tempo {bpm:.1f} BPM, {len(beats)} beats, pulse {pulse:.2f}")
    if pulse < MIN_PULSE:
        print(f"LOW BEAT CONFIDENCE: pulse {pulse:.2f} is below {MIN_PULSE}; the kicks may not match the rhythm")


if __name__ == "__main__":
    main()
