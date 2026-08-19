#!/bin/sh
# Recapture meta/ui-keys.png from the options page itself.
#
# The screenshot embedded in the store artwork is the real interface, so it
# goes stale the moment a rule is added. This renders src/options.html in
# headless Chrome against meta/ui-shim.js, which stands in for chrome.storage
# with an empty profile, and photographs it at 2x.
#
#   sh meta/capture-ui.sh && sh meta/make-store-art.sh
#
# Needs Google Chrome.
set -eu

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp "$root"/src/*.js "$root"/src/*.css "$work/"
cp "$here/ui-shim.js" "$work/"
# Two splices into a copy of the page, never into the page itself. The shim
# has to run before any of the extension's own scripts, so it goes ahead of
# the first one. The stylesheet after it drops the wordmark and tagline: the
# artwork already carries the name, and those 230 pixels are the difference
# between the frame showing three rules and showing five.
sed -e 's|<script src="keymap.js"></script>|<script src="ui-shim.js"></script><script src="keymap.js"></script>|' \
    -e 's|<link rel="stylesheet" href="options.css">|<link rel="stylesheet" href="options.css"><style>.wordmark,.tagline{display:none}</style>|' \
  "$root/src/options.html" > "$work/options.html"

# 434 is not arbitrary: it ends the frame on the divider below the ⌘D row.
# A pixel more and the next rule is sliced through the middle of its label,
# which reads as a botched export rather than as a list that continues.
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=740,434 \
  --screenshot="$here/ui-keys.png" "file://$work/options.html" 2>/dev/null

echo "wrote meta/ui-keys.png ($(sips -g pixelWidth -g pixelHeight "$here/ui-keys.png" | tail -2 | tr -d ' \n'))"
