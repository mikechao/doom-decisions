#!/usr/bin/env bash
# Explicit setup only; build.sh never invokes this script. macOS Bash 3.2.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C

fail() {
  echo "Toolchain setup refused: $*" >&2
  echo 'Existing installations are never repaired or removed. Inspect an invalid destination and manually move/remove it before retrying install.' >&2
  exit 1
}
[[ $# -eq 1 && ( $1 == install || $1 == verify ) ]] || fail 'Usage: bash scripts/setup_toolchain.sh install|verify'
MODE=$1
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || fail 'Only macOS arm64 is supported.'
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
TOOLS="$ROOT/tools"
[[ ! -L "$TOOLS" ]] || fail "Symlink tools directory: $TOOLS"
WORK=
cleanup() { if [[ -n "$WORK" ]]; then rm -rf -- "$WORK"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

version() {
  local executable=$1 pattern=$2 output
  [[ -f "$executable" && -x "$executable" ]] || fail "Missing executable: $executable"
  output=$("$executable" --version) || fail "Cannot run $executable --version"
  printf '%s\n' "$output" | grep -Eq "$pattern" || fail "Wrong version: $executable: $output"
}

nonempty() {
  [[ -f "$1" && -s "$1" ]] || fail "Missing or empty required file: $1"
}

verify_package() {
  local kind=$1 directory=$2 name
  [[ -d "$directory" && ! -L "$directory" ]] || fail "Missing, non-directory, or symlink destination: $directory"
  if [[ "$kind" == sdk ]]; then
    version "$directory/bin/clang" '^clang version 18\.1\.2-wasi-sdk([[:space:]]|$)'
    version "$directory/bin/wasm-ld" '^LLD 18\.1\.2([[:space:]]|$)'
    version "$directory/bin/llvm-ar" '^[[:space:]]*LLVM version 18\.1\.2(-wasi-sdk)?([[:space:]]|$)'
    for name in include/wasm32-wasi/stdio.h lib/wasm32-wasi/libc.a \
      lib/wasm32-wasi/libm.a lib/wasm32-wasi/crt1-reactor.o; do
      nonempty "$directory/share/wasi-sysroot/$name"
    done
    nonempty "$directory/lib/clang/18/lib/wasi/libclang_rt.builtins-wasm32.a"
    nonempty "$directory/lib/libLLVM.dylib"
  else
    for name in wasm-as wasm-merge wasm-metadce wasm-dis; do
      version "$directory/bin/$name" "^$name version 119([[:space:]]|$)"
    done
    nonempty "$directory/lib/libbinaryen.dylib"
  fi
  echo "Verified: $directory"
}

# Check every existing destination before any download or write.
for kind in sdk binaryen; do
  if [[ "$kind" == sdk ]]; then directory="$TOOLS/wasi-sdk-24.0";
  else directory="$TOOLS/binaryen-119"; fi
  if [[ "$MODE" == verify || -e "$directory" || -L "$directory" ]]; then
    verify_package "$kind" "$directory"
  fi
done
if [[ "$MODE" == verify ]]; then exit 0; fi

install_package() {
  local kind=$1 destination=$2 archive_root=$3 url=$4 bytes=$5 digest=$6
  local entry package link target actual_digest
  [[ ! -e "$destination" && ! -L "$destination" ]] || return 0
  umask 077
  mkdir -p "$TOOLS"
  WORK=$(mktemp -d "$TOOLS/.setup-toolchain.XXXXXX")
  echo "Downloading: $url"
  curl --disable --fail --location --proto '=https' --proto-redir '=https' \
    --output "$WORK/archive.tar.gz" "$url"
  [[ $(stat -f %z "$WORK/archive.tar.gz") == "$bytes" ]] || fail "Archive byte count mismatch: $url"
  actual_digest=$(shasum -a 256 "$WORK/archive.tar.gz")
  [[ ${actual_digest%% *} == "$digest" ]] || fail "Archive SHA-256 mismatch: $url"

  tar -tf "$WORK/archive.tar.gz" > "$WORK/entries"
  while IFS= read -r entry; do
    case "$entry" in
      "$archive_root"|"$archive_root/"*) ;;
      *) fail "Absolute path or unexpected archive root: $entry" ;;
    esac
    case "/$entry/" in */../*) fail "Archive traversal: $entry" ;; esac
  done < "$WORK/entries"
  # Retain bsdtar's default traversal/symlink protections: never use -P or -U.
  mkdir "$WORK/unpacked"
  tar -xf "$WORK/archive.tar.gz" -C "$WORK/unpacked"
  package="$WORK/unpacked/$archive_root"
  [[ -d "$package" && ! -L "$package" ]] || fail "Missing archive directory: $archive_root"
  find "$package" -type l -print > "$WORK/links"
  while IFS= read -r link; do
    [[ "$kind" == sdk ]] || fail "Unexpected Binaryen symlink: $link"
    target=$(readlink "$link")
    # All 30 links in the pinned SDK have relative sibling targets.
    case "$target" in ''|.|..|*/*) fail "Unsafe SDK symlink: $link -> $target" ;; esac
    [[ -e "$link" ]] || fail "Broken SDK symlink: $link"
  done < "$WORK/links"
  verify_package "$kind" "$package"
  [[ ! -e "$destination" && ! -L "$destination" ]] || fail "Destination appeared during setup: $destination"
  # Same-filesystem rename; concurrent installers/builds are not supported.
  mv -n "$package" "$destination"
  [[ ! -e "$package" ]] || fail "Could not place installation: $destination"
  echo "Installed: $destination"
  cleanup
  WORK=
}

# SDK digest independently computed from the official HTTPS release asset;
# Binaryen digest matches its published .sha256 file. Neither is a signed pin.
install_package sdk "$TOOLS/wasi-sdk-24.0" wasi-sdk-24.0-arm64-macos \
  https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-24/wasi-sdk-24.0-arm64-macos.tar.gz \
  108199177 aeae999396d5f5caa5ce419f52e83c35869d5fd21d40af80acba2c80f51b0b3a
install_package binaryen "$TOOLS/binaryen-119" binaryen-version_119 \
  https://github.com/WebAssembly/binaryen/releases/download/version_119/binaryen-version_119-arm64-macos.tar.gz \
  6546962 c12dffafb3e3274026268e90577bd86d98186f7be32457618672f8ca437d8d53
