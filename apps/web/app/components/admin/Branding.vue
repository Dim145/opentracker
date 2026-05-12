<template>
  <!--
    /admin/branding — identity atelier.

    The page is laid out like a designer's drafting table:

      • LEFT  — three numbered control blocks (01 Identity / 02
        Copy / 03 Homepage), the operator's worksurface.

      • RIGHT — a sticky stack of "samples". Each sample mimics one
        of the surfaces where the brand actually lands: site
        header, browser tab strip, homepage hero. They update live
        as the operator edits.

      • A single floating save bar at the bottom lights up when any
        field is dirty and PUTs every changed setting in one call.
        Discard rolls back to the last server snapshot.

    On narrow viewports the samples stack horizontally above the
    controls so the operator still sees their work without
    scrolling.
  -->
  <div class="adm">
    <p class="adm-intro">{{ $t('admin.branding.intro') }}</p>

    <div class="adm-grid">
      <!-- ═══════════════════════════════════════════════════════
           LEFT — control blocks
           ═══════════════════════════════════════════════════════ -->
      <div class="adm-form">
        <!-- ── Section 01 — Identity ──────────────────────────── -->
        <section class="block">
          <header class="block-head">
            <span class="block-num">01</span>
            <div class="block-id">
              <h2>{{ $t('admin.branding.identity.title') }}</h2>
              <p>{{ $t('admin.branding.identity.intro') }}</p>
            </div>
          </header>

          <div class="cluster">
            <!-- Site name -->
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.siteName') }}</span>
              <span class="field-hint">{{ $t('admin.branding.siteNameDescription') }}</span>
              <WysiwygEditor
                v-model="form.siteName"
                :placeholder="$t('admin.branding.siteNamePlaceholder')"
                :maxLength="200"
              />
              <div class="field-aux">
                <label class="aux-swatch" :style="{ background: form.siteNameColor || 'transparent' }">
                  <input
                    v-model="form.siteNameColor"
                    type="color"
                    class="aux-swatch-input"
                    :aria-label="$t('admin.branding.siteNameColorTitle')"
                  />
                  <Icon v-if="!form.siteNameColor" name="ph:eyedropper-sample-bold" class="aux-swatch-icon" />
                </label>
                <button
                  v-if="form.siteNameColor"
                  type="button"
                  class="aux-reset"
                  @click="form.siteNameColor = null"
                >
                  {{ $t('admin.branding.reset') }}
                </button>
                <label class="aux-toggle">
                  <input
                    v-model="form.siteNameBold"
                    type="checkbox"
                    class="aux-toggle-input"
                  />
                  <span class="aux-toggle-track" />
                  <span class="aux-toggle-label">{{ $t('admin.branding.bold') }}</span>
                </label>
              </div>
            </div>

            <!-- Subtitle -->
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.subtitle') }}</span>
              <span class="field-hint">{{ $t('admin.branding.subtitleDescription') }}</span>
              <WysiwygEditor
                v-model="form.siteSubtitle"
                :placeholder="$t('admin.branding.subtitlePlaceholder')"
                :maxLength="300"
              />
            </div>

            <!-- Logo type — segmented control -->
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.logoType') }}</span>
              <span class="field-hint">{{ $t('admin.branding.logoTypeDescription') }}</span>
              <div class="segments">
                <button
                  type="button"
                  class="segment"
                  :class="{ 'segment--active': !useCustomImage }"
                  @click="useCustomImage = false"
                >
                  <Icon name="ph:phosphor-logo" />
                  {{ $t('admin.branding.icon') }}
                </button>
                <button
                  type="button"
                  class="segment"
                  :class="{ 'segment--active': useCustomImage }"
                  @click="useCustomImage = true"
                >
                  <Icon name="ph:image-bold" />
                  {{ $t('admin.branding.image') }}
                </button>
              </div>
            </div>

            <!-- Icon mode -->
            <div v-if="!useCustomImage" class="field">
              <span class="field-label">{{ $t('admin.branding.logoIcon') }}</span>
              <span class="field-hint">{{ $t('admin.branding.logoIconDescription') }}</span>
              <div class="icon-row">
                <input
                  v-model="form.siteLogo"
                  type="text"
                  maxlength="100"
                  class="field-input field-input--mono"
                  :placeholder="$t('admin.branding.logoIconPlaceholder')"
                />
                <span class="icon-row-preview">
                  <Icon :name="form.siteLogo" />
                </span>
              </div>
              <div class="quick-icons">
                <span class="quick-icons-label">{{ $t('admin.branding.quickSelect') }}</span>
                <div class="quick-icons-grid">
                  <button
                    v-for="icon in commonIcons"
                    :key="icon"
                    type="button"
                    class="quick-icon"
                    :class="{ 'quick-icon--active': form.siteLogo === icon }"
                    :title="icon"
                    @click="form.siteLogo = icon"
                  >
                    <Icon :name="icon" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Image mode -->
            <div v-else class="field">
              <span class="field-label">{{ $t('admin.branding.logoImage') }}</span>
              <span class="field-hint">{{ $t('admin.branding.logoImageDescription') }}</span>
              <div v-if="form.siteLogoImage" class="dropfile dropfile--filled">
                <div class="dropfile-thumb">
                  <img :src="form.siteLogoImage" :alt="$t('admin.branding.currentLogoAlt')" />
                </div>
                <div class="dropfile-info">
                  <code class="dropfile-path">{{ form.siteLogoImage }}</code>
                  <button type="button" class="dropfile-remove" @click="form.siteLogoImage = null">
                    <Icon name="ph:trash-bold" />
                    {{ $t('admin.branding.remove') }}
                  </button>
                </div>
              </div>
              <label
                class="dropzone"
                :class="{ 'dropzone--over': dragOver }"
                @dragover.prevent="dragOver = true"
                @dragleave="dragOver = false"
                @drop.prevent="handleDrop"
              >
                <input
                  ref="fileInput"
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  class="dropzone-input"
                  @change="handleFileSelect"
                />
                <Icon :name="uploading ? 'ph:circle-notch' : 'ph:upload-simple-bold'" :class="uploading ? 'spin' : ''" />
                <span>{{ uploading ? $t('admin.branding.uploading') : $t('admin.branding.dropOrClick') }}</span>
              </label>
            </div>

            <!-- Favicon -->
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.favicon') }}</span>
              <span class="field-hint">{{ $t('admin.branding.faviconDescription') }}</span>
              <div v-if="form.siteFavicon" class="dropfile dropfile--filled">
                <div class="dropfile-thumb dropfile-thumb--small">
                  <img :src="form.siteFavicon" :alt="$t('admin.branding.currentFaviconAlt')" />
                </div>
                <div class="dropfile-info">
                  <code class="dropfile-path">{{ form.siteFavicon }}</code>
                  <button type="button" class="dropfile-remove" @click="form.siteFavicon = null">
                    <Icon name="ph:trash-bold" />
                    {{ $t('admin.branding.remove') }}
                  </button>
                </div>
              </div>
              <label
                class="dropzone dropzone--compact"
                :class="{ 'dropzone--over': dragOverFavicon }"
                @dragover.prevent="dragOverFavicon = true"
                @dragleave="dragOverFavicon = false"
                @drop.prevent="handleFaviconDrop"
              >
                <input
                  ref="faviconInput"
                  type="file"
                  accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml,image/webp"
                  class="dropzone-input"
                  @change="handleFaviconSelect"
                />
                <Icon :name="uploadingFavicon ? 'ph:circle-notch' : 'ph:browser-bold'" :class="uploadingFavicon ? 'spin' : ''" />
                <span>{{ uploadingFavicon ? $t('admin.branding.uploading') : $t('admin.branding.dropFavicon') }}</span>
              </label>
            </div>
          </div>
        </section>

        <!-- ── Section 02 — Copy ─────────────────────────────── -->
        <section class="block">
          <header class="block-head">
            <span class="block-num">02</span>
            <div class="block-id">
              <h2>{{ $t('admin.branding.copy.title') }}</h2>
              <p>{{ $t('admin.branding.copy.intro') }}</p>
            </div>
          </header>

          <div class="cluster">
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.authTitle') }}</span>
              <span class="field-hint">{{ $t('admin.branding.authTitleDescription') }}</span>
              <WysiwygEditor
                v-model="form.authTitle"
                :placeholder="$t('admin.branding.authTitlePlaceholder')"
                :maxLength="200"
              />
            </div>
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.authSubtitle') }}</span>
              <span class="field-hint">{{ $t('admin.branding.authSubtitleDescription') }}</span>
              <WysiwygEditor
                v-model="form.authSubtitle"
                :placeholder="$t('admin.branding.authSubtitlePlaceholder')"
                :maxLength="500"
              />
            </div>
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.footerContent') }}</span>
              <span class="field-hint">{{ $t('admin.branding.footerContentDescription') }}</span>
              <WysiwygEditor
                v-model="form.footerText"
                :placeholder="`© ${new Date().getFullYear()} ${(stripTags(form.siteName) || 'Trackarr').toUpperCase()}`"
                :maxLength="500"
              />
            </div>
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.pageTitleSuffix') }}</span>
              <span class="field-hint">{{ $t('admin.branding.pageTitleSuffixDescription') }}</span>
              <input
                v-model="form.pageTitleSuffix"
                type="text"
                maxlength="100"
                class="field-input"
                :placeholder="`- ${stripTags(form.siteName) || 'Trackarr'}`"
              />
              <span class="field-hint field-hint--example">
                {{ $t('admin.branding.pageTitleSuffixExample', { suffix: form.pageTitleSuffix || ` - ${stripTags(form.siteName) || 'Trackarr'}` }) }}
              </span>
            </div>
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.welcomeMessage') }}</span>
              <span class="field-hint">{{ $t('admin.branding.welcomeMessageDescription') }}</span>
              <WysiwygEditor
                v-model="form.welcomeMessage"
                :placeholder="$t('admin.branding.welcomeMessagePlaceholder')"
                :maxLength="2000"
              />
            </div>
            <div class="field">
              <span class="field-label">{{ $t('admin.branding.siteRules') }}</span>
              <span class="field-hint">{{ $t('admin.branding.siteRulesDescription') }}</span>
              <WysiwygEditor
                v-model="form.siteRules"
                :placeholder="$t('admin.branding.siteRulesPlaceholder')"
                :maxLength="10000"
              />
            </div>
          </div>
        </section>

        <!-- ── Section 03 — Homepage ─────────────────────────── -->
        <section class="block">
          <header class="block-head">
            <span class="block-num">03</span>
            <div class="block-id">
              <h2>{{ $t('admin.branding.homepage.title') }}</h2>
              <p>{{ $t('admin.branding.homepage.intro') }}</p>
            </div>
          </header>

          <div class="cluster">
            <div class="field">
              <span class="field-label">{{ $t('admin.homepage.heroTitle') }}</span>
              <span class="field-hint">{{ $t('admin.homepage.heroTitleDescription') }}</span>
              <WysiwygEditor
                v-model="form.heroTitle"
                :placeholder="$t('admin.homepage.heroTitlePlaceholder')"
                :maxLength="500"
              />
            </div>
            <div class="field">
              <span class="field-label">{{ $t('admin.homepage.heroSubtitle') }}</span>
              <span class="field-hint">{{ $t('admin.homepage.heroSubtitleDescription') }}</span>
              <WysiwygEditor
                v-model="form.heroSubtitle"
                :placeholder="$t('admin.homepage.heroSubtitlePlaceholder')"
                :maxLength="1000"
              />
            </div>
            <div class="field">
              <span class="field-label">{{ $t('admin.homepage.statusBadge') }}</span>
              <span class="field-hint">{{ $t('admin.homepage.statusBadgeDescription') }}</span>
              <input
                v-model="form.statusBadgeText"
                type="text"
                maxlength="100"
                class="field-input"
                :placeholder="$t('admin.homepage.statusBadgePlaceholder')"
              />
            </div>

            <!-- Feature trio — numbered editor. -->
            <div class="features">
              <span class="features-label">{{ $t('admin.homepage.featureBoxes') }}</span>
              <span class="field-hint">{{ $t('admin.homepage.featureLabelDescription') }}</span>
              <ul class="features-list">
                <li
                  v-for="(feature, index) in form.features"
                  :key="index"
                  class="feature"
                  :style="{ '--stagger': `${index * 60}ms` }"
                >
                  <span class="feature-num tabular-nums">{{ String(index + 1).padStart(2, '0') }}</span>
                  <div class="feature-body">
                    <label class="feature-sublabel">{{ $t('admin.homepage.featureTitleLabel') }}</label>
                    <WysiwygEditor
                      v-model="feature.title"
                      :placeholder="$t('admin.homepage.featureTitlePlaceholder')"
                      :maxLength="300"
                    />
                    <label class="feature-sublabel">{{ $t('admin.homepage.featureDescLabel') }}</label>
                    <WysiwygEditor
                      v-model="feature.description"
                      :placeholder="$t('admin.homepage.featureDescPlaceholder')"
                      :maxLength="1000"
                    />
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      <!-- ═══════════════════════════════════════════════════════
           RIGHT — sticky sample stack
           ═══════════════════════════════════════════════════════
           Each tile is a tiny "print" of one of the surfaces where
           the brand will actually land. The eyebrow above each
           sample names the surface; the body mirrors the rendered
           output as faithfully as a thumbnail allows. -->
      <aside class="adm-preview">
        <div class="preview-header">
          <span class="preview-eyebrow">
            <span class="preview-eyebrow-rule" aria-hidden="true" />
            {{ $t('admin.branding.livePreview') }}
          </span>
          <span class="preview-tick" aria-hidden="true">●</span>
        </div>

        <div class="preview-stack">
          <!-- Sample A — Site header (navbar context). -->
          <article class="sample">
            <span class="sample-tag">
              <span class="sample-tag-arrow">→</span>
              {{ $t('admin.branding.previewHeader') }}
            </span>
            <div class="sample-surface sample-surface--nav">
              <div class="nav-mock">
                <div
                  class="nav-logo"
                  :class="{ 'nav-logo--img': useCustomImage && form.siteLogoImage }"
                >
                  <img
                    v-if="useCustomImage && form.siteLogoImage"
                    :src="form.siteLogoImage"
                    alt=""
                    class="nav-logo-img"
                    @error="handleImageError"
                  />
                  <Icon v-else :name="form.siteLogo" class="nav-logo-icon" />
                </div>
                <div class="nav-id">
                  <span
                    class="nav-name"
                    :class="{ 'nav-name--bold': form.siteNameBold }"
                    :style="form.siteNameColor ? { color: form.siteNameColor } : {}"
                    v-html="sanitizeHtml(form.siteName) || 'Trackarr'"
                  />
                  <span
                    v-if="form.siteSubtitle"
                    class="nav-subtitle"
                    v-html="sanitizeHtml(form.siteSubtitle)"
                  />
                  <span
                    v-else-if="runtimeVersion"
                    class="nav-subtitle nav-subtitle--ghost"
                  >v{{ runtimeVersion }}</span>
                </div>
              </div>
            </div>
          </article>

          <!-- Sample B — Browser tab strip. -->
          <article class="sample">
            <span class="sample-tag">
              <span class="sample-tag-arrow">→</span>
              {{ $t('admin.branding.previewTab') }}
            </span>
            <div class="sample-surface sample-surface--tab">
              <div class="tab-mock">
                <span class="tab-fav">
                  <img v-if="form.siteFavicon" :src="form.siteFavicon" alt="" class="tab-fav-img" />
                  <Icon v-else :name="form.siteLogo" class="tab-fav-icon" />
                </span>
                <span class="tab-label">
                  {{ $t('admin.branding.previewTabSampleTitle') }}{{ form.pageTitleSuffix || ` — ${stripTags(form.siteName) || 'Trackarr'}` }}
                </span>
                <span class="tab-close" aria-hidden="true">×</span>
              </div>
              <span class="tab-url">
                <Icon name="ph:lock-key-bold" class="tab-url-icon" />
                <span class="tab-url-text">{{ runtimeHost }}</span>
              </span>
            </div>
          </article>

          <!-- Sample C — Homepage hero. -->
          <article class="sample">
            <span class="sample-tag">
              <span class="sample-tag-arrow">→</span>
              {{ $t('admin.branding.previewHero') }}
            </span>
            <div class="sample-surface sample-surface--hero">
              <span class="hero-badge">
                <span class="hero-badge-dot" />
                {{ form.statusBadgeText || $t('admin.homepage.statusBadgePlaceholder') }}
              </span>
              <h3 class="hero-title" v-html="sanitizeHtml(form.heroTitle) || 'Trackarr'" />
              <p
                v-if="form.heroSubtitle"
                class="hero-subtitle"
                v-html="sanitizeHtml(form.heroSubtitle)"
              />
              <p v-else class="hero-subtitle hero-subtitle--ghost">{{ $t('admin.homepage.heroSubtitlePlaceholder') }}</p>
              <div class="hero-features">
                <span
                  v-for="(feat, i) in form.features.slice(0, 3)"
                  :key="i"
                  class="hero-feature-dot"
                  :title="stripTags(feat.title) || `Feature ${i + 1}`"
                />
              </div>
            </div>
          </article>
        </div>
      </aside>
    </div>

    <!-- ── Floating save bar ─────────────────────────────────── -->
    <Transition name="savebar">
      <div v-if="dirty" class="savebar">
        <span class="savebar-status">
          <Icon name="ph:floppy-disk-bold" />
          {{ $t('admin.branding.unsavedChanges', dirtyCount, { n: dirtyCount }) }}
        </span>
        <button
          type="button"
          class="btn btn--ghost"
          :disabled="saving"
          @click="discard"
        >
          {{ $t('common.discard') }}
        </button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!dirty || saving"
          @click="saveAll"
        >
          <Icon
            :name="saving ? 'ph:circle-notch' : 'ph:check-bold'"
            :class="saving ? 'spin' : ''"
          />
          <span>{{ saving ? $t('admin.branding.saving') : $t('common.saveChanges') }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();

interface BrandingForm {
  // Identity
  siteName: string;
  siteLogo: string;
  siteLogoImage: string | null;
  siteFavicon: string | null;
  siteSubtitle: string;
  siteNameColor: string | null;
  siteNameBold: boolean;
  // Copy
  authTitle: string;
  authSubtitle: string;
  footerText: string;
  pageTitleSuffix: string;
  welcomeMessage: string;
  siteRules: string;
  // Homepage
  heroTitle: string;
  heroSubtitle: string;
  statusBadgeText: string;
  features: { title: string; description: string }[];
}

function defaultForm(): BrandingForm {
  return {
    siteName: 'Trackarr',
    siteLogo: 'ph:broadcast-bold',
    siteLogoImage: null,
    siteFavicon: null,
    siteSubtitle: '',
    siteNameColor: null,
    siteNameBold: true,
    authTitle: '',
    authSubtitle: '',
    footerText: '',
    pageTitleSuffix: '',
    welcomeMessage: '',
    siteRules: '',
    heroTitle: 'Trackarr',
    heroSubtitle:
      'High-performance, minimalist P2P tracking engine. Search through our indexed database of verified torrents.',
    statusBadgeText: 'Tracker Online & Operational',
    features: [
      { title: 'High Performance', description: 'Built with Node.js and Redis for sub-millisecond response times and high concurrency support.' },
      { title: 'Multi-Protocol', description: 'Supports HTTP, UDP, and WebSocket protocols for maximum compatibility with all BitTorrent clients.' },
      { title: 'Open Source', description: 'Fully transparent and community-driven. Designed for privacy and efficiency in the P2P ecosystem.' },
    ],
  };
}

const form = reactive<BrandingForm>(defaultForm());
const snapshot = ref<BrandingForm>(defaultForm());

// Logo / favicon upload state
const useCustomImage = ref(false);
const uploading = ref(false);
const uploadingFavicon = ref(false);
const dragOver = ref(false);
const dragOverFavicon = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const faviconInput = ref<HTMLInputElement | null>(null);

const saving = ref(false);

// Cosmetic — surfaced only inside the preview samples.
const runtimeHost = computed(() => {
  if (typeof window === 'undefined') return 'trackarr.local';
  return window.location.host || 'trackarr.local';
});
// Reactive — the client plugin patches `appVersion` into the
// runtime config after a short fetch, so reading it as a non-
// reactive `const` would snapshot the empty fallback and never
// update. The computed picks the value up the moment it lands.
const runtimeVersion = computed(
  () => (useRuntimeConfig().public.appVersion as string | undefined) || ''
);

const commonIcons = [
  'ph:broadcast-bold',
  'ph:globe-bold',
  'ph:rocket-bold',
  'ph:lightning-bold',
  'ph:fire-bold',
  'ph:star-bold',
  'ph:planet-bold',
  'ph:atom-bold',
  'ph:cube-bold',
  'ph:diamond-bold',
  'ph:crown-bold',
  'ph:shield-check-bold',
];

// ── Load settings ────────────────────────────────────────────
interface SettingsResponse {
  siteName?: string;
  siteLogo?: string;
  siteLogoImage?: string | null;
  siteFavicon?: string | null;
  siteSubtitle?: string | null;
  siteNameColor?: string | null;
  siteNameBold?: boolean;
  authTitle?: string | null;
  authSubtitle?: string | null;
  footerText?: string | null;
  pageTitleSuffix?: string | null;
  welcomeMessage?: string | null;
  siteRules?: string | null;
  heroTitle?: string;
  heroSubtitle?: string;
  statusBadgeText?: string;
  feature1Title?: string;
  feature1Desc?: string;
  feature2Title?: string;
  feature2Desc?: string;
  feature3Title?: string;
  feature3Desc?: string;
}

onMounted(async () => {
  try {
    const settings = await $fetch<SettingsResponse>('/api/admin/settings');
    Object.assign(form, {
      siteName: settings.siteName || form.siteName,
      siteLogo: settings.siteLogo || form.siteLogo,
      siteLogoImage: settings.siteLogoImage ?? null,
      siteFavicon: settings.siteFavicon ?? null,
      siteSubtitle: settings.siteSubtitle ?? '',
      siteNameColor: settings.siteNameColor ?? null,
      siteNameBold: settings.siteNameBold ?? true,
      authTitle: settings.authTitle ?? '',
      authSubtitle: settings.authSubtitle ?? '',
      footerText: settings.footerText ?? '',
      pageTitleSuffix: settings.pageTitleSuffix ?? '',
      welcomeMessage: settings.welcomeMessage ?? '',
      siteRules: settings.siteRules ?? '',
      heroTitle: settings.heroTitle || form.heroTitle,
      heroSubtitle: settings.heroSubtitle || form.heroSubtitle,
      statusBadgeText: settings.statusBadgeText || form.statusBadgeText,
      features: [
        { title: settings.feature1Title || form.features[0]!.title, description: settings.feature1Desc || form.features[0]!.description },
        { title: settings.feature2Title || form.features[1]!.title, description: settings.feature2Desc || form.features[1]!.description },
        { title: settings.feature3Title || form.features[2]!.title, description: settings.feature3Desc || form.features[2]!.description },
      ],
    });
    useCustomImage.value = !!settings.siteLogoImage;
    snapshot.value = structuredClone(toRaw(form));
    // The initial hydrate above tripped the deep watcher — clear
    // the flag on the next tick so the savebar doesn't show up at
    // page load.
    await nextTick();
    dirty.value = false;
  } catch (error) {
    console.error('Failed to load branding settings:', error);
  }
});

// ── Dirty tracking ──────────────────────────────────────────
// A deep watcher flips the flag the first time any form field
// changes after a snapshot reset. The previous implementation ran
// `JSON.stringify(form) !== JSON.stringify(snapshot)` from a
// `computed` — Vue re-evaluated it on every reactive read (so
// every keystroke), and with three WYSIWYG fields it dominated
// the per-keystroke cost. The flag is reset to false on save +
// discard + initial load.
const dirty = ref(false);
watch(form, () => { dirty.value = true; }, { deep: true });

// dirtyCount is only evaluated when the savebar is actually
// rendered (computed is lazy). Each `dirty: true` keystroke
// re-renders the savebar so this still gets a fresh count, but
// it only does work when the bar is visible.
const dirtyCount = computed(() => {
  if (!dirty.value) return 0;
  let n = 0;
  const keys: (keyof BrandingForm)[] = [
    'siteName', 'siteLogo', 'siteLogoImage', 'siteFavicon', 'siteSubtitle',
    'siteNameColor', 'siteNameBold', 'authTitle', 'authSubtitle', 'footerText',
    'pageTitleSuffix', 'welcomeMessage', 'siteRules', 'heroTitle', 'heroSubtitle',
    'statusBadgeText',
  ];
  for (const k of keys) {
    if (JSON.stringify(form[k]) !== JSON.stringify(snapshot.value[k])) n += 1;
  }
  if (JSON.stringify(form.features) !== JSON.stringify(snapshot.value.features)) n += 1;
  return n;
});

// The DOMPurify-backed `sanitizeHtml` from `~/utils/markdown` is
// auto-imported by Nuxt and used in v-html bindings throughout the
// preview. We avoid declaring a local regex variant — it would let
// `<b onmouseover=alert(1)>` slip through because the `on…=`
// strip only matches double-quoted attribute values.

function stripTags(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/<[^>]+>/g, '').trim();
}

