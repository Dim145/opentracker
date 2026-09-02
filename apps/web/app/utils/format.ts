/**
 * The locale these formatters use when none is passed.
 *
 * Set once at app start from the member's own preference. The alternative —
 * threading a locale through every one of the ~50 call sites — is what kept
 * these functions English for so long: the cost of the correct call was higher
 * than the cost of leaving the bug, so the bug won. A module-level default
 * makes the correct behaviour the cheap one, and an explicit argument still
 * wins where a caller has a reason.
 */
let defaultLocale = 'en';
export function setFormatLocale(locale: string): void {
  defaultLocale = locale || 'en';
}

/**
 * D'où vient la langue quand l'appelant n'en passe pas.
 *
 * `defaultLocale` seule ne suffit pas côté serveur, pour deux raisons :
 *
 *  - elle n'y était jamais écrite (`setFormatLocale` n'est appelée que depuis
 *    un plugin `.client`), donc TOUT le rendu serveur sortait en anglais. Une
 *    page française affichait « yesterday » dans sa colonne ÂGE jusqu'à ce que
 *    l'hydratation la réécrive — et ce que voit un lecteur sans JavaScript, ou
 *    un moteur d'indexation, reste l'anglais ;
 *  - une variable de module est partagée par tous les rendus concurrents du
 *    processus. L'y écrire par requête ferait fuiter la langue d'un membre
 *    dans la page d'un autre.
 *
 * Le résolveur, lui, est bien une seule fonction pour tout le processus, mais
 * il répond à CHAQUE appel depuis le contexte de la requête en cours. C'est le
 * plugin `i18n-format` qui l'installe ; en test, il n'y en a pas et
 * `defaultLocale` reprend la main.
 */
let localeSource: (() => string) | null = null;
export function setFormatLocaleSource(fn: (() => string) | null): void {
  localeSource = fn;
}
function currentLocale(): string {
  if (!localeSource) return defaultLocale;
  try {
    return localeSource() || defaultLocale;
  } catch {
    return defaultLocale;
  }
}

/**
 * Binary units, the ones a torrent client shows, and a locale-aware decimal
 * separator.
 *
 * The units were `KB/MB/GB` over a division by **1024**, which is the wrong
 * label for that arithmetic — 1024 bytes is a kibibyte. And `toFixed(1)`
 * hardcodes a dot, so a French page read "4.2 GB" where it means « 4,2 Gio ».
 */
