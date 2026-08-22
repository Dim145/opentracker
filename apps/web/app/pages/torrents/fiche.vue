<script setup lang="ts">
/**
 * Listing generator — a four-step wizard.
 *
 *   1 · File       a single picker: video, NFO or .torrent. The title is
 *                  derived from the filename by the parser already used at
 *                  upload time.
 *   2 · Work       the TMDb search starts from that title; pick a result to
 *                  prefill, or type everything by hand. Every field stays
 *                  editable, tmdbId or no tmdbId.
 *   3 · Technical  prefilled when a video or an NFO was supplied, and the
 *                  normalised release name recomputes as choices are made.
 *   4 · Output     BBCode + NFO, to copy or send back to the upload page.
 *
 * The listing is rendered from a template rather than assembled here: the
 * built-in one reproduces the historical output to the byte, and the picker on
 * step 4 swaps in one of the user's own or one the staff published.
 *
 * Everything happens in the browser. The only two network calls are the TMDb
 * search and detail lookups, which go through the tracker API so the key stays
 * server-side; neither the video nor the listing leaves the machine.
 */
import { watchDebounced } from '@vueuse/core';
import { useFicheDraftStore } from '~/stores/ficheDraft';
import { useNotificationStore } from '~/stores/notifications';
import { parseReleaseName } from '~/utils/releaseParse';
import { bbcodeToHtml } from '~/utils/editorFormats';
import { sanitizeRichHtml } from '~/utils/markdown';
import {
  analyzeFile,
  emptySheet,
  emptyTrack,
  isSheetEmpty,
  parseMediaInfoText,
  pickBitRateUnit,
  pickSizeUnit,
  prettyContainer,
  prettyVideoFormat,
  renderMediaInfo,
  resolutionLabel,
  type MediaTrack,
  type SubtitleKind,
  type TechnicalSheet,
} from '~/utils/mediainfo';
import {
  audioLine,
  defaultOptions,
  languageLabel,
  subtitleLine,
  LANGUAGE_OPTIONS,
  type FicheRelease,
  type FicheWork,
} from '~/utils/ficheBbcode';
import { DEFAULT_FICHE_TEMPLATE, renderFiche } from '~/utils/ficheTemplate';
import { templateVariables } from '@trackarr/shared/templateEngine';
import {
  buildNfo,
  deriveReleaseParts,
  formatReleaseName,
  type ReleaseNameParts,
} from '~/utils/ficheRelease';

const { t } = useI18n();
const draft = useFicheDraftStore();
const notify = useNotificationStore();

useHead({ title: () => t('fiche.title') });