// ── File uploads (logo) ──────────────────────────────────────
function handleDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files[0];
  if (file) uploadFile(file);
}
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) uploadFile(file);
  input.value = '';
}
async function uploadFile(file: File) {
  if (uploading.value) return;
  uploading.value = true;
  try {
    const fd = new FormData();
    fd.append('logo', file);
    const result = await $fetch<{ url: string }>('/api/admin/logo', { method: 'POST', body: fd });
    form.siteLogoImage = result.url;
  } catch (err) {
    console.error('Failed to upload logo:', err);
    notifications.error(t('admin.branding.uploadFailed'));
  } finally {
    uploading.value = false;
  }
}
function handleImageError(e: Event) {
  const target = e.target as HTMLImageElement;
  target.style.display = 'none';
}

// ── File uploads (favicon) ───────────────────────────────────
function handleFaviconDrop(e: DragEvent) {
  dragOverFavicon.value = false;
  const file = e.dataTransfer?.files[0];
  if (file) uploadFavicon(file);
}
function handleFaviconSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) uploadFavicon(file);
  input.value = '';
}
async function uploadFavicon(file: File) {
  if (uploadingFavicon.value) return;
  uploadingFavicon.value = true;
  try {
    const fd = new FormData();
    fd.append('favicon', file);
    const result = await $fetch<{ url: string }>('/api/admin/favicon', { method: 'POST', body: fd });
    form.siteFavicon = result.url;
  } catch (err) {
    console.error('Failed to upload favicon:', err);
    notifications.error(t('admin.branding.uploadFailed'));
  } finally {
    uploadingFavicon.value = false;
  }
}

