#!/bin/bash
# Measuring frames for scene.json and --text-box: the image at zoom 1 on the 1280x720 frame, with a 40 px grid,
# plus 2x/3x zoomed crops of the lower-left wall (niches) and the arch centre.
# Usage: bash grid.sh <image> <out-dir>
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"; IMG="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
cd "$SKILL_DIR/../kinetic-lyrics"
node scripts/background.mjs --image "$IMG" --zoom 1 --flowers 0 --still 0.01 --out "$OUT/plain.png" --overwrite >/dev/null
ffmpeg -v error -y -i "$OUT/plain.png" -vf "drawgrid=w=40:h=40:t=1:c=red@0.4" "$OUT/grid.png"
ffmpeg -v error -y -i "$OUT/plain.png" -vf "crop=640:300:0:420,scale=1280:600,drawgrid=w=40:h=40:t=1:c=red@0.5" "$OUT/zoom_lower_left_2x.png"
ffmpeg -v error -y -i "$OUT/plain.png" -vf "crop=420:300:430:300,scale=1260:900,drawgrid=w=60:h=60:t=1:c=red@0.5" "$OUT/zoom_centre_3x.png"
echo "grid: $OUT/grid.png (40 px cells)"
echo "zoom_lower_left_2x.png: frame = (x/2, 420 + y/2) ; zoom_centre_3x.png: frame = (430 + x/3, 300 + y/3)"