const STEPS = ['file', 'work', 'tech', 'output'] as const;
type Step = (typeof STEPS)[number];
const step = ref<Step>('file');
const stepIndex = computed(() => STEPS.indexOf(step.value));
function goTo(s: Step) {
  step.value = s;
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function next() {
  const i = stepIndex.value;
  if (i < STEPS.length - 1) goTo(STEPS[i + 1]!);
}
function back() {
  const i = stepIndex.value;
  if (i > 0) goTo(STEPS[i - 1]!);
}

/* ── 1 · Fichier ──────────────────────────────────────────────────────── */

const sheet = ref<TechnicalSheet>(emptySheet());
const pickedName = ref('');
const analyzing = ref(false);
const fileError = ref('');
const torrentFile = shallowRef<File | null>(draft.torrentFile);

const VIDEO_RE = /\.(mkv|mp4|avi|mov|ts|m2ts|iso|wmv|flv|webm)$/i;
const NFO_RE = /\.(nfo|txt)$/i;

/** A single entry point: we route on the extension. */
async function acceptFile(file: File) {
  fileError.value = '';
  pickedName.value = file.name;
  seedTitleFrom(file.name);

  if (file.name.toLowerCase().endsWith('.torrent')) {
    torrentFile.value = file;
    draft.seedFromUpload({ torrentFile: file });
    return;
  }
  if (NFO_RE.test(file.name)) {
    const raw = await file.text();
    const parsed = parseMediaInfoText(raw);
    sheet.value = isSheetEmpty(parsed) ? { ...emptySheet(), raw } : parsed;
    syncSpecs(sheet.value, true);
    lastRendered = raw;
    pastedMediaInfo.value = raw;
    return;
  }
  if (VIDEO_RE.test(file.name) || file.type.startsWith('video/')) {
    analyzing.value = true;
    try {
      sheet.value = await analyzeFile(file);
      syncSpecs(sheet.value, true);
      // The WASM returns an object, not text: we re-emit a MediaInfo block so
      // step 3 shows what was read and stays correctable.
      showRendered();
    } catch (err: any) {
      fileError.value = err?.message ?? t('fiche.file.analyzeFailed');
    } finally {
      analyzing.value = false;
    }
    return;
  }
  fileError.value = t('fiche.file.unsupported');
}

function seedTitleFrom(fileName: string) {
  const base = fileName.replace(/\.[a-z0-9]{2,4}$/i, '');
  const parsed = parseReleaseName(base);
  if (parsed.title) work.title = parsed.title;
  if (parsed.year) work.year = parsed.year;
  if (parsed.kind === 'tv') work.type = 'tv';
  // The filename often carries the source better than the container knows it.
  const source = parsed.tags.find((tag) => (SOURCES as readonly string[]).includes(tag));
  if (source) release.source = source;
  searchTerm.value = parsed.title || base;
}

function onFilePicked(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void acceptFile(f);
}
function onFileDropped(e: DragEvent) {
  const f = e.dataTransfer?.files?.[0];
  if (f) void acceptFile(f);
}

/* ── 2 · Œuvre ────────────────────────────────────────────────────────── */

const work = reactive<FicheWork>({
  type: 'movie',
  title: draft.releaseName,
  originalTitle: '',
  year: null,
  releaseDate: null,
  runtime: null,
  genres: [],
  countries: [],
  directors: [],
  cast: [],
  seasonCount: null,
  episodeCount: null,
  overview: '',
  posterUrl: '',
  voteAverage: null,
  voteCount: null,
  tmdbId: null,
});

const searchTerm = ref('');
const searching = ref(false);
const searchError = ref('');
const results = ref<Array<Record<string, any>>>([]);

/** The search fires as the title is edited, not on a button. */
let searchToken = 0;
watchDebounced(
  searchTerm,
  async (term) => {
    const q = term.trim();
    results.value = [];
    if (q.length < 3) return;
    const token = ++searchToken;
    searching.value = true;
    searchError.value = '';
    try {
      const res = await $fetch<any>('/api/metadata/search', {
        query: { query: q, source: 'tmdb', type: work.type },
      });
      if (token !== searchToken) return; // une frappe plus récente a gagné
      results.value = Array.isArray(res) ? res : (res?.results ?? res?.data ?? []);
    } catch (err: any) {
      if (token === searchToken) searchError.value = err?.data?.message ?? err?.message ?? '';
    } finally {
      if (token === searchToken) searching.value = false;
    }
  },
  { debounce: 400 },
);

const applying = ref(false);
async function applyResult(hit: Record<string, any>) {
  applying.value = true;
  try {
    const meta = await $fetch<Record<string, any>>('/api/metadata/lookup', {
      query: {
        source: 'tmdb',
        id: String(hit.tmdbId ?? hit.id),
        type: hit.type ?? work.type,
      },
    });
    Object.assign(work, {
      type: meta.type === 'tv' ? 'tv' : 'movie',
      title: meta.title ?? work.title,
      originalTitle: meta.originalTitle ?? '',
      year: meta.year ?? null,
      releaseDate: meta.releaseDate ?? null,
      runtime: meta.runtime ?? null,
      genres: meta.genres ?? [],
      countries: meta.countries ?? [],
      directors: meta.directors ?? [],
      cast: meta.cast ?? [],
      seasonCount: meta.seasonCount ?? null,
      episodeCount: meta.episodeCount ?? null,
      overview: meta.overview ?? '',
      posterUrl: meta.posterUrl ?? '',
      voteAverage: meta.voteAverage ?? null,
      voteCount: meta.voteCount ?? null,
      tmdbId: meta.tmdbId ?? null,
    });
    results.value = [];
  } catch (err: any) {
    searchError.value = err?.data?.message ?? err?.message ?? t('fiche.work.lookupFailed');
  } finally {
    applying.value = false;
  }
}

function listProxy(get: () => string[] | undefined, set: (v: string[]) => void) {
  return computed({
    get: () => (get() ?? []).join(', '),
    set: (v: string) => set(v.split(',').map((x) => x.trim()).filter(Boolean)),
  });
}
const genresText = listProxy(() => work.genres, (v) => (work.genres = v));
const countryText = listProxy(() => work.countries, (v) => (work.countries = v));
const directorText = listProxy(() => work.directors, (v) => (work.directors = v));
const castText = computed({
  get: () => (work.cast ?? []).map((c) => c.name).join(', '),
  set: (v: string) =>
    (work.cast = v.split(',').map((x) => x.trim()).filter(Boolean).map((name) => ({ name }))),
});

/* ── 3 · Technique ────────────────────────────────────────────────────── */

/* The lists offered by the selects. They close nothing off: every field keeps
   an "Other" entry that reopens free input, because no list will ever hold
   everything in circulation. */
const QUALITIES = [
  'UHD Full BluRay',
  'UHD-Remux',
  'Full BluRay',
  'BluRay-Remux',
  '2160p',
  '1080p',
  '1080i',
  '720p',
  '720i',
  'SD',
] as const;
const CONTAINERS = ['MKV', 'MP4', 'AVI', 'M2TS', 'TS', 'ISO'] as const;
const VIDEO_CODECS = [
  'x264',
  'x265',
  'H.264',
  'H.265',
  'AV1',
  'VP9',
  'VP8',
  'VC-1',
  'XviD',
  'DivX',
  'MPEG-2',
] as const;
const SOURCES = [
  'BluRay',
  'UHD BluRay',
  'WEB-DL',
  'WEB',
  'WEBRip',
  'HDTV',
  'DVD',
  'DVDRip',
  'HDRip',
  'SATRip',
] as const;
const AUDIO_CODECS = [
  'AAC',
  'AC3',
  'E-AC3',
  'DTS',
  'DTS-HD MA',
  'DTS-HD HRA',
  'DTS-ES',
  'TrueHD',
  'Atmos',
  'FLAC',
  'Opus',
  'MP3',
  'PCM',
] as const;
const CHANNEL_LAYOUTS = ['1.0', '2.0', '2.1', '5.1', '6.1', '7.1'] as const;
const SUBTITLE_FORMATS = ['SRT', 'ASS', 'SSA', 'VOBSUB', 'PGS', 'WebVTT'] as const;
const SUBTITLE_KINDS: SubtitleKind[] = ['full', 'forced', 'sdh'];

const release = reactive<FicheRelease>({
  source: '',
  quality: '',
  container: '',
  videoCodec: '',
  videoBitRate: undefined,
  videoBitRateUnit: undefined,
  totalSize: undefined,
  totalSizeUnit: undefined,
  fileCount: 1,
  releaseName: '',
});

/**
 * Copies what the file delivered into the specs. Without `force`, only the
 * still-empty fields are filled: what the user corrected belongs to them.
 * `force` is for a new file arriving, which must refresh everything rather than
 * leave the previous file's values lying around.
 */
function syncSpecs(s: TechnicalSheet, force = false) {
  const v = s.video[0];
  const bitRate = v?.bitRate ?? s.overallBitRate;
  const set = <K extends keyof FicheRelease>(key: K, value: FicheRelease[K]) => {
    if (force || !release[key]) release[key] = value;
  };
  set('container', prettyContainer(s.container));
  set('quality', resolutionLabel(v?.width, v?.height) ?? '');
  set('videoCodec', v ? prettyVideoFormat(v.format, v.encoder) : '');

  /* A unit only means anything relative to its value: it is chosen at the
     moment the value is written, not separately. Treating it as an independent
     field let the display's default unit win, and a 12 Mbps bitrate announced
     itself as "12000 Kbps". Once the value is in place,
     le choix de l'utilisateur tient. */
  if (force || !release.videoBitRate) {
    release.videoBitRate = bitRate;
    release.videoBitRateUnit = v?.bitRateUnit ?? pickBitRateUnit(bitRate);
  }
  if (force || !release.totalSize) {
    release.totalSize = s.fileSize;
    release.totalSizeUnit = s.fileSizeUnit ?? pickSizeUnit(s.fileSize);
  }
}
watch(sheet, (s) => syncSpecs(s), { deep: true });

/**
 * The "paste MediaInfo" area: an entry point, not a mirror.
 *
 * We drop the block read from the file there so the user can see what was
 * understood and correct it wholesale; any keystroke feeds it back into the
 * model. The text we just wrote there is ignored, otherwise the size's display
 * rounding would flow back into the data on every analysis.
 */
const pastedMediaInfo = ref('');
let lastRendered = '';

function showRendered() {
  lastRendered = renderMediaInfo(sheet.value);
  pastedMediaInfo.value = lastRendered;
}

watch(pastedMediaInfo, (raw) => {
  if (!raw.trim() || raw === lastRendered) return;
  const parsed = parseMediaInfoText(raw);
  if (!isSheetEmpty(parsed)) sheet.value = parsed;
});

/* ── Pistes ───────────────────────────────────────────────────────────── */

function trackList(kind: 'audio' | 'text') {
  return kind === 'audio' ? sheet.value.audio : sheet.value.text;
}
function addTrack(kind: 'audio' | 'text') {
  trackList(kind).push(emptyTrack(kind));
}
function removeTrack(kind: 'audio' | 'text', index: number) {
  trackList(kind).splice(index, 1);
}

/** Forcé / complet / SDH s'excluent : deux booléens, un seul choix exposé. */
function subtitleKind(t: MediaTrack): SubtitleKind {
  if (t.isForced) return 'forced';
  if (t.isSdh) return 'sdh';
  return 'full';
}
function setSubtitleKind(t: MediaTrack, kind: SubtitleKind) {
  t.isForced = kind === 'forced';
  t.isSdh = kind === 'sdh';
}

/** "🇫🇷 Français" — the code alone means nothing to anyone in a select. */
function langLabel(code: string): string {
  const { flag, name } = languageLabel(code);
  return flag ? `${flag} ${name}` : name;
}

const nameParts = ref<ReleaseNameParts>({ title: '' });
const useSpaces = ref(false);

/* The proposed name keeps recomputing until the user takes it over by hand —
   hence the flag rather than a plain watch that would overwrite their input. */
const releaseNameTouched = ref(false);
watchEffect(() => {
  const parts = deriveReleaseParts(work.title, work.year, sheet.value, release.source);
  nameParts.value = parts;
  if (!releaseNameTouched.value) {
    release.releaseName = formatReleaseName(parts, useSpaces.value);
  }
});

/* ── 4 · Sortie ───────────────────────────────────────────────────────── */

const options = reactive(defaultOptions());

/**
 * A row of the listing-template catalogue. `mine` and `isDefault` are decided
 * server-side and taken at face value here — the wizard never re-derives
 * ownership from an id it happens to hold.
 */
interface FicheTemplateRow {
  id: string;
  name: string;
  content: string;
  mine?: boolean;
  isDefault?: boolean;
}

/* The built-in template is code and not a row (see ficheTemplate.ts), so it
   needs a select value no row can answer to: ids are UUIDs generated by the
   API, and the empty string is not one. */
const BUILTIN_TEMPLATE_ID = '';

/* The wizard's only requests that are not a TMDb lookup, and there are TWO of
   them on purpose.
   One call with `scope=all` returned a single page of the union ordered by
   creation date, so a member whose own template was older than 24 curated site
   templates did not get it back at all: their default silently fell through to
   the built-in layout and their own work was missing from the picker. Asking
   for the two scopes separately makes that impossible — `scope=mine` is
   bounded by the quota, so the member's own rows are always all of them.
   `server: false` keeps both off the SSR path — the page always renders on
   step 1, the picker lives on step 4 — and a catalogue that answers 404 or 500
   leaves the list empty, which degrades to the built-in template instead of
   breaking the step. The response shape is read leniently for the same reason:
   the list route may paginate (`data`) or not (`items`), and neither spelling
   should decide whether a listing can be generated at all. */
type TemplateListShape = { data?: FicheTemplateRow[]; items?: FicheTemplateRow[] };

const { data: mineList } = await useFetch<TemplateListShape>('/api/me/templates', {
  key: 'fiche-templates-mine',
  query: { scope: 'mine', limit: 50 },
  lazy: true,
  server: false,
  default: () => ({ data: [] }),
});
const { data: siteList } = await useFetch<TemplateListShape>('/api/me/templates', {
  key: 'fiche-templates-site',
  query: { scope: 'site', limit: 50 },
  lazy: true,
  server: false,
  default: () => ({ data: [] }),
});

/* A row without its content cannot render anything; offering its name would
   offer an empty listing. */
const usable = (list: TemplateListShape | null | undefined): FicheTemplateRow[] => {
  const rows = list?.data ?? list?.items ?? [];
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r.content === 'string') : [];
};

