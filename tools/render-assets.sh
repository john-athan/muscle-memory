#!/usr/bin/env bash
# Render every binary asset of an extension from its source in meta/.
#
# This file is owned by oss-kit and identical in every extension. Which html
# or svg becomes which png at which size is declared in webext.json under
# "render", so a difference between extensions is a fact in one config file
# rather than a fork of this script.
#
# The renderer is the browser the extension targets, which is already installed,
# already colour manages the way the store will show the result, and removes the
# need for a design tool or an image library in the dependency list.
#
#   tools/render-assets.sh            # everything webext.json declares
#   tools/render-assets.sh icons      # just the toolbar icons
#   tools/render-assets.sh store-icon # just the padded 128 store icon
#   tools/render-assets.sh <group>    # one group of pages, e.g. promo or shots
#
# webext.json "render":
#   icons      [{ "from": "meta/icon.svg", "sizes": [48, 128] }, ...]
#              svg -> icons/icon<size>.png, drawn into a transparent square.
#   iconCommand  a command that makes the icons instead, run from the repo
#              root (muscle-memory draws them with its own Rust crate).
#   storeIcon  { "from": "meta/icon.svg", "inset": 16 }, written to the path
#              webext.json "storeIcon" names. The store wants 96 px of artwork
#              in a 128 px frame: the console draws its own shadow and
#              rounding in the 16 px margin, and a full bleed icon gets clipped.
#   pages      [{ "group": "shots", "from": "meta/shot-1.html",
#                 "to": "screenshots/store-1.png", "size": [1280, 800] }, ...]
#              html -> png at that window size, on an opaque white page, or
#              on a transparent one when the entry says "transparent": true
#              (a store icon built as html rather than svg).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Node reads the config because it is already required and a shell has no JSON.
# One tab separated line per job: kind, source, target, width, height, inset,
# background.
JOBS="$(node -e '
  const c = JSON.parse(require("fs").readFileSync("webext.json", "utf8"));
  const r = c.render ?? {};
  const out = [];
  if (r.iconCommand) out.push(["iconCommand", r.iconCommand, "", "", "", "", ""]);
  else for (const i of r.icons ?? []) for (const s of i.sizes) out.push(["icon", i.from, `src/icons/icon${s}.png`, s, s, 0, "transparent"]);
  if (r.storeIcon) out.push(["store-icon", r.storeIcon.from, c.storeIcon, 128, 128, r.storeIcon.inset ?? 16, "transparent"]);
  for (const p of r.pages ?? []) out.push([p.group, p.from, p.to, p.size[0], p.size[1], 0, p.transparent ? "transparent" : "opaque"]);
  for (const j of out) console.log(j.join("\t"));
')"

want="${1:-all}"
known="all icons $(printf '%s\n' "$JOBS" | cut -f1 | sort -u | tr '\n' ' ')"
case " $known " in *" $want "*) ;; *) echo "usage: $0 [all|icons|store-icon|<group>]  (known here: $known)" >&2; exit 2 ;; esac

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || true)"
[ -n "$CHROME" ] && [ -x "$CHROME" ] || { echo "no Chrome binary found; set CHROME=" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

shoot() { # shoot <html> <out.png> <w> <h> <transparent|opaque>
  local bg="00000000"
  [ "$5" = "opaque" ] && bg="ffffffff"
  mkdir -p "$(dirname "$2")"
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 \
    --default-background-color="$bg" \
    --window-size="$3,$4" \
    --screenshot="$2" "file://$1" >/dev/null 2>&1
  [ -s "$2" ] || { echo "render failed: $2" >&2; exit 1; }
}

wrap() { # wrap <svg> <size> <inset> -> html that paints it at that size
  local art=$(($2 - 2 * $3))
  local out="$WORK/wrap-$2-$3-$(basename "$1" .svg).html"
  {
    printf '<meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}'
    printf 'body{width:%spx;height:%spx;display:grid;place-items:center}' "$2" "$2"
    printf 'svg{display:block;width:%spx;height:%spx}</style>' "$art" "$art"
    cat "$1"
  } > "$out"
  echo "$out"
}

while IFS=$'\t' read -r kind from to w h inset bg; do
  [ -n "$kind" ] || continue
  case "$want" in all|"$kind") ;; icons) [ "$kind" = icon ] || [ "$kind" = iconCommand ] || continue ;; *) continue ;; esac
  case "$kind" in
    iconCommand) sh -c "$from" ;;
    icon|store-icon) shoot "$(wrap "$ROOT/$from" "$w" "$inset")" "$ROOT/$to" "$w" "$h" "$bg" ;;
    *) shoot "$ROOT/$from" "$ROOT/$to" "$w" "$h" "$bg" ;;
  esac
  echo "$kind: ${to:-$from}"
done <<< "$JOBS"
