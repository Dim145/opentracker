# Themes

Members pick an appearance in **Settings → Appearance**. Out of the box the list
holds three entries: `Dark`, `Light` and `System`. This page is about the fourth
onwards — the ones you create.

Administrators author themes in **Admin → Themes**. A theme is a set of values
that replaces part of the appearance — colours, but also how heavy the shadows
are, how round the corners are and how fast the interface moves. The two
built-ins are the floor it stands on and are not editable, so there is always
something correct to fall back to.

## The three kinds of choice

| The member picks | What they get |
|---|---|
| a theme by name | that theme, always, whatever their operating system says |
| `System` | one of two themes you nominate, depending on the OS setting |
| `Site default`, or nothing yet | whatever you have set as the site default, **including when you change it** |

That last row is the one worth reading twice. `Site default` is not a value
copied onto the account at signup — it is a standing instruction, so moving the
site default moves every member on it, on their next page load, without them
doing anything. A member who picks a theme *by name* has made a choice, and
changing the default leaves them exactly where they are.

The same applies to people who are not signed in: an anonymous visitor is served
the site default, rendered into the page by the server, so there is no flash and
no correcting script.

One consequence worth knowing about an existing install: members who were on
`Dark` before this behaviour existed keep `Dark`. Their stored value cannot tell
"I chose dark" apart from "I never looked", and moving people who did choose
would be the worse mistake — so nobody is moved, and anyone who wants to follow
you can pick `Site default` themselves.

`System` is resolved by the browser, not by the server — a single
`prefers-color-scheme` media query in the stylesheet. There is no request, no
flash and no JavaScript involved, so it also follows the OS live: a member who
switches their desktop to dark mode sees the site change under them without
reloading.

The two halves of `System` must be **different themes**. The form refuses to save
them equal, because a system mode that resolves to one appearance whichever way
the OS is set is not a system mode — it is a confusing way to pick a theme.

## Creating one

**Duplicate rather than start empty.** `Duplicate` on `Dark` or `Light` gives you
a theme that already works, and you change what you want to change. Starting from
nothing is supported and is rarely what you want.

Three things about the editor are worth knowing before you use it.

**An empty field is an inheritance, not a blank.** A theme stores only the values
that differ from the built-in it is based on. The greyed value in an untouched
field is what it will actually render — the base's value — and `Reset` puts a
field back to inheriting rather than writing a copy of the default into it. This
is deliberate: it means a correction to a built-in reaches every theme that never
overrode that token, instead of leaving thirty themes carrying a stale copy.

**The preview is the page.** Editing a colour repaints the interface around you
immediately, including the editor itself. Nothing is saved until you press
`Save`; navigating away or pressing `Cancel` restores what was there. The editor
is a panel rather than a dialog for this reason — a window on top of the preview
would cover the thing you are judging.

**Contrast is checked, not enforced.** It warns; it does not refuse.

The **Contrast** group in the editor measures every combination the interface
paints text in — twenty of them — under named columns: a sample drawn in the two
colours being measured and at the size they are used, what the pair is, the ratio
measured, and the minimum it needs. Under each pair's name are **the two token
names**, so the reader knows which of the two to change rather than having to
guess. The count in the group header is the summary: `20/20` means the theme is
readable everywhere. Failures are also raised as a warning above the fields, so a
theme cannot fail quietly.

**What the gate cannot see.** It measures token *pairs*. A colour written as a
hex literal inside a component's own stylesheet is invisible to it — which is
how three such literals in the credentials card shipped at 1.6:1 to 2:1 in the
light theme. If you are writing a component, use the tokens.

Showing the passing pairs is the point rather than clutter: 4.6:1 and 12:1 both
look like silence when only failures are listed, and one of them breaks on the
next nudge.

The thresholds are WCAG 2.2 AA — 4.5:1 for text, 3:1 for large text and for the
focus ring. Not APCA: WCAG 3 has not settled on an algorithm, and the reference
implementation is AGPL-licensed for commercial use. The maths here is eight lines
and no dependency.

The pairs are worth taking seriously, because each round of them has caught real
defects in the *shipped* themes:

- When the check was built: three, one of them the placeholder colour of every
  form field on the site at 2.08:1.
