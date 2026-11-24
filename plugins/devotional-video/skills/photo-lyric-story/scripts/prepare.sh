#!/bin/bash
# prepare.sh <images_dir> <work_dir>
# Makes JPEG copies of every photo (HEIC included) for rendering, at most 2400 px on the long edge and never enlarged,
# plus 1000 px previews to look at while planning. sips keeps the camera's EXIF rotation tag rather than applying it;
# Chrome applies it when drawing, so the shape reported here is the upright shape. Writes <work_dir>/photos.json with each photo's
# size and shape. JPEGs keep their name; other formats get the extension added (single.HEIC -> single-heic.jpg).
set -euo pipefail
IN="$1"; OUT="$2"
mkdir -p "$OUT/photos" "$OUT/previews"
echo "[" > "$OUT/photos.json"; first=1
find "$IN" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.heic' -o -iname '*.webp' \) | sort | while read -r src; do
  file="$(basename "$src")"; base="${file%.*}"; ext="$(echo "${file##*.}" | tr 'A-Z' 'a-z')"
  case "$ext" in jpg|jpeg) name="$base.jpg" ;; *) name="$base-$ext.jpg" ;; esac
  long=$(sips -g pixelWidth -g pixelHeight "$src" | awk '/pixel/{if ($2>m) m=$2} END{print m}')
  sips -s format jpeg -s formatOptions 92 $([ "$long" -gt 2400 ] && echo -Z 2400) "$src" --out "$OUT/photos/$name" >/dev/null
  sips -s format jpeg -s formatOptions 80 $([ "$long" -gt 1000 ] && echo -Z 1000) "$src" --out "$OUT/previews/$name" >/dev/null
  w=$(sips -g pixelWidth "$OUT/photos/$name" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$OUT/photos/$name" | awk '/pixelHeight/{print $2}')
  # EXIF orientations 5-8 turn the picture a quarter, so width and height swap.
  [ "$(python3 "$(dirname "$0")/exif_orientation.py" "$OUT/photos/$name")" -ge 5 ] && { t=$w; w=$h; h=$t; }
  shape=landscape; [ "$h" -gt "$w" ] && shape=portrait
  [ $first -eq 1 ] && first=0 || echo "," >> "$OUT/photos.json"
  printf '  {"photo": "%s", "source": "%s", "width": %s, "height": %s, "shape": "%s"}' "$name" "$file" "$w" "$h" "$shape" >> "$OUT/photos.json"
  echo "$name  ${w}x${h}  $shape  (from $file)"
done
echo "]" >> "$OUT/photos.json"
