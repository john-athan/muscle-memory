#!/bin/sh
# Every check this extension has. Run it directly, through `oss check
# muscle-memory`, or from CI, which calls this file and nothing else, one part
# per job:
#   tools/validate.sh              both parts
#   tools/validate.sh extension    the extension itself (needs node)
#   tools/validate.sh icons        the icon generator (needs cargo)
#
# The checks every extension in the fleet shares live in tools/webext.mjs,
# which oss-kit owns; what is particular to this one is in webext.json and
# below.
set -eu
cd "$(dirname "$0")/.."

parts="${*:-extension icons}"
fail=0
step() { printf '\n== %s\n' "$1"; }

for part in $parts; do
  case "$part" in
    extension)
      node tools/webext.mjs validate || fail=1

      # Every file the extension loads, checked against what is on disk. A path
      # renamed in src/ but not in the manifest, or a stylesheet the options page
      # links and nobody ships, fails silently at load time and is the one break
      # a user cannot diagnose.
      step "every referenced file exists"
      node scripts/check-assets.mjs || fail=1

      step "the tests"
      node --test "test/**/*.test.js" || fail=1

      # Builds the store package and checks it against the store's own limits,
      # so a rejection is found here rather than after a multi-day review.
      step "the package really contains what it claims"
      node tools/webext.mjs package || fail=1
      ;;
    icons)
      # The PNGs are committed so that loading the extension needs no
      # toolchain. That is only safe if they cannot drift from the generator.
      # The toolchain is pinned in tools/icons/rust-toolchain.toml so a codegen
      # change cannot move a pixel; --locked checks against pinned dependencies;
      # `git status` rather than `git diff` so a new size shows up as untracked.
      step "icon generator: fmt and clippy"
      (cd tools/icons && cargo fmt --check && cargo clippy --locked -- -D warnings) || fail=1
      step "the committed icons are what the generator produces"
      (cd tools/icons && cargo run --locked --release) || fail=1
      if [ -n "$(git status --porcelain -- icons)" ]; then
        echo "FAILED: the generator's output no longer matches the committed icons."
        echo "After a dependency or toolchain bump: regenerate, look at them, commit."
        git status --porcelain -- icons
        fail=1
      else
        echo "ok"
      fi
      ;;
    *) echo "unknown part: $part (extension, icons)"; exit 2 ;;
  esac
done

if [ "$fail" -ne 0 ]; then printf '\nvalidate: FAILED\n'; exit 1; fi
printf '\nvalidate: everything passes\n'
