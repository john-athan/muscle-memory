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
npm run check                       # referenced files, syntax, 80 tests
npm run package                     # muscle-memory.zip
node scripts/check-package.mjs      # store limits, packed files, red flags
sh meta/make-store-art.sh           # listing artwork into screenshots/
```

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
| Store icon | `icons/icon128.png` | 128x128 |

## The privacy declarations

These are the questions that stall a review when answered carelessly. The
answers below are what the code actually does; do not soften them.

- **Single purpose.** "Adjust keyboard, mouse and interface behaviour on
  figma.com so that the browser's own shortcuts and controls keep working."
- **Permission justification, `storage`.** "Persists the user's settings across
  sessions and machines, and the counters shown in the diagnostics panel."
- **Host access.** The extension declares no `host_permissions`. Its content
  script matches `https://www.figma.com/*`, which Chrome still presents to the
  user as "read and change your data on figma.com". Say so plainly; the listing
  and the privacy policy both do.
- **Remote code.** No. Nothing is fetched or executed from outside the package,
  there is no build step, and the source on GitHub is byte for byte what runs.
- **Data collection.** None of the disclosure categories apply. The extension
  makes no network requests of any kind.

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

The tag also triggers `provenance.yml`, which asks GitHub code search whether
anything distinctive in this release exists in somebody else's repository. Run
it locally first if you want the answer while it can still change the release:

```sh
./scripts/provenance-check.py
```
