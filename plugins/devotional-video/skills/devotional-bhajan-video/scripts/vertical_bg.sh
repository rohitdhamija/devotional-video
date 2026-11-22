#!/bin/bash
# Shorts background: the landscape devotional background as a sharp, feathered band (1.267x, centre-cropped to
# 1080 wide, top at y=240) over a blurred cover-fill of the same video. Output 1080x1920, 30 fps.
# Lyrics then go below the band: --text-box 120,1185,840,315 (inside the Shorts safe area).
# Usage: bash vertical_bg.sh <landscape_bg.mp4> <out.mp4> [--overwrite]
set -euo pipefail
IN="$1"; OUT="$2"
[ -e "$OUT" ] && [ "${3:-}" != "--overwrite" ] && { echo "$OUT exists; ask the user, then pass --overwrite" >&2; exit 2; }
MASK="$(mktemp -d)/bandmask.png"
ffmpeg -v error -y -f lavfi -i "color=black:s=1080x912,format=gray" -vf "geq=lum='255*min(1\,min(Y/60\,(911-Y)/60))'" -frames:v 1 "$MASK"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
ffmpeg -v error -y -i "$IN" -loop 1 -i "$MASK" -filter_complex \
  "[0:v]split[a][b];[a]scale=3414:1920,crop=1080:1920,boxblur=28:2,eq=brightness=-0.06:saturation=1.1[bg];[b]scale=1622:912:flags=lanczos,crop=1080:912[band];[1:v]format=gray,scale=1080:912[m];[band][m]alphamerge[bandA];[bg][bandA]overlay=0:240:shortest=1,format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -preset medium -crf 18 -profile:v high -colorspace bt709 -color_primaries bt709 -color_trc bt709 -t "$DUR" "$OUT"
echo "$OUT: $(ffprobe -v error -show_entries stream=width,height,duration -of csv=p=0 "$OUT")"
