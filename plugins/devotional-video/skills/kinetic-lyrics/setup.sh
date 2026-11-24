#!/bin/bash
# Idempotent setup for the devotional-video plugin's lyric tools.
# - checks ffmpeg, Node and Python (installs them with Homebrew on macOS if missing)
# - builds a shared Python venv (torch/torchaudio for word alignment, NumPy for beats)
# - installs puppeteer and the Poppins and Tiro Devanagari fonts into a shared folder and links it here
# Shared tools live outside the plugin, so plugin updates don't re-download them:
#   VIDEO_TOOLS_HOME  default ~/.claude/video-tools
#   VIDEO_ENV         default $VIDEO_TOOLS_HOME/venv (point it at an existing venv to reuse one)
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLS="${VIDEO_TOOLS_HOME:-$HOME/.claude/video-tools}"
VENV="${VIDEO_ENV:-$TOOLS/venv}"
mkdir -p "$TOOLS"

need() { command -v "$1" >/dev/null; }
install() {
  if need brew; then brew install "$2"
  else echo "Missing '$1'. Install it (e.g. 'sudo apt install $3') and run setup again." >&2; exit 1; fi
}
need ffmpeg || install ffmpeg ffmpeg ffmpeg
need node   || install node node nodejs
PY=""
for c in python3.12 python3.11 python3.13 python3; do
  if need "$c" && "$c" -c 'import sys; sys.exit(not (3,10) <= sys.version_info[:2] <= (3,13))'; then PY="$c"; break; fi
done
[ -n "$PY" ] || { install python3.11 python@3.11 python3.11; PY=python3.11; }

[ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
"$VENV/bin/python" -c "import torch, torchaudio, numpy" 2>/dev/null || {
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet "torch==2.8.*" "torchaudio==2.8.*" numpy
}

NODE_DIR="$TOOLS/node"
mkdir -p "$NODE_DIR"
cp "$SKILL_DIR/package.json" "$SKILL_DIR/package-lock.json" "$NODE_DIR/"
for d in puppeteer @fontsource/poppins @fontsource/tiro-devanagari-hindi; do [ -d "$NODE_DIR/node_modules/$d" ] || { MISSING=1; break; }; done
[ -z "${MISSING:-}" ] || \
  (cd "$NODE_DIR" && npm install --cache "$NODE_DIR/.npm-cache" --no-fund --no-audit && rm -rf "$NODE_DIR/.npm-cache")
[ -e "$SKILL_DIR/node_modules" ] || ln -s "$NODE_DIR/node_modules" "$SKILL_DIR/node_modules"

echo "python: $VENV/bin/python"
echo "ready: $("$VENV/bin/python" -c 'import torch, torchaudio; print("torch", torch.__version__, "torchaudio", torchaudio.__version__)')"