const myTemplates = computed(() => usable(mineList.value));
const siteTemplates = computed(() => usable(siteList.value));
const templates = computed(() => [...myTemplates.value, ...siteTemplates.value]);

const templateId = ref(BUILTIN_TEMPLATE_ID);

/* Preselect the user's default, but only until they touch the picker — a
   refresh of the catalogue must never move a choice already made. */
const templatePicked = ref(false);
watch(
  myTemplates,
  (rows) => {
    if (templatePicked.value) return;
    const preferred = rows.find((r) => r.isDefault);
    if (preferred) templateId.value = preferred.id;
  },
  { immediate: true },
);

const activeTemplate = computed(
  () => templates.value.find((r) => r.id === templateId.value) ?? null,
);
/* Falls back to the built-in when the selected row is gone, so a template
   deleted in another tab cannot blank the output. */
const templateSource = computed(() => activeTemplate.value?.content ?? DEFAULT_FICHE_TEMPLATE);


const renderWith = (template: string) =>
  renderFiche(template, work, release, sheet.value, options);

/* Rendering is fallible — a stored template can be malformed, or push the
   output past the engine's cap — and an exception raised inside a computed
   empties the whole step. So the failure is carried as a value: the built-in
   listing is rendered meanwhile, which keeps copy and hand-back working while
   the message is shown next to the picker. */
