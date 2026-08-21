<template>
  <!--
    What a group contains, read without opening it.

    Two shapes, one grammar: a thin baseline with marks standing on it. Lit
    marks are what the group holds, dim marks are what it is missing — so the
    absence is as legible as the presence, which is the whole point. A member
    scanning a season list is not asking "what is here", they are asking
    "what am I missing", and no flat listing has ever answered that.

    This is only honest because the grouping moved server-side. The old
    client-side version folded the rows it happened to have fetched, so a
    ladder built on it would have shown gaps that were merely pagination.
  -->
  <div
    v-if="kind === 'episodes' && lastEpisode > 0"
    class="ladder ladder--episodes"
    role="img"
    :aria-label="episodeLabel"
  >
    <span
      v-for="n in lastEpisode"
      :key="n"
      class="rung"
      :class="{ 'rung--lit': present.has(n) }"
      :style="{ '--i': String(n - 1) }"
    />
    <span class="ladder-caption">{{ present.size }}/{{ lastEpisode }}</span>
  </div>

  <div
    v-else-if="kind === 'resolutions' && tiers.length > 0"
    class="ladder ladder--tiers"
    role="img"
    :aria-label="tierLabel"
  >
    <span
      v-for="(tier, i) in tiers"
      :key="tier.label"
      class="tier"
      :class="{ 'tier--lit': tier.lit }"
      :style="{ '--i': String(i) }"
      >{{ tier.label }}</span
    >
  </div>
</template>

<script setup lang="ts">
/**
 * The rungs animate in on a stagger driven by `--i`. It is the one moment of
 * motion on the row and it earns its place: the eye follows the fill left to
 * right and lands on the gap, which is the information.
 */
const props = defineProps<{
  /** Episode numbers the group actually holds. */
  episodes?: number[];
  /** Resolutions found in the release names ("2160p", "1080p", …). */
  resolutions?: string[];
  /** Null for anything that is not a television season. */
  season?: number | null;
}>();

const kind = computed<'episodes' | 'resolutions'>(() =>
  props.season != null && (props.episodes?.length ?? 0) > 0
    ? 'episodes'
    : 'resolutions',
);

const present = computed(() => new Set(props.episodes ?? []));

/**
 * The ladder runs to the highest episode we hold, not to the season's real
 * length — which we do not know, and would have to ask TMDb for. Overstating
 * it would invent gaps at the end; this way every gap shown is real.
 */
const lastEpisode = computed(() =>
  present.value.size ? Math.max(...present.value) : 0,
);

/** Highest first: on a tracker the top tier is what people look for. */
const TIER_ORDER = ['2160p', '1440p', '1080p', '720p', '480p'] as const;
const TIER_LABEL: Record<string, string> = {
  '2160p': '4K',
  '1440p': '1440',
  '1080p': '1080',
  '720p': '720',
  '480p': '480',
};

/**
 * The rungs a scene release actually lands on. 1440p is not one of them — it
 * shows up occasionally but nobody goes looking for it, so it is drawn only
 * when a release is genuinely at that resolution. Left in unconditionally it
 * would sit dim on nearly every group and read as a gap in the catalogue.
 */
const CANONICAL = new Set(['2160p', '1080p', '720p', '480p']);

/**
 * Only tiers at or below the best one present are drawn. A group whose best is
 * 1080p should not carry a dim "4K" — that reads as "a 4K exists and you are
 * missing it", which is not what an absent tier means here.
 */
const tiers = computed(() => {
  const held = new Set(props.resolutions ?? []);
  const bestIndex = TIER_ORDER.findIndex((t) => held.has(t));
  if (bestIndex === -1) return [];
  return TIER_ORDER.slice(bestIndex)
    .filter((t) => held.has(t) || CANONICAL.has(t))
    .map((t) => ({ label: TIER_LABEL[t]!, lit: held.has(t) }));
});

const { t } = useI18n();
const episodeLabel = computed(() =>
  t('search.group.episodeLadder', {
    have: present.value.size,
    total: lastEpisode.value,
  }),
);
const tierLabel = computed(() =>
  t('search.group.qualityLadder', {
    list: tiers.value.filter((x) => x.lit).map((x) => x.label).join(', '),
  }),
);
</script>

<style scoped>
.ladder {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  /* The baseline the marks stand on. Drawn as a border rather than a
     pseudo-element so it inherits the row's own line colour and stays put
     when the group expands. */
  border-bottom: 1px solid rgb(var(--line-default));
  padding-bottom: 3px;
  min-height: 14px;
}

/* ── Episodes ─────────────────────────────────────────────────────────── */
.ladder--episodes {
  gap: 2px;
}

.rung {
  width: 4px;
  height: 9px;
  border-radius: 1px;
  background: rgb(var(--line-strong));
  /* Staggered reveal, ~14 ms apart. Fast enough that a 24-episode season
     still resolves in a third of a second, slow enough to read as a fill
     rather than a flicker. */
  animation: rung-in 220ms cubic-bezier(0.2, 0.8, 0.3, 1) backwards;
  animation-delay: calc(var(--i) * 14ms);
}

.rung--lit {
  background: #d4a734;
  /* A held episode sits a touch taller as well as brighter: the shape reads
     at a glance even for a member who cannot separate the two tones. */
  height: 13px;
  box-shadow: 0 0 6px rgb(212 167 52 / 0.35);
}

@keyframes rung-in {
  from {
    opacity: 0;
    transform: translateY(3px) scaleY(0.4);
  }
}

/* ── Quality tiers ────────────────────────────────────────────────────── */
.ladder--tiers {
  gap: 5px;
  align-items: center;
  padding-bottom: 2px;
}

.tier {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.5625rem;
  line-height: 1;
  letter-spacing: 0.08em;
  padding: 2px 4px;
  border-radius: 2px;
  color: rgb(var(--fg-faint));
  border: 1px solid rgb(var(--line-default));
  animation: tier-in 220ms ease backwards;
  animation-delay: calc(var(--i) * 40ms);
}

.tier--lit {
  color: #d4a734;
  border-color: rgb(212 167 52 / 0.45);
  background: rgb(212 167 52 / 0.08);
}

@keyframes tier-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
}

.ladder-caption {
  margin-left: 6px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.5625rem;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-faint));
  align-self: center;
}

/* Motion is decoration here — the lit/dim distinction carries the meaning on
   its own, so it can be dropped wholesale. */
@media (prefers-reduced-motion: reduce) {
  .rung,
  .tier {
    animation: none;
  }
}
</style>