export function formatSize(bytes: number, locale = currentLocale()): string {
  // Guards: negative or sub-byte values render as "0 B"; values past
  // PB clamp to the largest unit instead of indexing past the array
  // (the previous version returned "0.5 undefined" for bytes < 1 and
  // would crash on > PB).
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const raw = Math.floor(Math.log(bytes) / Math.log(1024));
  const i = Math.min(units.length - 1, Math.max(0, raw));
  const value = bytes / Math.pow(1024, i);
  const shown = i === 0
    ? Math.round(value).toLocaleString(locale)
    : value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${shown} ${units[i]}`;
}

/** A date and time, in the reader's language rather than always in English. */
export function formatDate(dateStr: string, locale = currentLocale()): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Day-precision date for membership / "since" labels — strips the time so
 * "Member since" doesn't read as "Mar 5, 2026, 04:32 PM" (the original
 * `formatDate` includes the minute, which is absurd for a join date).
 */
export function formatDay(dateStr: string, locale = currentLocale()): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * How long ago, in the reader's language.
 *
 * This used to return `3d ago` / `just now` — English, always, at some fifty
 * call sites including every catalogue row's AGE column and every torrent
 * page's header. `formatAgo` (below) was written to fix exactly that and was
 * called from **one** place in the whole app, because the correct call needed a
 * locale argument the callers did not have. With a module-level default it does
 * not, so `formatAge` is now a thin wrapper over it and every caller is fixed
 * without being touched.
 *
 * The old compact spellings are gone on purpose: `il y a 3 jours` is longer
 * than `3d ago`, and the columns that carry it are sized in `ch` or `auto`
 * rather than fixed pixels.
 */
export function formatAge(
  dateStr: string | Date | null | undefined,
  locale = currentLocale()
): string {
  // La garde de date future reste ici et non dans `formatAgo` : `formatAgo`
  // répond « maintenant » à une date à venir, ce qui est correct pour un
  // horodatage qui vient de basculer, alors que `formatAge` a des appelants
  // (le badge de buff) pour qui une date future n'est PAS un âge et doit ne
  // rien rendre du tout.
  if (!dateStr) return '';
  const at = new Date(dateStr).getTime();
  if (Number.isNaN(at) || at > Date.now()) return '';
  return formatAgo(dateStr, locale);
}

/** The original compact English ladder, kept for anything that needs a fixed
 *  narrow width. No current caller does; it exists so the change above is
 *  reversible per-site rather than all-or-nothing. */
export function formatAgeCompact(dateStr: string | Date | null | undefined): string {
  // Nullable because every caller already passes something nullable: a
  // release carries `moderatedAt ?? createdAt ?? null`, and an invalid Date
  // renders as "Invalid Date" rather than throwing — which is what the
  // callers have been relying on.
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // A date in the future is not an age, and this function used to answer one
  // anyway: `diffInSeconds` goes negative, the first branch below catches it,
  // and every future date came back as "just now". That is how a live
  // freeleech with three days left rendered as "FREELEECH until just now" on
  // the busiest strip of a torrent page. Returning nothing is the honest
  // answer — the caller wanted a deadline, and `formatUntil` is the function
  // that gives one.
  if (diffInSeconds < 0) return '';

  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 2592000)
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  if (diffInSeconds < 31536000)
    return `${Math.floor(diffInSeconds / 2592000)}mo ago`;
  return `${Math.floor(diffInSeconds / 31536000)}y ago`;
}

/**
 * How long ago, in the reader's language — `formatAge` for places that are
 * inside a translated sentence.
 *
 * `formatAge` returns `3d ago`, in English, always. Most of its callers put it
 * in a bare cell where that is survivable; the ones that interpolate it into a
 * message do not, and one of them produced `last 3d ago ago` in English and
 * `la dernière il y a 3d ago` in French. Because the direction is part of what
 * `Intl` returns, the surrounding message must not add its own "ago".
 */
export function formatAgo(
  dateStr: string | Date | null | undefined,
  locale = currentLocale()
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return rtf.format(0, 'second');
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(-Math.round(seconds / 86400), 'day');
  if (seconds < 31536000) return rtf.format(-Math.round(seconds / 2592000), 'month');
  return rtf.format(-Math.round(seconds / 31536000), 'year');
}

/**
 * How long is left, for a deadline — the mirror of `formatAge`.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled ladder, because unlike
 * `formatAge` (whose "3d ago" strings predate i18n on this codebase and are
 * baked into a dozen templates) this one is new and has no callers to keep
 * happy. It gives "in 3 days" / "dans 3 jours" from the browser, so a French
 * page stops carrying an English unit.
 *
 * A deadline already past returns nothing: a buff whose window closed is not a
 * buff, and the caller should stop drawing the badge rather than draw one that
 * says "3 days ago".
 */
export function formatUntil(
  dateStr: string | Date | null | undefined,
  locale = currentLocale()
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return '';

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 3600) return rtf.format(Math.max(1, Math.round(seconds / 60)), 'minute');
  if (seconds < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(Math.round(seconds / 86400), 'day');
  if (seconds < 31536000) return rtf.format(Math.round(seconds / 2592000), 'month');
  return rtf.format(Math.round(seconds / 31536000), 'year');
}

/**
 * Strip every HTML tag from a string. Used to derive plain-text fallbacks
 * (page titles, placeholders) from the admin's rich-text settings.
 *
 * The naive single-pass `replace(/<[^>]*>/g, '')` lets crafted inputs slip
 * through — `<<script>script>` becomes `<script>` after one pass. We loop
 * until the string stops shrinking so the output is guaranteed to be
 * tag-free, regardless of nesting depth.
 */
export function stripTags(input: string | null | undefined): string {
  if (!input) return '';
  let s = input;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
}

/**
 * Un instant ISO → la valeur qu'attend `<input type="datetime-local">`.
 *
 * L'entrée `datetime-local` n'a pas de fuseau : elle lit et écrit l'heure
 * murale locale. Alimenter sa valeur avec `toISOString().slice(0, 16)` y
 * inscrit donc l'heure UTC en la faisant passer pour l'heure locale — la page
 * d'un torrent affichait « 14:00 » pour une promotion qui finissait à 16:00, et
 * comme l'enregistrement relit bien la valeur comme locale, chaque
 * enregistrement décalait l'échéance d'un fuseau de plus. Deux heures par
 * sauvegarde à Paris l'été.
 *
 * Les accesseurs locaux (`getHours`…) donnent directement l'heure murale, sans
 * arithmétique sur le décalage — qui se trompe deux fois par an, au passage à
 * l'heure d'été.
 */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Le retour : la valeur d'un `datetime-local` → un instant ISO. */
export function datetimeLocalToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