const rendered = computed<{ bbcode: string; error: string | null }>(() => {
  try {
    return { bbcode: renderWith(templateSource.value), error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    try {
      return { bbcode: renderWith(DEFAULT_FICHE_TEMPLATE), error };
    } catch {
      // The built-in fails too: the inputs themselves are over the cap, so
      // there is no listing to show — only the reason.
      return { bbcode: '', error };
    }
  }
});
const bbcode = computed(() => rendered.value.bbcode);

/**
 * The first line the chosen template actually emits, so the picker says
 * something about the layout before it is applied.
 *
 * Rendered output rather than raw source: `[center][font=Verdana][color=…]` is
 * not a description of anything, whereas the title line it produces is. Taken
 * from the already-computed listing so this costs nothing — and truncated,
 * because this is a hint next to a control, not a second preview.
 */
const templateShape = computed(() => {
  const line = bbcode.value
    .split('\n')
    .map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
    .find((l) => l.length > 0);
  if (!line) return '';
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
});
const templateError = computed(() => rendered.value.error);

/* Three of the four checkboxes are folded into the variables themselves
   (buildFicheContext), so they bite whatever a template does with them.
   INCLUDE_TECHNICAL cannot be: it gates the 'Sous-titres :' label, which hangs
   on the option and not on the data. A template that never opens that section
   keeps printing its own technical scaffolding around emptied values, which
   reads as a broken checkbox — so say it, rather than override the author. */
const technicalGateMissing = computed(() => {
  if (!activeTemplate.value || options.includeTechnical) return false;
  try {
    return !templateVariables(templateSource.value).includes('INCLUDE_TECHNICAL');
  } catch {
    // Malformed template: `templateError` already says so, once is enough.
    return false;
  }
});

const preview = computed(() => sanitizeRichHtml(bbcodeToHtml(bbcode.value)));
const nfo = computed(() => buildNfo(release.releaseName || work.title, sheet.value));
const nfoOpen = ref(false);

const copied = ref('');
async function copy(what: 'bbcode' | 'nfo' | 'name') {
  const value =
    what === 'bbcode' ? bbcode.value : what === 'nfo' ? nfo.value : release.releaseName;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = what;
    setTimeout(() => (copied.value = ''), 2000);
  } catch {
    notify.error(t('fiche.actions.copyFailed'));
  }
}

function sendToUpload() {
  draft.handBack({
    bbcode: bbcode.value,
    nfo: nfo.value,
    title: release.releaseName || work.title,
  });
  navigateTo('/torrents/upload');
}

/* Arriving from upload with a torrent already picked: skip step 1. */
onMounted(() => {
  if (draft.hasTorrent) {
    pickedName.value = draft.torrentFile?.name ?? '';
    if (draft.releaseName) {
      work.title = draft.releaseName;
      searchTerm.value = draft.releaseName;
    }
    goTo('work');
  }
});
</script>

