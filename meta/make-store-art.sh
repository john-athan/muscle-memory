#!/bin/sh
# Render the Chrome Web Store artwork from the HTML in this directory.
#
# The listing artwork is built from the same tokens as the extension, so the
# store page and the product are recognisably one thing, and so a change to
# the design is one edit rather than a trip through an image editor.
#
# ui-keys.png and ui-popup.png are real captures of the extension's own
# interface, taken at 2x and embedded by shot-2 and shot-3. Recapture them
# when the interface changes.
#
# The listing icon is built here rather than by tools/icons because it carries
# the ⇧⌘R keycap, and that is type. The Rust generator draws geometry only, so
# that its output is identical on any machine; this one is marketing artwork
# and is allowed to depend on a system font.
#
#   sh meta/make-store-art.sh
#
# Needs Google Chrome. Output lands in screenshots/.
set -eu

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
here=$(cd "$(dirname "$0")" && pwd)
out=$(cd "$here/.." && pwd)/screenshots
mkdir -p "$out"

shot() { # file, width, height, output
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --window-size="$2,$3" --screenshot="$out/$4" "file://$here/$1" 2>/dev/null
  echo "wrote screenshots/$4 ($2x$3)"
}

# The icon needs a transparent canvas, which is not the default.
transparent_shot() { # file, size, output
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 \
    --window-size="$2,$2" --screenshot="$out/$3" "file://$here/$1" 2>/dev/null
  echo "wrote screenshots/$3 (${2}x${2}, transparent)"
}

transparent_shot store-icon.html 128 store-icon.png
shot promo-small.html   440  280 store-promo-small.png
shot promo-marquee.html 1400 560 store-promo-marquee.png
shot shot-1.html        1280 800 store-1-problem.png
shot shot-2.html        1280 800 store-2-keys.png
shot shot-3.html        1280 800 store-3-popup.png
