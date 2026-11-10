#!/usr/bin/env bash
# MontHangar studio setup. Safe to re-run. Installs only into the studio folder, plus Playwright's Chromium in its usual place.
# Studio: $MONTHANGAR_HOME, else ~/MontHangarStudio.
# Windows: run this in Git Bash (see the README).
set -e
if [ -n "$MONTHANGAR_HOME" ]; then S="$MONTHANGAR_HOME"; else S="$HOME/MontHangarStudio"; fi
mkdir -p "$S/projects" "$S/library/aviation"; cd "$S"
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing. Mac: brew install ffmpeg   Windows: winget install Gyan.FFmpeg"; exit 1; }
command -v node >/dev/null || { echo "Node.js 18+ is missing. Install it from https://nodejs.org"; exit 1; }
command -v uv >/dev/null || { echo "uv is missing. Mac: curl -LsSf https://astral.sh/uv/install.sh | sh   Windows: winget install astral-sh.uv"; exit 1; }
if [ ! -e .venv ]; then uv venv --python 3.12 .venv; fi
if [ -f .venv/Scripts/python.exe ] && [ ! -e .venv/bin/python ]; then mkdir -p .venv/bin; printf '#!/bin/sh\nexec "$(dirname "$0")/../Scripts/python.exe" "$@"\n' > .venv/bin/python; chmod +x .venv/bin/python; fi
PY=.venv/bin/python; [ -f .venv/Scripts/python.exe ] && PY=.venv/Scripts/python.exe
uv pip install --python "$PY" numpy scipy pillow opencv-python-headless faster-whisper requests
if [ ! -f package.json ]; then
cat > package.json <<'J'
{ "name": "monthangar-studio", "version": "1.0.0", "private": true, "license": "MIT",
  "dependencies": { "three": "0.186.1", "playwright": "1.49.1", "@fontsource/barlow-condensed": "5.2.6", "@fontsource/inter": "5.2.8" } }
J
fi
npm install --no-audit --no-fund >/dev/null
npx playwright install chromium
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "$HERE/core/tools/mh" 2>/dev/null || true
echo "ready: $S"
echo "check it: $HERE/core/tools/mh check"
