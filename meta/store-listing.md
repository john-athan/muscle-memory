# Chrome Web Store, listing copy

## Name

Muscle Memory

## Short description (max 132 chars)

Gives your browser's shortcuts back on Figma. Reload works again, right-click works again, and the wheel scrolls the way you expect.

## Category

Developer Tools

## Full description

Cmd+Shift+R in Figma is Paste to Replace. Press it meaning "hard reload", with a
slide selected, and Figma swaps that slide for whatever is on your clipboard.
Chrome never sees the keystroke. Neither does your muscle memory, which is why
it keeps happening.

Muscle Memory gives the browser back the chords it owns, and moves the Figma
actions that lose one to the chord you would have guessed.

WHAT COMES BACK

- Cmd+Shift+R hard reloads. Paste to Replace moves to Cmd+Opt+Shift+V, which is
  where Figma used to keep it and still answers to.
- Cmd+R reloads. Rename moves to F2.
- Cmd+F finds on the page. Figma's own file search stays on Cmd+/.
- Cmd+S saves the page. Figma binds nothing there at all.
- Cmd+[ and Cmd+] go back and forward, if you want them to. Off by default,
  because layer order is the more useful reading of those keys.

WHAT STAYS WITH FIGMA

Cmd+D, Cmd+G, Cmd+Shift+G, Cmd+= and Cmd+0. On a canvas those mean duplicate,
group, ungroup and zoom, and that is the meaning you expect. The rule is not
that the browser always wins. It is that the expected meaning wins.

ALSO

- Shift+right-click opens the browser's own context menu. An ordinary
  right-click still opens Figma's, which is worth keeping.
- The mouse wheel can be made to zoom instead of pan, for anyone not on a
  trackpad.
- Middle-click panning is protected from Chrome's autoscroll.
- Three promotional surfaces can be hidden: the "open in desktop app" banner
  that has no dismiss button, AI upsells, and the "what's new" modal.

HONEST ABOUT ITS LIMITS

Handing a chord back to the browser needs no cooperation from Figma and cannot
be broken by a Figma release. Moving an action to a new chord does depend on
Figma, so the extension measures whether it worked and shows you the real
number rather than claiming it does.

PRIVACY

No analytics, no telemetry, no network requests, no host permissions. One
permission, "storage", for your settings. Open source under MIT.

Not affiliated with Figma, Inc.

## Privacy practices

Single purpose: adjust keyboard, mouse and interface behaviour on figma.com so
that the browser's own shortcuts and controls keep working.

Permission justification, storage: persists the user's settings across sessions
and machines, and two local counters shown in the diagnostics panel.

Remote code: none. No code is fetched or executed from outside the package.

Data collection: none of the disclosure categories apply. The extension makes
no network requests.

## Links

- Homepage: https://john-athan.github.io/muscle-memory
- Support: https://github.com/john-athan/muscle-memory/issues
- Privacy policy: https://john-athan.github.io/muscle-memory/privacy-policy.html
