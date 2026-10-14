#!/usr/bin/env bash
set -euo pipefail
# Foreground terminal cancellation only; no process-tree supervisor.
trap 'exit 130' INT
trap 'exit 143' TERM
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
  mkdir -p engine/doom/build/m4b-runs
  RUN=$(mktemp -d "$ROOT/engine/doom/build/m4b-runs/run.XXXXXX")
  OUT="$RUN/engine"
  ADMISSION=$(node scripts/build_engine.mjs admit "$OUT" \
    "${WASI_SDK:-$ROOT/tools/wasi-sdk-24.0}" \
    "${BINARYEN_BIN:-$ROOT/tools/binaryen-119/bin}")
  IFS=$'\t' read -r TOKEN SDK BINARYEN <<< "$ADMISSION"
  # Admission canonicalizes paths. Keep inherited Make/compiler flags and secrets out.
  if env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C TZ=UTC \
    TMPDIR="$OUT/tmp" BINARYEN_CORES=2 \
    /usr/bin/make -C "$ROOT/engine/doom" -rR -j2 VERBOSE=1 \
    BUILD_PROFILE=controlled-title A1_FIXTURES=1 LOCAL_ADMITTED=1 \
    OUTPUT_DIR="$OUT" LOCAL_WASI_SDK="$SDK" LOCAL_BINARYEN_BIN="$BINARYEN" local-build; then
    printf '%s\n' "$TOKEN" > "$OUT/evidence/make-pass"
    node scripts/build_engine.mjs closeout "$OUT" "$TOKEN"
  else
    exit "$?"
  fi
  node scripts/stage_web.mjs stage "$OUT"
fi
npm --prefix app run build
echo 'Static app ready: app/dist/ (no IWAD).'