// ── Save ────────────────────────────────────────────────────
async function saveAll() {
  if (saving.value || !dirty.value) return;
  saving.value = true;
  try {
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      body: {
        siteName: form.siteName,
        siteLogo: form.siteLogo,
        siteLogoImage: useCustomImage.value ? form.siteLogoImage : null,
        siteSubtitle: form.siteSubtitle || null,
        siteNameColor: form.siteNameColor || null,
        siteNameBold: form.siteNameBold,
        authTitle: form.authTitle || null,
        authSubtitle: form.authSubtitle || null,
        footerText: form.footerText || null,
        pageTitleSuffix: form.pageTitleSuffix || null,
        welcomeMessage: form.welcomeMessage || null,
        siteRules: form.siteRules || null,
        heroTitle: form.heroTitle,
        heroSubtitle: form.heroSubtitle,
        statusBadgeText: form.statusBadgeText,
        feature1Title: form.features[0]?.title ?? '',
        feature1Desc: form.features[0]?.description ?? '',
        feature2Title: form.features[1]?.title ?? '',
        feature2Desc: form.features[1]?.description ?? '',
        feature3Title: form.features[2]?.title ?? '',
        feature3Desc: form.features[2]?.description ?? '',
      },
    });
    snapshot.value = structuredClone(toRaw(form));
    // Wait one tick so the watcher's queued tick (from the value
    // assignment above) settles before we clear the flag.
    await nextTick();
    dirty.value = false;
    notifications.success(t('admin.branding.saved'));
  } catch (err) {
    console.error('Failed to save branding:', err);
    notifications.error(t('admin.branding.saveFailed'));
  } finally {
    saving.value = false;
  }
}