- When it was extended to the surfaces it was not checking — the field fill
  (`bg-elevated`) and the recessed panel (`bg-inset`) — three more. `fg-subtle`
  measured 4.55:1 on the page and **4.23:1 on a card**, and in the light theme
  `bg-inset` is the *darkest* surface rather than a middle one, so it was the
  worst case there and nobody had looked. Both shipped themes now clear 4.5:1 on
  all twenty.

### What a theme can change

Forty-seven values, grouped the way the editor groups them.

| Group | Tokens |
|---|---|
| Surfaces | `bg-base`, `bg-surface`, `bg-elevated`, `bg-hover`, `bg-inset` |
| Text | `fg-default`, `fg-strong`, `fg-muted`, `fg-subtle`, `fg-faint` |
| Lines | `line-default`, `line-strong` |
| Accent | `accent`, `accent-hover`, `accent-fg`, `accent-warm`, `accent-warm-fg` |
| Status | `online`, `warning`, `danger`, `info` |
| Charts | `chart-1` … `chart-6` |
| Elevation | `shadow-color`, `shadow-strength` |
| Shape | `radius`, `radius-pill` |
| Density | `ui-scale` |
| Typography | `font-sans`, `font-mono`, `font-display`, `tracking-scale` |
| Motion | `motion-scale`, `ease-standard`, `ease-emphasis` |
| Chrome | `focus-ring`, `bg-pattern-rgb`, `bg-pattern-alpha`, `bg-pattern-kind`, `bg-pattern-step`, `color-scheme` |
| Ambience | `accent-cool`, `accent-paper` |

Four notes on that table.

**There are two accents and it is not a mistake.** `accent` is the monochrome one
— white on a dark base, near-black on a light one. `accent-warm` is the gold this
site is recognised by, and it is the one that moves most of what you can see:
primary buttons, badges, hover glows, highlight borders. If you are wondering why
changing `accent` did so little, change `accent-warm`.

**Three of these move hundreds of declarations each, and they are the levers
worth reaching for first.**

`shadow-strength` multiplies into the alpha of every shadow on the site, so each
of the 238 hand-tuned `box-shadow` declarations keeps its own relative weight
while you move the lot. `0` is a flat theme — every shadow resolves to a
transparent colour, with no second code path to go wrong. `3` is theatrical.

`motion-scale` does the same for time. Every duration in the interface is
`calc(<its own value> * var(--motion-scale))`, from a 120 ms hover to a 2.4 s
decorative pulse. `0` is a theme with no animation at all, which is worth knowing
about as an accessibility option and not only as an aesthetic one. `2` is
languid.

`radius` is a single scalar and the five steps derive from it — `0.33x`, `0.67x`,
`1x`, `1.33x`, `2x` — so the corners go from square to very round while the steps
keep their proportions. That is deliberately not five editable numbers: five
independent values drift until a small element is rounder than a large one.
`radius-pill` is separate, because a pill is a pill at any scale, and a
brutalist theme wanting square pills should not have to flatten every card to
get them.

**`ui-scale` is one lever and not two, and the reason is measurement.** This
interface expresses its type and its spacing in `rem`, so a single `font-size`
on `html` moves both — the plan called for a type scale and a density and got
one scale that is honestly labelled. Splitting them would let a theme put large
type in tight boxes, which is mostly a way to overflow a table.

It is applied as `calc(100% * var(--ui-scale))`, so a visitor who has set a
larger default font size in their browser keeps it and your factor multiplies on
top. The floor is `0.75` rather than `0`: this interface is full of 0.56 rem
micro-labels, and a theme that can render itself invisible is a theme that will.

**The six chart series are their own scale, and must stay that way.** They are
the one family that should never be derived from the accent: six series tinted
from one hue are six shades of the same colour, and the entire job of a series
colour is to be told apart from the other five. Set them independently or leave
them — the admin charts read all six, where they used to read three tokens for
the axes and carry six hex literals for the data.

**`tracking-scale` multiplies the letter-spacing, all 867 of them.** Same shape
as the other scales, and for the same reason: the values are tuned against each
other — negative on the large headings, wide on the small mono labels — and one
global value would flatten a distinction the design makes deliberately. `0`
removes tracking entirely; `2` is very airy and widens the negative tracking on
headings too, amplifying the design's own intent rather than fighting it.

**The font roles pick from a list, not a text field, and the list is the point.**
A font has to *be there*: the faces are downloaded when the image is built and
served from your instance, so a theme can only choose what the build shipped. A
free text field would let you name a font nobody has and the page would fall
back without saying so.