<template>
  <div class="upload-page fiche-page">
    <header class="upload-header">
      <NuxtLink to="/torrents/upload" class="back-link">
        <Icon name="ph:arrow-left-bold" />
        {{ $t('fiche.backToUpload') }}
      </NuxtLink>
      <div class="upload-title-row">
        <div>
          <p class="page-eyebrow">{{ $t('fiche.eyebrow') }}</p>
          <h1 class="page-title">
            {{ $t('fiche.titleLead') }}
            <span class="page-title-accent">{{ $t('fiche.titleAccent') }}</span>
          </h1>
        </div>
      </div>

      <ol class="fiche-steps">
        <li
          v-for="(s, i) in STEPS"
          :key="s"
          class="fiche-step"
          :class="{ 'is-current': s === step, 'is-done': i < stepIndex }"
        >
          <button type="button" :disabled="i > stepIndex" @click="goTo(s)">
            <span class="fiche-step-num">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="fiche-step-label">{{ $t(`fiche.steps.${s}`) }}</span>
          </button>
        </li>
      </ol>
    </header>

    <div class="fiche-shell">
      <!-- 1 · Fichier -->
      <section v-if="step === 'file'" class="form-section">
        <div class="section-body">
          <p class="section-help">{{ $t('fiche.file.help') }}</p>

          <div
            class="drop-zone drop-zone--tall"
            :class="{ 'drop-zone--filled': !!pickedName }"
            @dragover.prevent
            @drop.prevent="onFileDropped"
          >
            <input
              type="file"
              class="fiche-file-input"
              accept=".mkv,.mp4,.avi,.mov,.ts,.m2ts,.iso,.nfo,.txt,.torrent,video/*"
              :disabled="analyzing"
              @change="onFilePicked"
            />
            <div class="drop-icon"><Icon name="ph:file-video-bold" /></div>
            <p class="drop-headline">
              {{ analyzing ? $t('fiche.file.analyzing') : (pickedName || $t('fiche.file.drop')) }}
            </p>
            <p class="drop-sub">{{ $t('fiche.file.formats') }}</p>
          </div>

          <p v-if="fileError" class="lookup-error">{{ fileError }}</p>
          <p v-if="!isSheetEmpty(sheet)" class="section-help section-help--auto">
            {{ $t('fiche.file.analysed', {
              v: sheet.video.length, a: sheet.audio.length, s: sheet.text.length,
            }) }}
          </p>

          <div class="fiche-nav">
            <button type="button" class="btn-ghost" @click="goTo('work')">
              {{ $t('fiche.file.manual') }}
            </button>
            <button type="button" class="btn btn-primary action-submit" @click="next">
              {{ $t('fiche.next') }}
            </button>
          </div>
        </div>
      </section>

      <!-- 2 · Œuvre -->
      <section v-else-if="step === 'work'" class="form-section">
        <div class="section-body">
          <p class="section-help">{{ $t('fiche.work.help') }}</p>

          <label class="field-row">
            <span class="field-label">{{ $t('fiche.work.search') }}</span>
            <input v-model="searchTerm" type="text" class="input field-input" />
          </label>

          <p v-if="searching" class="section-help">{{ $t('fiche.work.searching') }}</p>
          <p v-if="searchError" class="lookup-error">{{ searchError }}</p>

          <ul v-if="results.length" class="fiche-results">
            <li v-for="hit in results.slice(0, 6)" :key="hit.id ?? hit.tmdbId">
              <button type="button" :disabled="applying" @click="applyResult(hit)">
                <img v-if="hit.posterUrl" :src="hit.posterUrl" alt="" />
                <span class="fiche-result-body">
                  <strong>{{ hit.title }}</strong>
                  <small>{{ [hit.year, hit.type].filter(Boolean).join(' · ') }}</small>
                </span>
              </button>
            </li>
          </ul>

          <div class="id-grid">
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.name') }}</span>
              <input v-model="work.title" type="text" class="input field-input" />
            </label>
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.originalName') }}</span>
              <input v-model="work.originalTitle" type="text" class="input field-input" />
            </label>
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.kind') }}</span>
              <select v-model="work.type" class="input field-input field-input--select">
                <option value="movie">{{ $t('fiche.work.movie') }}</option>
                <option value="tv">{{ $t('fiche.work.tv') }}</option>
              </select>
            </label>
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.year') }}</span>
              <input v-model.number="work.year" type="number" class="input field-input" />
            </label>
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.releaseDate') }}</span>
              <input v-model="work.releaseDate" type="date" class="input field-input" />
            </label>
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.runtime') }}</span>
              <input v-model.number="work.runtime" type="number" class="input field-input" />
            </label>
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.country') }}</span>
              <input v-model="countryText" type="text" class="input field-input" />
            </label>
            <label class="field-row">
              <span class="field-label">{{ $t('fiche.work.director') }}</span>
              <input v-model="directorText" type="text" class="input field-input" />
            </label>
            <template v-if="work.type === 'tv'">
              <label class="field-row">
                <span class="field-label">{{ $t('fiche.work.seasons') }}</span>
                <input v-model.number="work.seasonCount" type="number" class="input field-input" />
              </label>
              <label class="field-row">
                <span class="field-label">{{ $t('fiche.work.episodes') }}</span>
                <input v-model.number="work.episodeCount" type="number" class="input field-input" />
              </label>
            </template>
          </div>

          <label class="field-row">
            <span class="field-label">{{ $t('fiche.work.genres') }}</span>
            <input v-model="genresText" type="text" class="input field-input" />
          </label>
          <label class="field-row">
            <span class="field-label">{{ $t('fiche.work.cast') }}</span>
            <input v-model="castText" type="text" class="input field-input" />
          </label>
          <label class="field-row">
            <span class="field-label">{{ $t('fiche.work.poster') }}</span>
            <input v-model="work.posterUrl" type="url" class="input field-input" />
          </label>
          <label class="field-row">
            <span class="field-label">{{ $t('fiche.work.overview') }}</span>
            <textarea v-model="work.overview" rows="5" class="input field-input" />
          </label>

          <div class="fiche-nav">
            <button type="button" class="btn-ghost" @click="back">{{ $t('fiche.back') }}</button>
            <button type="button" class="btn btn-primary action-submit" @click="next">{{ $t('fiche.next') }}</button>
          </div>
        </div>
      </section>

      <!-- 3 · Technique -->
      <section v-else-if="step === 'tech'" class="form-section">
        <div class="section-body">
          <p class="section-help">{{ $t('fiche.tech.help') }}</p>

          <div class="id-grid">
            <div class="field-row">
              <span class="field-label">{{ $t('fiche.tech.quality') }}</span>
              <FicheCombo
                v-model="release.quality"
                :options="QUALITIES"
                :empty-label="$t('fiche.tech.none')"
              />
            </div>
            <div class="field-row">
              <span class="field-label">{{ $t('fiche.tech.container') }}</span>
              <FicheCombo
                v-model="release.container"
                :options="CONTAINERS"
                :empty-label="$t('fiche.tech.none')"
              />
            </div>
            <div class="field-row">
              <span class="field-label">{{ $t('fiche.tech.codec') }}</span>
              <FicheCombo
                v-model="release.videoCodec"
                :options="VIDEO_CODECS"
                :empty-label="$t('fiche.tech.none')"
              />
            </div>
            <div class="field-row">
              <span class="field-label">{{ $t('fiche.tech.source') }}</span>
              <FicheCombo
                v-model="release.source"
                :options="SOURCES"
                :empty-label="$t('fiche.tech.none')"
              />
            </div>
            <div class="field-row">
              <span class="field-label">{{ $t('fiche.tech.bitrate') }}</span>
              <FicheAmount
                v-model:base="release.videoBitRate"
                v-model:unit="release.videoBitRateUnit"
                kind="bitrate"
              />
            </div>
            <div class="field-row">
              <span class="field-label">{{ $t('fiche.tech.size') }}</span>
              <FicheAmount
                v-model:base="release.totalSize"
                v-model:unit="release.totalSizeUnit"
                kind="size"
              />
            </div>
          </div>

          <!-- Pistes audio -->
          <section class="fiche-track-group">
            <header class="fiche-track-group-head">
              <h3>{{ $t('fiche.tech.audioTitle') }}</h3>
              <button
                type="button"
                class="btn-ghost btn-ghost--small"
                @click="addTrack('audio')"
              >
                <Icon name="ph:plus-bold" />
                {{ $t('fiche.tech.addTrack') }}
              </button>
            </header>
            <p v-if="!sheet.audio.length" class="section-help">
              {{ $t('fiche.tech.noAudio') }}
            </p>
            <article
              v-for="(track, i) in sheet.audio"
              :key="`audio-${i}`"
              class="fiche-track-card"
            >
              <header class="fiche-track-head">
                <span class="fiche-track-index">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="fiche-track-summary">{{ audioLine(track).trim() }}</span>
                <button
                  type="button"
                  class="fiche-track-remove"
                  :title="$t('fiche.tech.removeTrack')"
                  :aria-label="$t('fiche.tech.removeTrack')"
                  @click="removeTrack('audio', i)"
                >
                  <Icon name="ph:trash-bold" />
                </button>
              </header>
              <div class="fiche-track-grid">
                <div class="field-row">
                  <span class="field-label">{{ $t('fiche.tech.language') }}</span>
                  <FicheCombo
                    v-model="track.language"
                    :options="LANGUAGE_OPTIONS"
                    :label-for="langLabel"
                    :empty-label="$t('fiche.tech.none')"
                  />
                </div>
                <div class="field-row">
                  <span class="field-label">{{ $t('fiche.tech.codecAudio') }}</span>
                  <FicheCombo
                    v-model="track.format"
                    :options="AUDIO_CODECS"
                    :empty-label="$t('fiche.tech.none')"
                  />
                </div>
                <div class="field-row">
                  <span class="field-label">{{ $t('fiche.tech.channels') }}</span>
                  <FicheCombo
                    v-model="track.channels"
                    :options="CHANNEL_LAYOUTS"
                    :empty-label="$t('fiche.tech.none')"
                  />
                </div>
                <div class="field-row">
                  <span class="field-label">{{ $t('fiche.tech.bitrateTrack') }}</span>
                  <FicheAmount
                    v-model:base="track.bitRate"
                    v-model:unit="track.bitRateUnit"
                    kind="bitrate"
                  />
                </div>
              </div>
              <label class="fiche-check">
                <input v-model="track.isDefault" type="checkbox" />
                <span>{{ $t('fiche.tech.defaultTrack') }}</span>
              </label>
            </article>
          </section>

          <!-- Pistes de sous-titres -->
          <section class="fiche-track-group">
            <header class="fiche-track-group-head">
              <h3>{{ $t('fiche.tech.subtitleTitle') }}</h3>
              <button
                type="button"
                class="btn-ghost btn-ghost--small"
                @click="addTrack('text')"
              >
                <Icon name="ph:plus-bold" />
                {{ $t('fiche.tech.addTrack') }}
              </button>
            </header>
            <p v-if="!sheet.text.length" class="section-help">
              {{ $t('fiche.tech.noSubtitle') }}
            </p>
            <article
              v-for="(track, i) in sheet.text"
              :key="`text-${i}`"
              class="fiche-track-card"
            >
              <header class="fiche-track-head">
                <span class="fiche-track-index">{{ String(i + 1).padStart(2, '0') }}</span>
                <span class="fiche-track-summary">{{ subtitleLine(track) }}</span>
                <button
                  type="button"
                  class="fiche-track-remove"
                  :title="$t('fiche.tech.removeTrack')"
                  :aria-label="$t('fiche.tech.removeTrack')"
                  @click="removeTrack('text', i)"
                >
                  <Icon name="ph:trash-bold" />
                </button>
              </header>
              <div class="fiche-track-grid">
                <div class="field-row">
                  <span class="field-label">{{ $t('fiche.tech.language') }}</span>
                  <FicheCombo
                    v-model="track.language"
                    :options="LANGUAGE_OPTIONS"
                    :label-for="langLabel"
                    :empty-label="$t('fiche.tech.none')"
                  />
                </div>
                <div class="field-row">
                  <span class="field-label">{{ $t('fiche.tech.subtitleFormat') }}</span>
                  <FicheCombo
                    v-model="track.format"
                    :options="SUBTITLE_FORMATS"
                    :empty-label="$t('fiche.tech.none')"
                  />
                </div>
              </div>
              <div class="fiche-track-footer">
                <div class="fiche-radio-row" role="radiogroup">
                  <label v-for="kind in SUBTITLE_KINDS" :key="kind" class="fiche-radio">
                    <input
                      type="radio"
                      :name="`subtitle-kind-${i}`"
                      :checked="subtitleKind(track) === kind"
                      @change="setSubtitleKind(track, kind)"
                    />
                    <span>{{ $t(`fiche.tech.subtitleKind.${kind}`) }}</span>
                  </label>
                </div>
                <label class="fiche-check">
                  <input v-model="track.isDefault" type="checkbox" />
                  <span>{{ $t('fiche.tech.defaultTrack') }}</span>
                </label>
              </div>
            </article>
          </section>

          <label class="field-row">
            <span class="field-label">{{ $t('fiche.tech.paste') }}</span>
            <textarea
              v-model="pastedMediaInfo"
              rows="6"
              class="input field-input fiche-mono"
              :placeholder="$t('fiche.tech.pastePlaceholder')"
            />
          </label>

          <div class="fiche-name-card">
            <div class="fiche-name-head">
              <span class="field-label">{{ $t('fiche.tech.releaseName') }}</span>
              <label class="fiche-check">
                <input v-model="useSpaces" type="checkbox" />
                <span>{{ $t('fiche.tech.spaces') }}</span>
              </label>
            </div>
            <div class="field-with-action">
              <input
                v-model="release.releaseName"
                type="text"
                class="input field-input fiche-mono fiche-name-input"
                @input="releaseNameTouched = true"
              />
              <button type="button" class="btn-ghost btn-ghost--small" @click="copy('name')">
                {{ copied === 'name' ? $t('fiche.actions.copied') : $t('fiche.actions.copy') }}
              </button>
            </div>
            <p class="section-help">{{ $t('fiche.tech.namePattern') }}</p>
          </div>

          <div class="fiche-nav">
            <button type="button" class="btn-ghost" @click="back">{{ $t('fiche.back') }}</button>
            <button type="button" class="btn btn-primary action-submit" @click="next">{{ $t('fiche.next') }}</button>
          </div>
        </div>
      </section>

      <!-- 4 · Sortie -->
      <section v-else class="form-section">
        <div class="section-body fiche-output">
          <div class="fiche-output-main">
            <div class="field-row">
              <label class="field-label" for="fiche-template">
                {{ $t('fiche.output.template') }}
              </label>
              <div class="field-with-action">
                <!--
                  A native <select>, not a hand-rolled listbox: the list is a
                  handful of names with no rich rows to render, <optgroup>
                  labels the three sources for free, and this app has no Select
                  component — so rolling one would mean re-implementing
                  keyboard, screen-reader and mobile behaviour that the browser
                  already gets right.
                -->
                <select
                  id="fiche-template"
                  v-model="templateId"
                  class="input field-input field-input--select"
                  @change="templatePicked = true"
                >
                  <option :value="BUILTIN_TEMPLATE_ID">
                    {{ $t('fiche.output.templateBuiltin') }}
                  </option>
                  <optgroup v-if="myTemplates.length" :label="$t('fiche.output.templateMine')">
                    <option v-for="tpl in myTemplates" :key="tpl.id" :value="tpl.id">
                      {{
                        tpl.isDefault
                          ? $t('fiche.output.templateDefaultOption', { name: tpl.name })
                          : tpl.name
                      }}
                    </option>
                  </optgroup>
                  <optgroup
                    v-if="siteTemplates.length"
                    :label="$t('fiche.output.templateSite')"
                  >
                    <option v-for="tpl in siteTemplates" :key="tpl.id" :value="tpl.id">
                      {{ tpl.name }}
                    </option>
                  </optgroup>
                </select>
                <!-- New tab, deliberately. Everything typed into this wizard
                     lives in component state — no store, no localStorage, no
                     route guard — so navigating away from step 4 threw away
                     the title, cast, synopsis, audio tracks and screenshots
                     the author had just entered, with no warning. -->
                <NuxtLink
                  to="/templates"
                  target="_blank"
                  rel="noopener"
                  class="btn-ghost btn-ghost--small fiche-template-link"
                >
                  <Icon name="ph:sliders-bold" />
                  {{ $t('fiche.output.manageTemplates') }}
                </NuxtLink>
              </div>
              <!-- What the choice above actually means, before the author
                   scrolls down to the output: which kind of release the
                   template was written for, and the shape of what it emits.
                   A bare <select> made you pick first and find out after. -->
              <p v-if="templateShape" class="fiche-template-about">
                <!-- Keyed on the shape, not on `activeTemplate`: the built-in
                     layout is what most members have selected and it is not a
                     stored row, so gating the whole line on one left the
                     default case with no summary at all. Category and
                     description exist only on a stored template. -->
                <span v-if="activeTemplate" class="fiche-template-cat">
                  {{ $t(`templates.categories.${activeTemplate.category}`) }}
                </span>
                <span v-if="activeTemplate?.description" class="fiche-template-desc">
                  {{ activeTemplate.description }}
                </span>
                <span class="fiche-template-shape fiche-mono">{{ templateShape }}</span>
              </p>
              <p v-if="templateError" class="fiche-template-error">
                {{ $t('fiche.output.templateBroken') }}
                <span class="fiche-mono">{{ templateError }}</span>
              </p>
            </div>

            <div class="fiche-options">
              <label class="fiche-check">
                <input v-model="options.includePoster" type="checkbox" />
                <span>{{ $t('fiche.output.optPoster') }}</span>
              </label>
              <label class="fiche-check">
                <input v-model="options.includeSynopsis" type="checkbox" />
                <span>{{ $t('fiche.output.optSynopsis') }}</span>
              </label>
              <label class="fiche-check">
                <input v-model="options.includeTechnical" type="checkbox" />
                <span>{{ $t('fiche.output.optTechnical') }}</span>
              </label>
              <label class="fiche-check">
                <input v-model="options.includeCastPhotos" type="checkbox" />
                <span>{{ $t('fiche.output.optCast') }}</span>
              </label>
            </div>
            <p v-if="technicalGateMissing" class="section-help">
              {{ $t('fiche.output.templateNoTechnicalGate') }}
            </p>

            <label class="field-row">
              <span class="field-label">{{ $t('fiche.output.screenshots') }}</span>
              <textarea
                v-model="options.screenshots"
                rows="3"
                class="input field-input fiche-mono"
                :placeholder="$t('fiche.output.screenshotsPlaceholder')"
              />
            </label>

            <label class="field-row">
              <span class="field-label">{{ $t('fiche.output.bbcode') }}</span>
              <textarea :value="bbcode" rows="12" readonly class="input field-input fiche-mono" />
            </label>

            <div class="fiche-nav">
              <button type="button" class="btn-ghost" @click="back">{{ $t('fiche.back') }}</button>
              <button type="button" class="btn-ghost" @click="nfoOpen = true">
                <Icon name="ph:file-text-bold" />
                {{ $t('fiche.output.viewNfo') }}
              </button>
              <button type="button" class="btn-ghost" @click="copy('bbcode')">
                {{ copied === 'bbcode' ? $t('fiche.actions.copied') : $t('fiche.actions.copy') }}
              </button>
              <button type="button" class="btn btn-primary action-submit" @click="sendToUpload">
                {{ $t('fiche.actions.use') }}
              </button>
            </div>
            <p class="action-hint">{{ $t('fiche.actions.hint') }}</p>
          </div>

          <aside class="fiche-preview-panel">
            <h3 class="aside-name">{{ $t('fiche.preview.title') }}</h3>
            <!-- eslint-disable-next-line vue/no-v-html -- passé par sanitizeRichHtml -->
            <div class="fiche-preview" v-html="preview" />
          </aside>
        </div>
      </section>
    </div>

    <!-- NFO viewer, as a popup like fichegen's -->
    <div v-if="nfoOpen" class="fiche-modal" role="dialog" aria-modal="true" @click.self="nfoOpen = false">
      <div class="fiche-modal-card">
        <header class="fiche-modal-head">
          <h3>{{ $t('fiche.output.nfoTitle') }}</h3>
          <button type="button" class="btn-ghost btn-ghost--small" @click="nfoOpen = false">
            {{ $t('common.close') }}
          </button>
        </header>
        <pre class="fiche-nfo">{{ nfo }}</pre>
        <footer class="fiche-nav">
          <button type="button" class="btn-ghost" @click="copy('nfo')">
            {{ copied === 'nfo' ? $t('fiche.actions.copied') : $t('fiche.actions.copy') }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '~/assets/css/upload-form.css';

.fiche-shell {
  max-width: 68rem;
  margin: 0 auto;
  width: 100%;
}

/* ── Step thread ────────────────────────────────────────────────────────── */
.fiche-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.75rem;
  list-style: none;
  margin: 1.5rem 0 0;
  padding: 0;
}
.fiche-step button {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: rgb(var(--fg-subtle));
  font: inherit;
}
.fiche-step button:disabled {
  cursor: default;
  opacity: 0.45;
}
.fiche-step-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}
.fiche-step-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}
.fiche-step.is-current button {
  color: rgb(var(--fg-strong));
}
.fiche-step.is-done button {
  color: rgb(var(--fg-muted));
}

