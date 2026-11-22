#!/bin/bash
# Idempotent setup: runs the kinetic-lyrics setup (ffmpeg, Node, shared Python venv, puppeteer and fonts),
# links the shared node_modules here, and adds demucs (vocal stem) to the venv.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
KINETIC="$SKILL_DIR/../kinetic-lyrics"
[ -d "$KINETIC" ] || { echo "devotional-bhajan-video needs the kinetic-lyrics skill next to it" >&2; exit 1; }
bash "$KINETIC/setup.sh"
TOOLS="${VIDEO_TOOLS_HOME:-$HOME/.claude/video-tools}"
VENV="${VIDEO_ENV:-$TOOLS/venv}"
[ -e "$SKILL_DIR/node_modules" ] || ln -s "$TOOLS/node/node_modules" "$SKILL_DIR/node_modules"
"$VENV/bin/python" -c "import demucs" 2>/dev/null || "$VENV/bin/pip" install --quiet demucs
echo "devotional-bhajan-video ready (python: $VENV/bin/python)"