async function discard() {
  Object.assign(form, structuredClone(toRaw(snapshot.value)));
  useCustomImage.value = !!form.siteLogoImage;
  await nextTick();
  dirty.value = false;
}
</script>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────── */
.adm {
  position: relative;
  padding-bottom: 5rem; /* room for the floating save bar */
}

.adm-intro {
  margin: 0 0 1.5rem;
  font-size: 0.82rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
  max-width: 64ch;
}

/* ── Two-column atelier layout ────────────────────────────── */
.adm-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2.25rem;
  position: relative;
}
@media (min-width: 1100px) {
  .adm-grid {
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 2.75rem;
  }
  .adm-grid::before {
    /* Gold hairline threading the two columns together. */
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    right: 376px; /* = 360px sidebar + half the gap */
    width: 1px;
    background: linear-gradient(
      to bottom,
      rgba(212, 167, 52, 0) 0%,
      rgba(212, 167, 52, 0.32) 14%,
      rgba(212, 167, 52, 0.32) 86%,
      rgba(212, 167, 52, 0) 100%
    );
    pointer-events: none;
  }
}

/* Form column. */
.adm-form {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  min-width: 0;
}

/* ── Sticky preview column ───────────────────────────────── */
.adm-preview {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}
@media (min-width: 1100px) {
  .adm-preview {
    position: sticky;
    top: 1.25rem;
    align-self: flex-start;
    max-height: calc(100vh - 2.5rem);
    overflow-y: auto;
    /* Hide scrollbar for cleanliness; sample stack should fit
       most viewports anyway. */
    scrollbar-width: thin;
  }
  .adm-preview::-webkit-scrollbar { width: 4px; }
  .adm-preview::-webkit-scrollbar-thumb {
    background: rgba(212, 167, 52, 0.25);
    border-radius: 4px;
  }
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-bottom: 0.5rem;
}
.preview-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #d4a734;
}
.preview-eyebrow-rule {
  display: inline-block;
  width: 22px;
  height: 1px;
  background: #d4a734;
}
.preview-tick {
  font-size: 9px;
  color: rgba(108, 209, 97, 0.85);
  animation: pulse 2.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.preview-stack {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

/* Each sample is a labelled "print" of one surface where the
   brand appears. The tag floats above the surface card. */
.sample {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.sample-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.sample-tag-arrow {
  color: #d4a734;
  font-weight: 700;
}
.sample-surface {
  position: relative;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
  background: rgb(var(--bg-elevated));
  box-shadow: 0 8px 24px -22px rgba(0, 0, 0, 0.55);
}
.sample-surface::before {
  /* Gold hairline along the top of every surface — visual
     consistency across all three samples. */
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 0.85rem;
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0.5) 0%,
    rgba(212, 167, 52, 0.05) 80%,
    rgba(212, 167, 52, 0) 100%
  );
}

/* ── Sample A — Navbar ─────────────────────────────────── */
.sample-surface--nav {
  background: rgb(var(--bg-base));
}
.nav-mock {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.95rem 1.05rem;
}
.nav-logo {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  background: white;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  overflow: hidden;
}
.nav-logo--img {
  background: repeating-conic-gradient(#7a7a7a 0% 25%, #f0f0f0 0% 50%) 50% / 8px 8px;
}
.nav-logo-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.nav-logo-icon {
  font-size: 1.4rem;
  color: #0a0a0a;
}
.nav-id {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}
.nav-name {
  font-size: 1rem;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.01em;
  font-weight: 500;
  line-height: 1.2;
  word-break: break-word;
}
.nav-name--bold { font-weight: 800; }
.nav-name :deep(b),
.nav-name :deep(strong) { font-weight: 800; }
.nav-subtitle {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.05em;
  line-height: 1.3;
  word-break: break-word;
}
.nav-subtitle--ghost {
  opacity: 0.55;
  font-style: italic;
}

/* ── Sample B — Browser tab strip ─────────────────────── */
.sample-surface--tab {
  background: rgb(var(--bg-inset));
  padding: 0.85rem 0.9rem 0.65rem;
}
.tab-mock {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.42rem 0.7rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-bottom: 0;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  /* Slight downward shadow to suggest it's pressed into the
     surface below — like a browser tab. */
  box-shadow: inset 0 -1px 0 rgb(var(--bg-elevated));
}
.tab-fav {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 3px;
  overflow: hidden;
}
.tab-fav-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.tab-fav-icon {
  font-size: 0.78rem;
  color: rgb(var(--bg-base));
}
.tab-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-strong));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tab-close {
  font-size: 11px;
  color: rgb(var(--fg-muted));
  opacity: 0.6;
}
.tab-url {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  margin: 0 0.4rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-top: 0;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  position: relative;
  z-index: 0;
}
.tab-url-icon {
  font-size: 0.7rem;
  color: rgba(108, 209, 97, 0.85);
}
.tab-url-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* ── Sample C — Homepage hero ─────────────────────────── */
.sample-surface--hero {
  padding: 1.1rem 1.05rem 1.2rem;
  background: radial-gradient(
    140% 90% at 50% 0%,
    rgba(212, 167, 52, 0.06) 0%,
    rgba(212, 167, 52, 0) 60%
  ), rgb(var(--bg-elevated));
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  text-align: left;
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  align-self: flex-start;
  padding: 0.22rem 0.55rem;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.35);
  border-radius: 999px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #d4a734;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.hero-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #6cd161;
  box-shadow: 0 0 6px rgba(108, 209, 97, 0.6);
  flex-shrink: 0;
}
.hero-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: rgb(var(--fg-strong));
  word-break: break-word;
}
.hero-title :deep(b),
.hero-title :deep(strong) { font-weight: 800; }
.hero-subtitle {
  margin: 0;
  font-size: 0.7rem;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hero-subtitle--ghost {
  opacity: 0.55;
  font-style: italic;
}
.hero-features {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.4rem;
}
.hero-feature-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(212, 167, 52, 0.4);
  transition: background 0.2s ease;
}
.hero-feature-dot:hover { background: rgba(212, 167, 52, 0.8); }

