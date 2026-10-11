#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT"
fail() { echo "Build refused: $*" >&2; exit 1; }
MODE=${1:-}
[[ $# -le 1 && ( -z "$MODE" || "$MODE" == --frontend-only ) ]] || fail 'Usage: ./build.sh [--frontend-only]'
for tool in node npm; do command -v "$tool" >/dev/null || fail "Missing $tool; provision Node 22.20.0 and npm."; done
[[ $(node --version) == v22.20.0 ]] || fail 'Use Node 22.20.0 on PATH.'
[[ -f app/package-lock.json && -f app/node_modules/vite/bin/vite.js ]] || fail 'Run npm --prefix app ci first (requires separate execution approval).'
node scripts/check_worker.mjs
if [[ "$MODE" == --frontend-only ]]; then
  node scripts/stage_web.mjs stage
else
  PYTHON_BIN=${PYTHON:-python3}
  command -v "$PYTHON_BIN" >/dev/null || fail 'Missing Python; use Python 3.14.4 (or set PYTHON).'
  INPUTS=$(node scripts/stage_web.mjs inputs)
  mkdir -p engine/doom/build/m4b-runs
  RUN=$(mktemp -d "$ROOT/engine/doom/build/m4b-runs/run.XXXXXX")
  "$PYTHON_BIN" scripts/build_doom.py --profile controlled-title --jobs 2 --timeout 120 \
    --out "$RUN/engine" --node "$(command -v node)" \
    --wasi-sdk "${WASI_SDK:-$ROOT/tools/wasi-sdk-24.0}" \
    --binaryen-bin "${BINARYEN_BIN:-$ROOT/tools/binaryen-119/bin}"
  node scripts/stage_web.mjs stage "$RUN/engine" "$INPUTS"
fi
npm --prefix app run build
echo 'Static app ready: app/dist/ (no IWAD).'
