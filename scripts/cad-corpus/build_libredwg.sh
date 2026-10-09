#!/usr/bin/env bash
# Build NATIVE LibreDWG (dxf2dwg, dwg2dxf, dwgread) outside the repository.
# @mlightcad/libredwg-web has no DWG writer, so the DWG corpus needs the real C tools.
# Pinned: LibreDWG release tag 0.13.3 (commit below) plus patches/libredwg-0.13.3-layer-flags.patch, which makes
# dxf2dwg write the layer frozen/off/locked flags (unpatched 0.13.3 writes flag0 = 0, losing them). Output prefix:
#   ${XDG_CACHE_HOME:-~/.cache}/mep-libredwg/install/bin
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAG="${LIBREDWG_TAG:-0.13.3}"
SHA="${LIBREDWG_SHA:-97c7225596c17430b82fd0161e7eff6beb5b1034}"
ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/mep-libredwg"
SRC="$ROOT/src"
PREFIX="$ROOT/install"
mkdir -p "$ROOT"
if [ ! -d "$SRC/.git" ]; then
  git clone https://github.com/LibreDWG/libredwg "$SRC"
fi
git -C "$SRC" fetch --tags --quiet || true
git -C "$SRC" checkout --quiet "$SHA"
test "$(git -C "$SRC" rev-parse HEAD)" = "$SHA" || { echo "checkout is not $SHA" >&2; exit 1; }
PATCH="$SCRIPT_DIR/patches/libredwg-0.13.3-layer-flags.patch"
PATCH_SHA="$(sha256sum "$PATCH" | cut -d' ' -f1)"
if [ ! -x "$PREFIX/bin/dxf2dwg" ] || [ "$(cat "$PREFIX/.patch-sha256" 2>/dev/null)" != "$PATCH_SHA" ]; then
  cd "$SRC"
  git checkout --quiet -- .
  git apply "$PATCH"
  if [ ! -f Makefile ]; then
    git submodule update --init --quiet 2>/dev/null || true
    ./autogen.sh
    EXTRA=()
    command -v makeinfo >/dev/null 2>&1 || EXTRA+=(--disable-docs)
    ./configure --prefix="$PREFIX" --disable-bindings --disable-python --disable-shared "${EXTRA[@]}"
  fi
  make -j"$(nproc)" -C src
  make -j"$(nproc)" -C programs dxf2dwg dwg2dxf dwgread
  mkdir -p "$PREFIX/bin"
  cp programs/dxf2dwg programs/dwg2dxf programs/dwgread "$PREFIX/bin/"
  echo "$PATCH_SHA" > "$PREFIX/.patch-sha256"
fi
echo "LibreDWG tag $TAG commit $SHA + layer-flags patch $PATCH_SHA"
for t in dxf2dwg dwg2dxf dwgread; do "$PREFIX/bin/$t" --version | head -1; done
echo "export PATH=$PREFIX/bin:\$PATH   # or set LIBREDWG_BIN=$PREFIX/bin"