/* ── Dépôt de fichier ───────────────────────────────────────────────────── */
.drop-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.5rem;
  padding: 2.5rem 1.5rem;
  border: 1.5px dashed rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-inset) / 0.4);
  cursor: pointer;
  transition: all 0.18s ease;
}
.drop-zone--tall {
  padding: 4rem 1.5rem;
}
.drop-zone:hover {
  border-color: rgb(var(--fg-default) / 0.4);
  background: rgb(var(--fg-default) / 0.04);
}
.drop-zone--filled {
  border-color: rgba(108, 209, 97, 0.45);
  background: rgba(108, 209, 97, 0.05);
  border-style: solid;
}
.fiche-file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.drop-icon {
  font-size: 1.75rem;
  color: rgb(var(--fg-subtle));
}
.drop-headline {
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
  overflow-wrap: anywhere;
}
.drop-sub {
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  margin: 0;
}

/* ── Résultats de recherche ─────────────────────────────────────────────── */
.fiche-results {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}
.fiche-results button {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  text-align: left;
  padding: 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  color: inherit;
}
.fiche-results button:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.35);
}
.fiche-results img {
  width: 2.4rem;
  height: 3.4rem;
  object-fit: cover;
  border-radius: 3px;
  flex: 0 0 auto;
}
.fiche-result-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.fiche-result-body strong {
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.fiche-result-body small {
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
}

/* ── Divers ─────────────────────────────────────────────────────────────── */
.fiche-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  resize: vertical;
}
/* ── Pistes audio / sous-titres ─────────────────────────────────────────── */
.fiche-track-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.fiche-track-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  border-bottom: 1px solid rgb(var(--line-default));
  padding-bottom: 0.5rem;
}
.fiche-track-group-head h3 {
  margin: 0;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: rgb(var(--fg-muted));
}
.fiche-track-card {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.9rem 1.05rem 1.05rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
}
.fiche-track-head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}
.fiche-track-index {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-subtle));
  flex: 0 0 auto;
}
.fiche-track-summary {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.85rem;
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
}
.fiche-track-remove {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: rgb(var(--fg-subtle));
  cursor: pointer;
  font-size: 0.9rem;
}
.fiche-track-remove:hover {
  color: rgb(var(--danger, 220 70 70));
  background: rgb(var(--fg-default) / 0.06);
}
.fiche-track-grid {
  display: grid;
  gap: 0.75rem 1rem;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
}
.fiche-track-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
}
.fiche-radio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.2rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
}
.fiche-radio {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.fiche-radio input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.fiche-radio span {
  display: inline-block;
  padding: 0.3rem 0.7rem;
  border-radius: calc(var(--radius-sm) - 1px);
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  transition: background 0.15s ease, color 0.15s ease;
}
.fiche-radio input:checked + span {
  background: rgb(var(--fg-default) / 0.1);
  color: rgb(var(--fg-strong));
}
.fiche-radio input:focus-visible + span {
  outline: 2px solid rgb(var(--fg-default) / 0.5);
  outline-offset: 1px;
}
.fiche-template-link {
  white-space: nowrap;
  align-self: center;
}
.fiche-template-error {
  font-size: 0.78rem;
  line-height: 1.5;
  color: rgb(var(--danger));
  overflow-wrap: anywhere;
}
/* One line under the picker: what the template is for, what it is called, and
   the first line it renders. Flex-wrapped rather than a grid so the three
   parts collapse in reading order on a narrow screen. */
.fiche-template-about {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.6rem;
  margin-top: 0.4rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}
.fiche-template-cat {
  flex: none;
  padding: 0.05rem 0.35rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 2px;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.fiche-template-desc {
  flex: 0 1 auto;
  min-width: 0;
}
/* The rendered first line. Dimmer than the description and clipped, because
   it is a sample of the output rather than a statement about the template. */
.fiche-template-shape {
  flex: 1 1 14rem;
  min-width: 0;
  color: rgb(var(--fg-subtle));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fiche-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.6rem 1.25rem;
}
.fiche-check {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}
.fiche-check input {
  accent-color: rgb(var(--fg-default));
}
.fiche-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  justify-content: flex-end;
  padding-top: 0.5rem;
}
.fiche-name-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.15rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
}
.fiche-name-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.fiche-name-input {
  color: rgb(var(--online));
}

/* ── Étape de sortie : formulaire + aperçu côte à côte ───────────────────── */
.fiche-output {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 60rem) {
  .fiche-output {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    align-items: start;
  }
}
.fiche-output-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}
.fiche-preview-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.25rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  max-height: 40rem;
  overflow-y: auto;
  min-width: 0;
}
.fiche-preview {
  font-size: 0.85rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.fiche-preview :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}

/* ── Pop-up NFO ─────────────────────────────────────────────────────────── */
.fiche-modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgb(0 0 0 / 0.6);
}
.fiche-modal-card {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: min(56rem, 100%);
  max-height: 85vh;
  padding: 1.25rem 1.4rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-surface));
  box-shadow: var(--shadow-overlay);
}
.fiche-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.fiche-modal-head h3 {
  margin: 0;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.fiche-nfo {
  flex: 1 1 auto;
  overflow: auto;
  margin: 0;
  padding: 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