| Role | Choices |
|---|---|
| `font-sans` | `inter`, `manrope`, `figtree`, `ibm-plex-sans`, `atkinson-hyperlegible`, `system-sans` |
| `font-mono` | `jetbrains-mono`, `ibm-plex-mono`, `fira-code`, `space-mono`, `system-mono` |
| `font-display` | `fraunces`, `playfair-display`, `bitter`, `instrument-serif`, `source-serif`, `inter`, `system-serif` |

Three things about that table:

`atkinson-hyperlegible` is on the sans list for a reason that is not aesthetic —
it was designed for low vision, with letterforms chosen to be hard to confuse
with each other. It is a reasonable default for a theme meant to be legible
first.

The roles are separate lists, so a display face cannot be selected for the mono
role. That is not tidiness: two families at the same size differ by 10–20 % in
advance width, and a proportional face in a column of hashes is a broken table
rather than a restyled one. Changing a family is the most destructive thing a
theme can do — expect line breaks to move.

The `system-*` entries download nothing and render in whatever the visitor's
machine already has. They are the fastest option and the one that looks most
like the rest of their computer.

If none of these is the face you want, the owner can
[upload one](#uploading-a-font-owner-only).

**The easings take a keyword or a `cubic-bezier()`.** `steps()` and `linear()`
are refused: both accept argument lists of unbounded length, and neither
expresses anything a bezier cannot. The one worth trying is an overshoot —
`cubic-bezier(0.34, 1.56, 0.64, 1)` makes the whole interface feel springy, and
it is the change an author is least likely to guess at.

**The page background has three shapes, and `none` is one of them.**
`bg-pattern-kind` is `dots`, `grid` or `none`; `bg-pattern-step` is its pitch,
and `bg-pattern-rgb` / `bg-pattern-alpha` its tint. Before this the dot grid was
unavoidable at any opacity above zero, and a theme that wanted a plain page had
no way to say so.

It is a closed list rather than a free-form image on purpose. CSS cannot select a
`background-image` from the value of a custom property, so the name is mapped to
a literal in code — which also means the only strings that ever reach the
stylesheet are the three this application wrote. A free-form image would have
accepted `url()`, and with remote images allowed for posters that is a channel
for telling someone else's server who visited your tracker.

**The ambience pair does nothing yet.** `accent-cool` and `accent-paper` are
reserved names, emitted and stored but not yet read by the interface. They are
declared now so a theme you author today stays valid when the per-page palettes
start using them, rather than becoming invalid later.

Typography and density are planned and are not in this release; a theme file
written now will still load when they arrive.

### Value formats

Every colour is three integers, `0`–`255`, space-separated: `212 167 52`. Not
hex, not `rgb(...)`. The reason is worth knowing if you are hand-editing an
export: the interface needs to be able to write `rgb(var(--accent) / 0.4)` to get
a translucent variant of a token, and that only works if the token holds the
channels rather than a finished colour. It also means a value that validates
cannot possibly contain CSS syntax, which is what lets the stylesheet be
assembled without escaping.

`shadow-strength` and `motion-scale` are plain numbers with a ceiling (3 and 4).
`radius` and `radius-pill` are a number with `px` or `rem` — no `calc()`, no
other unit, and a ceiling, because a 400 px radius on a card is not a theme.
`bg-pattern-alpha` is a decimal between `0` and `1`. `color-scheme` is `light` or
`dark`, and it is what tells the browser which way to draw scrollbars, `<select>`
menus and date pickers — set it to what your theme *looks* like, not to the
built-in it is based on. A dark theme built on `light` needs `dark` here.

## Uploading a font — owner only

The curated list exists because a face has to be in the image. If you want one
that is not, the **owner** can upload it: *Admin → Themes*, inside the editor,
under *Uploaded fonts*. Any administrator can then select it from the font
pickers; only the owner can add or remove one.

- **woff2 only**, and the check is the first four bytes rather than the
  extension — a `.ttf` renamed `.woff2` is refused. Convert first; every browser
  this application supports reads woff2.
- **2 MB maximum.** Every visitor using the theme downloads it.
- **Pick the role the face is FOR.** A face uploaded for `display` cannot be
  selected for `mono`, and that is not pedantry: two families at the same size
  differ by 10–20 % in advance width, and a proportional face in a column of
  hashes is a broken table rather than a restyled one.
- **Uploading asks for your password again.** Selecting an uploaded face does
  not.

Two behaviours worth knowing:

**The same file twice is one font.** Storage is addressed by the SHA-256 of the
bytes, so re-uploading a file you already have returns the existing entry — with
its original name and role. It also means the served URL is cached for a year:
the bytes behind an id can never change.

**Deleting is refused while a theme still uses it**, and the error names the
themes. Nothing cascades — clearing the reference for you would silently change
how those themes look.

What is *not* checked is the font's internal structure. Parsing a font properly
means shipping a font parser, which is a larger attack surface than the one it
would defend; an uploaded face is handed to the browser's own font engine, which
is where every font on the web ends up. The gate is that only the owner can put
one there. The name you type is a label for the picker and never reaches the
stylesheet — CSS sees `ot-font-<id>`, a name this application generates.

## Raw CSS — owner only

The token list is bounded and the interface is not. For the components the tokens
do not reach, the **owner** — not every administrator — can attach free-form CSS
to a theme, in the editor under *Raw CSS*.

Saving it asks for your password again. That is not friction for its own sake: a
stylesheet is a data-exfiltration channel that needs no JavaScript, it would
apply to every member on every page, and it would survive a password change. So
it is treated like erasing an account — a re-authenticate-to-change setting.

**Every selector is scoped to the theme automatically.** Write `.torrent-row`,
get `:root[data-theme='yours'] .torrent-row`. `html` and `:root` are handled
specially (replaced rather than nested, which would match nothing). You cannot
reach outside the theme, so a rule you write cannot affect the built-ins or
anybody else's theme.

**`@keyframes` are renamed** with the theme's slug, and the `animation` /
`animation-name` references in the same stylesheet are rewritten to match.
Keyframes are global in CSS — selector scoping cannot touch them — so without
this a theme's `@keyframes spin` would silently redefine the animation the rest
of the site uses. An `animation` that refers to one of the application's own
animations is left alone.

**What is refused, and why:**

| Refused | Reason |
|---|---|
| `url()`, anywhere | It tells another server who visited the page. With remote posters allowed by the CSP, `background-image: url(https://…)` loads — and `input[value^="a"] { background: url(…/a) }` reads a field one character per request. `data:` URIs are refused too, because allowing one form means auditing every form. |
| Any function not on the list below | Several CSS functions take a URL as a plain **string** rather than as `url()` — `image-set("https://…" 1x)` is the one that works in every browser today, with `-webkit-image-set()`, `cross-fade()` and `src()` behind it. Refusing those four by name would only hold until the next one, so the rule runs the other way round. |
| `@import` | A request this feature has no reason to make. |
| `@font-face` | It would redefine a curated family out from under the font role that selected it. |
| `@property` | It registers a custom property globally, with a syntax and an inherit flag, changing how the application's own tokens cascade and animate. |
| `@layer` | A global ordering directive; a stylesheet of scoped selectors gains nothing from it and could move the application's own rules in the cascade. |
| `-moz-binding`, `behavior` | Both load and run code. |
| More than 16 kB | Every enabled theme's CSS is in the one stylesheet each visitor downloads. |

`@media`, `@supports`, `@container` and `@keyframes` are allowed.

**Functions you can call.** Arithmetic (`calc`, `min`, `max`, `clamp`, `round`
and the trigonometric ones), substitution (`var`, `env`), colour (`rgb`, `hsl`,
`hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`, `color-mix`, `light-dark`), the
six gradients, the ten filter functions, the transform functions, easing
(`cubic-bezier`, `steps`, `linear`), track sizing (`minmax`, `repeat`,
`fit-content`), `counter`/`counters`, and the basic shapes (`circle`, `ellipse`,
`inset`, `polygon`, `path`). Nothing else — including vendor-prefixed spellings,
which none of these need in any browser this application supports.

Selectors are not affected: `:is()`, `:not()`, `:has()` and `:nth-child()` are
pseudo-classes, not functions, and work as normal.

If you need something legitimate that is refused, the error names the function —
that is the evidence for adding it, and the list is meant to grow that way rather
than by guessing in advance.

The check is a real CSS parser, not a search for `url(`. It has to be: CSS lets
you write `u\72 l(`, `URL(`, `ur/**/l(` and `\0075 rl(`, and all four are the
same function. The stylesheet you get back is **regenerated** from what the
parser understood, so your formatting and comments are not preserved — and the
browser can only ever see what the parser accepted, which is the property that
makes the whole approach sound.

If a theme with raw CSS is one half of `System`, its CSS applies there too.

## Import and export

`Export` downloads a theme as JSON. `Import` loads one **into the editor** rather
than saving it, so you can see what arrived and what it does before committing.
An import that carries an unknown token name, or a value the token's format does
not allow, is refused with every problem listed at once rather than one per
attempt.

This is how you move a theme between instances, and how you keep a copy before
experimenting.

## Reserving a theme for a role

A theme can be limited to members holding one of a set of roles — a supporter
perk, a staff skin. Set `Available to` → `Only these roles`.

**Read this before you use it for anything but a perk.** Every enabled theme is
in the one stylesheet every visitor downloads, which is what makes switching
instantaneous. Somebody who opens their browser's developer tools can therefore
apply a role-reserved theme to their own session. What is enforced is that they
cannot *keep* it: saving a theme you are not entitled to is refused by the API,
so it survives one page load and nobody else ever sees it.

That is the trade, and it is the right way round for a cosmetic feature. Do not
use theme visibility to hide anything that matters.

## Limits and housekeeping

**Ten enabled themes.** Disabled ones do not count and are not served, so keep
drafts disabled. The cap exists because all enabled themes travel in one
stylesheet to every visitor; ten of them is a few kilobytes, and a hundred would
be a page-weight decision rather than a cosmetic one.

**Deleting a theme puts its members back to following the site default** and
resets either half of `System` that pointed at it. Nothing is left holding a name
that no longer exists — and they are set to *follow* the default rather than
pinned to whatever it happens to be that day, because losing a theme was not a
choice they made.

**Renaming is free; the internal slug is not renamed.** The display name is what
members see and you can change it whenever you like. The slug is what member
records store, so it is fixed at creation — renaming it would orphan everyone
using the theme.

**Three names are refused:** `light`, `dark` and `system` already mean something.

## For operators

Themes are served as one stylesheet at `GET /api/theme.css`, cached for a minute
and revalidated by an ETag that changes on every theme write. A member's own
choice rides in a cookie (`trackarr-theme`) as well as on their account, which is
what lets the server render the right theme into the HTML instead of painting it
in after the fact — no flash of the wrong appearance on first load.

If you put a CDN or a caching proxy in front of Trackarr, `/api/theme.css` is
safe to cache and HTML is not: the theme is part of the HTML, so cached HTML
would serve one member's appearance to another. Trackarr sends no
`Cache-Control` on HTML, and the bundled Caddy has no cache, so this only comes
up if you add one.

The static build (`front`, the nginx image with no server) has no server to
render the attribute, so there the theme is applied by a small script in `<head>`
that reads the same cookie before the first paint.

### Troubleshooting

**A member reports the site is back to dark.** Their theme was deleted or
disabled. Both fall back to the site default rather than to nothing.

**A theme looks right in the editor and wrong on the site.** The editor previews
by writing the values onto the page directly, which bypasses the stylesheet. If
they disagree, the theme was not saved.

**Scrollbars or dropdowns are the wrong colour.** `color-scheme`. See above.

## What a theme still cannot change

Honest limits, so you do not go looking for a setting that is not there.

**Each section's own palette.** Favourites is amber and parchment, Following is
emerald and velvet, Invitations is a warm gild, Requests is brass and phosphor,
the Shop is gold. Those are six hand-drawn palettes, deliberately distinct, and
they are still literals — a theme does not reach them. Folding them into the
three ambience tokens would make every section look the same, which is a design
decision rather than a refactor, so it has not been taken. Raw CSS reaches them
if you need to.

**Breakpoints, container widths, z-index and grid columns.** All four generate
at-rules or ordering that cannot be changed at runtime from a custom property,
so exposing them would be a setting that quietly does nothing.

**Anything behind `prefers-reduced-motion`.** A visitor who has asked their
operating system for less motion gets `animation: none` regardless of
`motion-scale`, and a theme cannot override that. Deliberate: the setting is
theirs, not yours.

## See also

- [Branding & Site Settings](./branding.md) — logo, site name, the single accent
  colour used in emails and metadata
- [Roles & Permissions](./roles-and-permissions.md) — the roles a theme can be
  reserved to
- [Upgrading](./upgrading.md) — the owner role, if you are coming from an earlier
  version