/* ── Block scaffold ────────────────────────────────────────── */
.block {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.block-head {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.85rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.block-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 40px;
  height: 1px;
  background: #d4a734;
}
.block-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #d4a734;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
}
.block-id h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.block-id p {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
}

.cluster {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
}

/* ── Fields ─────────────────────────────────────────────────── */
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.field-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.field-hint {
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
  margin-top: -0.15rem;
}
.field-hint--example {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.7rem;
  margin-top: 0.2rem;
}
.field-input {
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.55rem 0.75rem;
  color: rgb(var(--fg-strong));
  font-size: 0.88rem;
  font-family: inherit;
  width: 100%;
  min-width: 0;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.field-input:focus {
  outline: none;
  border-color: rgba(212, 167, 52, 0.55);
  box-shadow: 0 0 0 3px rgba(212, 167, 52, 0.12);
}
.field-input--mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
}

/* ── Auxiliary row under siteName ──────────────────────────── */
.field-aux {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem;
}
.aux-swatch {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  cursor: pointer;
  overflow: hidden;
  background: rgb(var(--bg-inset));
}
.aux-swatch-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.aux-swatch-icon {
  color: rgb(var(--fg-muted));
}
.aux-reset {
  background: transparent;
  border: 0;
  color: rgb(var(--fg-muted));
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.16s ease;
}
.aux-reset:hover { color: #d4a734; }

.aux-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.aux-toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.aux-toggle-track {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 22px;
  background: rgb(var(--line-default));
  border-radius: 999px;
  transition: background 0.2s ease;
}
.aux-toggle-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: rgb(var(--bg-elevated));
  border-radius: 50%;
  transition: transform 0.2s ease, background 0.18s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.aux-toggle-input:checked + .aux-toggle-track {
  background: #d4a734;
}
.aux-toggle-input:checked + .aux-toggle-track::after {
  transform: translateX(16px);
  background: rgb(var(--bg-base));
}
.aux-toggle-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ── Logo segments + icon picker ───────────────────────────── */
.segments {
  display: inline-flex;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  padding: 3px;
  gap: 2px;
  align-self: flex-start;
}
.segment {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: transparent;
  border: 0;
  padding: 0.45rem 0.9rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  border-radius: calc(var(--radius-sm) - 1px);
  transition: all 0.16s ease;
}
.segment:hover { color: rgb(var(--fg-strong)); }
.segment--active {
  background: rgb(var(--bg-base));
  color: #d4a734;
  box-shadow: inset 0 0 0 1px rgba(212, 167, 52, 0.4);
}

.icon-row {
  display: flex;
  gap: 0.5rem;
}
.icon-row-preview {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  font-size: 1.2rem;
  color: #d4a734;
  flex-shrink: 0;
}

.quick-icons {
  margin-top: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.quick-icons-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.quick-icons-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.quick-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 1.1rem;
}
.quick-icon:hover {
  color: rgb(var(--fg-strong));
  border-color: rgba(212, 167, 52, 0.4);
}
.quick-icon--active {
  color: #d4a734;
  border-color: #d4a734;
  background: rgba(212, 167, 52, 0.08);
}

/* ── Dropzones ─────────────────────────────────────────────── */
.dropfile {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.7rem;
  align-items: center;
  padding: 0.65rem 0.85rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  margin-bottom: 0.5rem;
}
.dropfile-thumb {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  background: repeating-conic-gradient(#808080 0% 25%, #fff 0% 50%) 50% / 12px 12px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  flex-shrink: 0;
}
.dropfile-thumb--small {
  width: 40px;
  height: 40px;
}
.dropfile-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.dropfile-info {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.dropfile-path {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dropfile-remove {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: transparent;
  border: 0;
  color: rgb(var(--danger));
  padding: 0;
  font-size: 0.78rem;
  cursor: pointer;
  align-self: flex-start;
  transition: opacity 0.15s ease;
}
.dropfile-remove:hover { opacity: 0.85; }

.dropzone {
  position: relative;
  display: grid;
  place-items: center;
  gap: 0.45rem;
  padding: 2rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated) / 0.5);
  cursor: pointer;
  text-align: center;
  color: rgb(var(--fg-muted));
  font-size: 0.82rem;
  transition: border-color 0.16s ease, background 0.16s ease,
    color 0.16s ease;
}
.dropzone:hover {
  border-color: rgba(212, 167, 52, 0.45);
  color: rgb(var(--fg-strong));
}
.dropzone--over {
  border-color: #d4a734;
  background: rgba(212, 167, 52, 0.06);
  color: #d4a734;
}
.dropzone--compact {
  padding: 1.2rem 1rem;
  font-size: 0.78rem;
}
.dropzone > svg {
  font-size: 1.4rem;
  color: inherit;
}
.dropzone-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* ── Features (homepage) ───────────────────────────────────── */
.features {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.features-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.features-list {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.feature {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.95rem;
  padding: 1rem 1.15rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  animation: feature-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes feature-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.feature-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #d4a734;
  background: rgb(var(--bg-base));
  border: 1px solid rgba(212, 167, 52, 0.35);
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius-sm);
  align-self: flex-start;
  width: fit-content;
  height: fit-content;
}
.feature-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}
.feature-sublabel {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ── Floating save bar ─────────────────────────────────────── */
.savebar {
  position: fixed;
  left: 50%;
  bottom: 1.25rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.7rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgba(212, 167, 52, 0.55);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(10px);
  z-index: 50;
  max-width: calc(100% - 2rem);
}
.savebar-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #d4a734;
}
.savebar-enter-active,
.savebar-leave-active {
  transition: transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.22s ease;
}
.savebar-enter-from,
.savebar-leave-to {
  transform: translate(-50%, 120%);
  opacity: 0;
}

/* ── Buttons ─────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.95rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  white-space: nowrap;
}
.btn:hover:not(:disabled) {
  border-color: rgba(212, 167, 52, 0.5);
  background: rgba(212, 167, 52, 0.05);
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn--ghost { background: transparent; }
.btn--primary {
  background: #d4a734;
  border-color: #d4a734;
  color: #1a1a1a;
}
.btn--primary:hover:not(:disabled) {
  background: #e8b94e;
  border-color: #e8b94e;
}

.spin {
  animation: br-spin 1s linear infinite;
}
@keyframes br-spin {
  to { transform: rotate(360deg); }
}
</style>
