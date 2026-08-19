# Security policy

## Reporting

Please report anything security-relevant through
[GitHub's private advisory form](https://github.com/john-athan/muscle-memory/security/advisories/new)
rather than a public issue. I will confirm receipt within a week.

## What counts

This is a browser extension, so the interesting boundary is between a web page
and the extension. Reports along that boundary are always welcome, in
particular:

- Anything that lets a page on figma.com influence the extension into acting
  on its behalf, or into taking a keystroke the user did not make. Every
  handler gates on `event.isTrusted` for this reason.
- Anything that makes the banner matcher hide an element it should not, since
  the input it matches against includes layer names and comments written by
  other people in a shared file.
- Anything that reaches a dangerous sink from settings or page content. There
  is deliberately no `innerHTML`, no `eval`, and no `RegExp` built from input
  anywhere in the extension.
- Any way to make the extension issue a network request. It makes none, has no
  host permissions beyond its figma.com content-script match, and holds only
  the `storage` permission.

## What does not count

- The extension stops Figma receiving certain keystrokes. That is its purpose.
- Hiding promotional banners on Figma's interface is intended behaviour, and
  can be switched off.
- Findings in Figma itself. Please take those to Figma.

## Verifying a claim yourself

There is no build step, so the source in this repository is what runs in the
browser. `npm test` covers the behaviour, and `test/boot.test.js` in particular
pins the invariants that a security fix must not regress.
