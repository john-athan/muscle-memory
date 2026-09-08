# Publishing to the Chrome Web Store

Everything that can be prepared ahead of time is in this repository. What is
left needs a Google account, and cannot be done for you.

## What you need once, before the first submission

1. **A Chrome Web Store developer account.** Register at
   <https://chrome.google.com/webstore/devconsole>. There is a one-time
   USD 5 fee, paid by the Google account that will own the listing.
2. **A verified publisher contact email**, which the store shows on the
   listing. The console prompts for this on first use.
3. **A hosted privacy policy URL.** Already live at
   <https://john-athan.github.io/muscle-memory/privacy-policy.html>.

## Building the upload

```sh
npm run check                       # referenced files, syntax, 81 tests
npm run package                     # muscle-memory.zip
node scripts/check-package.mjs      # store limits, packed files, red flags
sh meta/capture-ui.sh               # retake the options-page screenshot
sh meta/make-store-art.sh           # listing artwork into screenshots/
```

Run `capture-ui.sh` before the artwork whenever the keymap changed. Two of the
three screenshots photograph the extension's own interface, and a listing that
shows a rule table missing the rule people came for is worse than no listing.

`check-package.mjs` refuses a package whose manifest exceeds a store field
limit, references a file it did not pack, contains anything but the extension,
or contains `eval`, a network call or an `innerHTML` assignment that the
listing claims it does not. A rejection costs a review cycle, which is days.

## Filling in the listing

Copy is in [store-listing.md](store-listing.md). Artwork is in `screenshots/`:

| Field in the console | File | Size |
|---|---|---|
| Screenshots (up to 5) | `store-1-problem.png`, `store-2-keys.png`, `store-3-popup.png` | 1280x800 |
| Small promo tile | `store-promo-small.png` | 440x280 |
| Marquee promo tile | `store-promo-marquee.png` | 1400x560 |
| Store icon | `screenshots/store-icon.png` | 128x128, 96px artwork, transparent padding |

## The privacy practices tab

The console will not let you publish until every field here is filled in. The
answers below are what the code actually does. Do not soften them: a
justification that overstates or understates the access is the usual reason a
review stalls, and everything here is checkable against the source.

### Single purpose description

> Muscle Memory has one purpose: to correct input handling on www.figma.com so
> that the browser's own keyboard shortcuts, context menu and mouse-wheel
> behaviour keep working while the Figma web app is open. Figma consumes
> several chords the browser owns, including Cmd+Shift+R, which Figma binds to
> "Paste to Replace" and which can therefore destroy the current selection when
> the user meant to reload. Every feature serves that single purpose.

### Permission justification: `storage`

> Used only to keep the user's own settings and nothing else. Settings are
> stored with chrome.storage.sync so they follow the user's Chrome profile
> between machines: which shortcuts to hand back to the browser, the mouse
> preferences, and which of three banners to hide. Two counters are kept in
> chrome.storage.local for the diagnostics panel, recording how many times the
> extension pressed a shortcut on the user's behalf and how many of those Figma
> acted on. No personal data is stored and nothing is transmitted anywhere.

### Host permission justification

> The extension declares no host_permissions. It registers a single content
> script matching https://www.figma.com/*, which Chrome presents to the user as
> host access. That access is required because the extension's entire function
> is to receive keyboard, mouse and wheel events on the Figma web app before
> the page's own handlers do, which is only possible from a content script
> running in that page at document_start. It runs on no other site, makes no
> network requests of any kind, and reads page text only to locate the three
> dismissible promotional banners the user has chosen to hide.

### Remote code

Select **"No, I am not using remote code."** If a justification is still
requested:

> All executable code is contained in the uploaded package. The extension has
> no build step, loads no script, stylesheet or data from any remote source,
> and makes no network requests. It uses no eval and no new Function. The
> source on GitHub is byte for byte what is in the package.

### Privacy policy URL

<https://john-athan.github.io/muscle-memory/privacy-policy.html>

The field is on this same tab. The console asks for it whenever an item could
collect user data, and the answer costs nothing even though this one does not:
storing a setting on the user's own machine is not collection, but a reviewer
should not have to take that on trust. The page is generated from `docs/` and
deploys with the rest of the site.

### Data usage

Tick **none** of the data-type checkboxes; the extension collects nothing that
leaves the device. If one of them is ticked, the privacy policy stops being
optional and the item is declared as collecting data it does not.

Then certify all three statements, each of which is true:

- I do not sell or transfer user data to third parties, outside of the approved
  use cases
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes

Finally tick the certification at the foot of the tab, confirming the data
usage complies with the Developer Program Policies. The console blocks
publishing until that box is ticked, separately from the three statements
above, and it is easy to miss below them.

## After the first publish

Reviews usually take a few days for a first submission and are faster after.
Once the item exists it has an **item ID**, and updates can be automated: see
`.github/workflows/publish.yml`, which uploads and publishes on a version tag
when four repository secrets are present. It is inert until then, so nothing
happens by accident.

To create those secrets:

1. In a Google Cloud project, enable the **Chrome Web Store API** and create an
   **OAuth client ID** of type *Desktop app*.
2. Authorise it once against your developer account for the scope
   `https://www.googleapis.com/auth/chromewebstore`, and keep the refresh token.
3. Add `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and
   `CWS_REFRESH_TOKEN` to the repository's secrets.

Google's own walkthrough for that flow is at
<https://developer.chrome.com/docs/webstore/using-api>.

## Releasing

```sh
git tag v1.0.0 && git push origin v1.0.0
```

The provenance gate no longer runs on the tag. It asks GitHub code search
whether anything distinctive in this release exists in somebody else's
repository, and the useful moment for that is before the tag, while the answer
can still change the release. A monthly sweep over every project catches the
times it was forgotten:

```sh
oss provenance muscle-memory
```
