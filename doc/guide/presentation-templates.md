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
- **Duplicate** the built-in default, one of their own, or one from the
  site catalogue — the fastest honest start, since a template is
  easier to adjust than to invent.
- **Set a default**, which the generator preselects. Clearing it
  falls back to the built-in one.
- **Delete** their own.
- **Revert** an edit in progress to the version last saved. Distinct from
  *reset*, which replaces the body with the built-in layout and is almost
  never what someone editing a saved template wants.

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

### The source editor

A textarea, with the shortcuts a textarea should have:

| Keys | Effect |
| --- | --- |
| `Ctrl/⌘ + Z`, `Ctrl/⌘ + ⇧ + Z` | Undo, redo — the browser's own |
| `Ctrl/⌘ + B` / `I` / `U` | Wrap the selection in `[b]` / `[i]` / `[u]` |
| `Ctrl/⌘ + K` | Wrap it in `[url=]…[/url]` |
| `Ctrl/⌘ + /` | Switch the selected lines off, or back on |

Undo deserves a note. Writing to the field from code — a toolbar button, a
variable inserted from the palette — **clears** the browser's undo history
rather than adding to it, which is why those actions used to cost you every
Ctrl+Z step you had built up. Every programmatic edit now goes in as a real
insertion (`document.execCommand('insertText')`), so undo and redo keep working
across toolbar clicks and variable insertions alike. The same fix applies to the
BBCode source mode of the upload editor, which had the identical problem.

**Switching a block off** wraps it in `{{#OFF}}` / `{{/OFF}}` rather than in a
comment. That is not a stylistic choice: a `{{! … }}` comment ends at the first
`}}`, so commenting out a line containing a variable leaves the tail of it
rendering — `{{! [b]{{TITLE}}[/b] }}` really does emit `[/b] }}`. A section on a
name nothing fills renders nothing whatever its body holds, and the
standalone-line rule removes the two markers cleanly, so switching a block off
and on again gives the template back unchanged.

The **Variables** pane lists every name the generator can fill,
grouped, with a description. Clicking one inserts it at the
cursor. Names outside that list are flagged as you type — an
unknown variable renders empty rather than erroring, so a typo
like `{{TITRE}}` would otherwise be invisible until the listing
came out short.

**Category** (`Universal` / `Video`) records what a template's variables
assume, and the picker shows it next to the layout you selected. It is a label,
not a filter: the metadata lookup only ever returns films and series, so
filtering the picker on it would exclude nothing today. The list route accepts
`?category=` for the day a non-video category exists.

Some variables are **blocks**: several already-formatted lines,
such as the audio track list. They exist because those lines are
built with three different separators that a template cannot
express — but you decide whether and where a block appears.

Templates are parsed when you save — by the same parser the browser renders
with, which is why it lives in `packages/shared`. An unclosed section is
refused with the line number rather than stored, because a broken template
that reached the site catalogue would fail for every viewer instead of for
its author.

## Site templates

A member's templates are their own and private. The catalogue **everybody**
sees is curated on `/admin/templates`, and that page is the only way a
template gets there — there is no publish button anywhere, and the member
write routes have no `visibility` field for one to hook into.

An admin can add, edit and remove site templates. Members see them read-only
in a third section of `/templates` and in the wizard's picker, and can
duplicate one to get an editable copy.

Three properties are worth knowing:

- **A site template has no owner.** The row's `owner_id` is NULL, so deleting
  the admin account that added it does not take the template with it. Who
  added it is recorded separately in `created_by`, which is `ON DELETE SET
  NULL` — the name can be lost, the template cannot. That column is the only
  trace of a staff action in the whole schema; there is no action log.
- **A member's own template still dies with their account** (`owner_id` is
  `ON DELETE cascade`), so a deleted user leaves no orphan drafts.
- **A site template can never be somebody's default.** The default flag lives
  on the row and a row belongs either to the site or to one member, so
  "always start from this one" means duplicating it. That is deliberate: an
  admin editing a catalogue entry would otherwise silently change what every
  member's next upload looks like.

Removing a catalogue entry stops it being offered. It does not touch copies
members already made — a duplicate is a new row, not a reference — and it does
not touch listings already posted, which carry rendered BBCode.

A `CHECK` constraint pins the two legal shapes, so no future codepath can
invent a third:

```sql
(visibility = 'private' AND owner_id IS NOT NULL)
OR (visibility = 'site' AND owner_id IS NULL AND is_default = false)
```

## Remote images and visitor privacy

::: warning A site template can log every viewer's IP
BBCode allows `[img]`, and an image loaded from a third-party host
tells that host the viewer's IP address, user agent and referring
page. A site template is rendered for every member who opens the
generator, so whoever controls the image host learns something about
all of them. The built-in default itself loads its section banners
from an external image host.

This is accepted as a known trade-off: preventing it means
restricting what templates can do. It is also the reason the
catalogue is admin-only rather than something members can add to —
an admin adding a site template should treat its image hosts as part
of what they are vouching for.

The fix, if it is ever wanted, is an **image proxy** — the site
fetches remote images itself and re-serves them, so the third
party only ever sees the server. That is a feature in its own
right (cache, size limits, and SSRF protection through the
existing `safeFetch`), not a setting.
:::

## The quota

`templateQuotaPerUser`, in the admin settings. Default 5, and it
counts a member's own templates only. Copies of a site template are the
member's own rows and do count; the catalogue itself does not, so an admin
curating it does not spend their personal allowance.

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
| Member API | `apps/api/routes/api/me/templates/` |
| Admin API (the site catalogue) | `apps/api/routes/api/admin/templates/` |
| Grammar guard, shared by all four write routes | `apps/api/utils/templateGrammar.ts` |
| Quota rules | `apps/api/utils/templatePolicy.ts` |
| Admin screen | `apps/web/app/pages/admin/templates.vue` |

The built-in default and the original generator are held
byte-identical by `apps/web/test/ficheTemplate.test.ts`, which
renders the template and compares it character for character with
`buildFiche` across the whole matrix of conditions. Changing the
default template is therefore a deliberate act that breaks a test,
not something that can happen by accident.
