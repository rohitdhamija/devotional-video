#!/bin/bash
# Idempotent setup: runs the kinetic-lyrics setup (ffmpeg, Node, shared Python venv, puppeteer and fonts,
# including Tiro Devanagari Hindi) and links the shared node_modules here.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
KINETIC="$SKILL_DIR/../kinetic-lyrics"
[ -d "$KINETIC" ] || { echo "hindi-lyric-video needs the kinetic-lyrics skill next to it" >&2; exit 1; }
bash "$KINETIC/setup.sh"
TOOLS="${VIDEO_TOOLS_HOME:-$HOME/.claude/video-tools}"
VENV="${VIDEO_ENV:-$TOOLS/venv}"
[ -e "$SKILL_DIR/node_modules" ] || ln -s "$TOOLS/node/node_modules" "$SKILL_DIR/node_modules"
echo "hindi-lyric-video ready (python: $VENV/bin/python)"
