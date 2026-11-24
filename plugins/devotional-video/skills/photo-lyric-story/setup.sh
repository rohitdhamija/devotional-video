#!/bin/bash
# Idempotent setup: runs the kinetic-lyrics setup (ffmpeg, Node, shared Python venv, puppeteer and fonts) and links
# the shared node_modules, because this skill renders lyrics with kinetic-lyrics and photos with the same headless Chrome.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
KINETIC="$SKILL_DIR/../kinetic-lyrics"
[ -d "$KINETIC" ] || { echo "photo-lyric-story needs the kinetic-lyrics skill next to it" >&2; exit 1; }
bash "$KINETIC/setup.sh"
command -v sips >/dev/null || { echo "photo-lyric-story needs macOS (sips reads HEIC and the photo rotation)" >&2; exit 1; }
TOOLS="${VIDEO_TOOLS_HOME:-$HOME/.claude/video-tools}"
VENV="${VIDEO_ENV:-$TOOLS/venv}"
[ -e "$SKILL_DIR/node_modules" ] || ln -s "$TOOLS/node/node_modules" "$SKILL_DIR/node_modules"
echo "photo-lyric-story ready (python: $VENV/bin/python)"
