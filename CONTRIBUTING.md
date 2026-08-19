# Contributing

## Running it

Load the repository folder unpacked from `chrome://extensions` with Developer
mode on. There is no build step. Reload the extension and then reload any Figma
tab, in that order: a content script is injected at `document_start`, so a tab
that was already open is still running the previous version.

```sh
npm test                                                     # 72 tests, no dependencies
npm run check                                                # manifest, syntax, tests
cargo run --release --manifest-path tools/icons/Cargo.toml   # regenerate icons
```

## Adding a chord

Chords are data in `src/keymap.js`. Add an entry to `MM_RULES` and the options
page picks it up on its own, because it renders from the same table the content
script enforces. Before opening a pull request, please:

- **Say where the Figma binding came from.** Set `confirmed: true` and name the
  action in `figma` only if you checked it, in Figma's own shortcut panel or in
  its documentation. If you did not, leave `figma: null` and the interface will
  say so honestly rather than assert something the reader cannot verify. A test
  enforces this.
- **Prefer an alias to a synthesised keystroke.** If Figma still answers to an
  older chord for the same action, use `via: 'alias'` and point at it. That
  needs nothing from Figma and cannot be broken by a release. `via: 'synthetic'`
  works today but depends on Figma honouring untrusted events.
- **Check it is worth a rule.** A chord in `MM_BROWSER_RESERVED` never reaches
  the page, so a rule for it does nothing. Tests cover both cases.

The invariants in `test/keymap.test.js` catch the mistakes that are silent at
runtime: a chord reclaimed and also used as a destination, a destination the
event constructor cannot express, two rules claiming one chord.

## Changing the banner patterns

`src/selectors.js` matches on visible wording rather than class names, because
Figma's generated classes change most weeks and its copy does not. When updating
one, add a case to `test/selectors.test.js` for a sentence that should **not**
match. The dangerous failure is not a pattern that stops working, it is one that
matches a layer name and hides part of the interface.

Never widen a pattern in a way that could match a document body or a comment.
The 400-character cap and the load-bearing checks exist for that reason and
should not be relaxed.

## Style

Match what is there: no dependencies in the extension, no build step, and
comments that explain why rather than what. The mechanism this extension relies
on is subtle enough that a reader who does not know the difference between
`stopImmediatePropagation()` and `preventDefault()` should be able to learn it
from the source.
