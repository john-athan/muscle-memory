# ⌘ Muscle Memory

[![CI](https://github.com/john-athan/muscle-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/john-athan/muscle-memory/actions/workflows/ci.yml)

Figma, in a browser, behaving like it knows it is in one.

**[john-athan.github.io/muscle-memory](https://john-athan.github.io/muscle-memory)**

`Cmd+Shift+R` in Figma is **Paste to Replace**. Press it expecting a hard
reload, with a slide selected, and Figma swaps that slide for whatever is on
your clipboard. Chrome never sees the keystroke. Neither does your muscle
memory, which is why it keeps happening.

This extension gives the browser back the chords it owns, and moves the Figma
actions that lose one to the chord you would have guessed.

## What it changes

| Chord | Goes back to the browser | What Figma used it for | Where that moved |
|---|---|---|---|
| `⌘⇧R` | Hard reload | Paste to Replace | `⌘⌥⇧V`, which Figma still ships |
| `⌘R` | Reload | Rename selection | `F2` |
| `⌘F` | Find on the page | Search the file | `⌘⌥F`, and `⌘/` still works |
| `⌘S` | Save the page | nothing at all | nothing to move |
| `⌘P` | Print | nothing confirmed | nothing to move |
| `⌘[` `⌘]` | Back and forward | Send backward, bring forward | `⌘⌥[` and `⌘⌥]` (off by default) |

Left alone on purpose: `⌘D`, `⌘G`, `⌘⇧G`, `⌘=`, `⌘-`, `⌘0`. On a canvas these
read as duplicate, group, ungroup and zoom, and that is the meaning you expect.
The rule is not that the browser always wins. It is that the expected meaning
wins.

Never at risk: `⌘N`, `⌘T`, `⌘W`, `⌘Q`. Chrome resolves those above the page, so
no website can take them.

Also included: `Shift`+right-click for the browser's own context menu, a wheel
that can be made to zoom instead of pan, protection for middle-click panning,
and the removal of three promotional surfaces.

## How it works

One detail of the DOM event model does most of the work. A listener registered
on `window` in the capture phase runs before any listener further down, and
listeners on the same target run in registration order. The content script runs
at `document_start`, before Figma's bundle exists, so it is first in that queue
and `stopImmediatePropagation()` means Figma's handler is never called.

The part that matters: **stopping propagation is not `preventDefault()`**. The
event still reaches Chrome's own default action. So a chord this extension
intercepts and drops behaves exactly as it would on a page with no listeners at
all, which is the whole definition of "the browser's shortcuts work". Reclaiming
therefore needs nothing from Figma and cannot be broken by a Figma release.

Moving an action is the other direction and is not as strong. It means pressing
the old chord on Figma's behalf with a synthesised `KeyboardEvent`, and those
carry `isTrusted: false`, which an application is entitled to ignore. Rather
than assume, the extension measures: an app that acts on a shortcut calls
`preventDefault` to stop the browser also acting, and `dispatchEvent` returns
`false` exactly when that happened. The options page reports the real number.

`⌘⇧R` is deliberately not exposed to that risk. Figma moved Paste to Replace
there from `⌘⌥⇧V` and never unbound the old chord, so the destructive rule needs
no emulation at all.

## Install

Not yet on the Chrome Web Store. Until then:

1. `git clone https://github.com/john-athan/muscle-memory.git`
2. Open `chrome://extensions`, switch on Developer mode
3. **Load unpacked**, and choose the folder

Reload any Figma tabs that were already open. Chrome does not inject content
scripts into tabs that existed before the extension did.

Chrome and Edge 116 or newer. Firefox is not supported yet: it needs a
`browser_specific_settings` block and an event-page background section.

## Honest limitations

- **The banner patterns will rot.** They match on visible wording rather than
  class names, which survives a redesign better, but not forever. They fail by
  hiding nothing. See `src/selectors.js`.
- **Moved actions depend on Figma honouring synthetic events.** Reclaiming does
  not. If the diagnostics panel says Figma ignores them, every reclaimed chord
  still works and each moved action still has another route in.
- **Figma bindings are only named where they were checked.** Where a binding
  was not confirmed the interface says so rather than guessing, and a test
  enforces that.

## Development

```sh
npm test     # 59 tests, no dependencies
npm run check    # manifest, syntax, tests
npm run package  # muscle-memory.zip for the store
cargo run --release --manifest-path tools/icons/Cargo.toml   # regenerate icons
```

The keymap is data in `src/keymap.js`, shared by the content script and the
options page so the two cannot drift. Much of the suite checks that table for
the mistakes that are silent at runtime: a chord reclaimed and then used as a
destination, a destination the event constructor cannot express, a rule
fighting a chord Chrome never delivers.

`test/boot.test.js` evaluates the four content scripts in manifest order
against stubs and pins the invariant everything else rests on: a reclaimed
chord must have its propagation stopped and its default **not** prevented.
Adding a `preventDefault()` to that path would turn every reclaimed chord into
a dead key, which is the one regression that would otherwise ship quietly.

## Licence

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md).

Not affiliated with Figma, Inc. "Figma" is their trademark, used here only to
say what this works with.
