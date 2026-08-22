# Presentation Templates

The BBCode a listing is built from, editable by the members who
write listings. The generator at `/torrents/fiche` renders a
template against the metadata it gathered; which template it uses
is a choice, not a constant.

Everyone starts with the same built-in default — the layout the
generator has always produced. It is a **code constant, not a
row**: nobody can delete it, every account has it, and it needs no
seeding on a fresh install.

## What a member can do

`/templates`, reachable from Settings.

- **Create** a template, up to the per-user quota (default 5, see
  below).
- **Duplicate** the built-in default, one of their own, or one the
  staff published — the fastest honest start, since a template is
  easier to adjust than to invent.
- **Set a default**, which the generator preselects. Clearing it
  falls back to the built-in one.
- **Delete** their own.

## Writing one

The editor edits **raw BBCode source**. That is deliberate: a
template is whitespace-sensitive — a leading space, a blank line,
a missing trailing newline all change the listing — and a rich
editor that round-trips through HTML cannot preserve that.

Two constructs beyond plain text:

| Syntax | Meaning |
| --- | --- |
| `{{VARIABLE}}` | Replaced by the value. Unknown names render empty. |
| `{{#VARIABLE}}…{{/VARIABLE}}` | Kept only when the value is non-empty. |
| `{{^VARIABLE}}…{{/VARIABLE}}` | Kept only when it *is* empty. |
| `{{! note }}` | A comment. Never rendered. |

A section tag alone on its line takes the whole line with it, so
a block that renders nothing leaves no blank line behind. That is
what lets the built-in default reproduce the original layout
exactly.

The **Variables** pane lists every name the generator can fill,
grouped, with a description. Clicking one inserts it at the
cursor. Names outside that list are flagged as you type — an
unknown variable renders empty rather than erroring, so a typo
like `{{TITRE}}` would otherwise be invisible until the listing
came out short.

Some variables are **blocks**: several already-formatted lines,
such as the audio track list. They exist because those lines are
built with three different separators that a template cannot
express — but you decide whether and where a block appears.

Templates are parsed when you save. An unclosed section is
refused with the line number rather than stored, because a broken
template that got published would fail for every viewer instead
of for its author.

## Staff-published templates

Staff can publish a template site-wide. Members then see it
read-only and can copy it; they cannot edit it in place.

Two rules are worth knowing:

- **Writing to a published template requires a live staff role**,
  owner or not. A staffer who publishes and is later demoted stops
  being able to change what the whole site reads.
- **Any staffer can unpublish or delete a published template.**
  Without that there would be no way to retract one whose author
  went inactive.

Unpublishing hides it and stops new copies. It does not touch
copies members already made, and it does not touch listings
already posted — those carry rendered BBCode, not a reference.

## Remote images and visitor privacy

::: warning A published template can log every viewer's IP
BBCode allows `[img]`, and an image loaded from a third-party host
tells that host the viewer's IP address, user agent and referring
page. A published template is rendered for every member who opens
the generator, so whoever controls the image host learns something
about all of them. The built-in default itself loads its section
banners from an external image host.

This is accepted as a known trade-off: preventing it means
restricting what templates can do. Staff should treat the image
hosts in a template they publish as part of what they are
vouching for.

The fix, if it is ever wanted, is an **image proxy** — the site
fetches remote images itself and re-serves them, so the third
party only ever sees the server. That is a feature in its own
right (cache, size limits, and SSRF protection through the
existing `safeFetch`), not a setting.
:::

## The quota

`templateQuotaPerUser`, in the admin settings. Default 5, and it
counts a member's own templates only — copies of published ones
are their own templates and do count.

The cap is enforced in the create endpoint, not in the browser,
and creation is serialised per user with an advisory lock so a
burst of concurrent requests cannot slip past it.

## Where the pieces live

| Concern | File |
| --- | --- |
| Renderer (shared by browser and API) | `packages/shared/src/templateEngine.ts` |
| Variable bag, blocks, built-in default | `apps/web/app/utils/ficheTemplate.ts` |
| The original generator, still the reference | `apps/web/app/utils/ficheBbcode.ts` |
| Storage | `presentation_templates` |
| API | `apps/api/routes/api/me/templates/` |
| Rules (quota, visibility, write access) | `apps/api/utils/templatePolicy.ts` |

The built-in default and the original generator are held
byte-identical by `apps/web/test/ficheTemplate.test.ts`, which
renders the template and compares it character for character with
`buildFiche` across the whole matrix of conditions. Changing the
default template is therefore a deliberate act that breaks a test,
not something that can happen by accident.
