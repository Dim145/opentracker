# Install as an app (PWA)

The site is installable: **Add to Home Screen** on iOS and Android, **Install**
in a desktop Chrome or Edge. It then opens in its own window, with your
instance's name and icon, and no browser chrome.

Nothing to switch on. The two pieces are served automatically.

## What makes it installable

**A web app manifest** at `/api/manifest.webmanifest`, served by the API rather
than shipped as a static file — for the same reason the theme stylesheet is.
Everything in it is operator-configurable, and a static `manifest.webmanifest`
in the bundle would bake one instance's branding into every instance's image.
It carries the site name and subtitle, the two theme colours resolved from the
site's default theme, the uploaded logo and favicon, and shortcuts to Browse,
Upload and Notifications.

**A service worker** at `/sw.js`, registered on every page load. It has always
existed — it is the Web Push receiver — but it used to be registered only when
a member turned notifications on, which is too late: a browser decides whether
a site is installable at page load, so a site whose worker appears after a
settings toggle is not installable for anyone who never visits that toggle.

## The icon, and what Chrome wants

`sizes` is a claim, and browsers act on the claim rather than on the file.
**Chrome offers to install a site only when its manifest declares an icon of at
least 512×512.** So the value is measured from the uploaded image's own header
at upload time and stored beside it — declaring `512x512` over a 64-pixel logo
would buy an install prompt and a blurry home-screen icon, which is worse than
no prompt.

What that means in practice:

| What you uploaded | Result |
| --- | --- |
| A **PNG / JPEG / WebP logo of 512×512 or more**, square | Installable everywhere, including Chrome |
| A smaller square image | Installs on iOS and Firefox; Chrome will not offer it |
| An **SVG**, or a non-square image | `sizes: any` — same as above. An SVG has no intrinsic pixel size, and `sizes` names squares: a 800×200 banner is not an 800-pixel icon |
| Nothing | The shipped 32×32 `favicon.ico`. Enough for iOS, not for Chrome |

Upload a square logo of at least 512×512 in **Admin → Branding** and Chrome
starts offering the install.

> [!NOTE]
> An image uploaded **before** this measurement existed is recorded as
> `any`, because the size was never read and is not being guessed after the
> fact. Re-uploading it fixes that.

No default 512-pixel icon is shipped to paper over the gap: an invented icon
saying "Trackarr" on somebody else's tracker is not an improvement.

## What it is not

There is **no offline mode**, and that omission is a decision rather than a gap.
The service worker's `fetch` handler exists to satisfy the installability check
and deliberately never answers a request: without it the browser goes to the
network exactly as it would with no worker at all.

Every page here is a live view of a swarm — seeder counts, ratios, a moderation
queue, an inbox. A cache-first worker would serve yesterday's numbers with no
way for the reader to tell, and on a private tracker the wrong ratio is not a
cosmetic problem. An offline shell is worth building the day there is something
worth reading offline; a stale one is worth nothing.

## Notifications

Installing does not change how notifications work. Web Push is still opt-in per
member from **Settings → Notifications**; see
[Notifications](./notifications.md). An installed app on Android and desktop
receives them the same way a tab does. iOS delivers Web Push **only** to a site
that has been added to the Home Screen — so on iPhone, installing is what makes
push possible at all.
