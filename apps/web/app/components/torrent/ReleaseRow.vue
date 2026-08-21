<template>
  <!--
    One release inside a group.

    Deliberately NOT the listing row. By the time you are inside a group you
    already know the work, so the name is noise — sixty characters repeated on
    every line, differing in five of them. What you are choosing between is the
    technical description, so that is what the row IS: fixed slots, fixed
    colours, the same fact in the same place on every line.

    The whole row links through to the torrent page; the button at the end
    downloads the .torrent directly. That pairing is the point of the grouped
    view — everything needed to decide is on screen, so the common case never
    leaves the search page.
  -->
  <div class="rr" :class="`rr--${tier}`">
    <!-- A federated release goes home: the `.torrent` is fetched from the
         origin, with an account there. We never proxy a partner's bytes with
         the local passkey, so there is no download button on those rows — the
         partner chips say where to go instead. -->
    <component
      :is="release.remote ? 'a' : 'NuxtLink'"
      v-bind="
        release.remote
          ? { href: release.remote.detailUrl ?? undefined, target: '_blank', rel: 'noopener noreferrer' }
          : { to: `/torrents/${release.infoHash}` }
      "
      class="rr-main"
    >
      <span v-if="hasChips" class="rr-chips">
        <span v-if="chips.language" class="chip chip--lang">{{ chips.language }}</span>
        <span v-if="chips.resolution" class="chip chip--res">{{ chips.resolution }}</span>
        <span v-if="chips.source" class="chip chip--src">{{ chips.source }}</span>
        <span v-if="chips.hdr" class="chip chip--hdr">{{ chips.hdr }}</span>
        <span v-if="chips.audio" class="chip chip--audio">{{ chips.audio }}</span>
        <span v-if="chips.codec" class="chip chip--codec">{{ chips.codec }}</span>
        <span v-if="chips.platform" class="chip chip--plat">{{ chips.platform }}</span>
        <span v-if="chips.format" class="chip chip--fmt">{{ chips.format }}</span>
        <span v-for="flag in chips.flags" :key="flag" class="chip chip--flag">{{ flag }}</span>
        <span v-if="team" class="rr-team">{{ team }}</span>
        <span
          v-for="peer in release.remote?.peers ?? []"
          :key="peer"
          class="chip chip--peer"
          >{{ peer }}</span
        >
      </span>

      <!-- Nothing parsed: fall back to the name rather than an empty row. The
           leading words dim, the technical tail bright — the same cut, just
           applied to raw text when there is nothing better. -->
      <span v-else class="rr-name" :title="release.name">
        <span class="rr-name-lead">{{ split.tag }}{{ split.lead }}</span
        ><span class="rr-name-tail">{{ split.tail }}</span>
      </span>
    </component>

    <span class="rr-size">{{ formatSize(release.size) }}</span>
    <span class="rr-seed" :class="{ 'rr-seed--dead': release.seeders === 0 }">
      <Icon name="ph:arrow-up-bold" />{{ release.seeders }}
    </span>
    <span class="rr-leech"> <Icon name="ph:arrow-down-bold" />{{ release.leechers }} </span>
    <span class="rr-age">{{ age }}</span>

    <a
      v-if="!release.remote"
      :href="`/api/torrents/${release.infoHash}/download`"
      class="rr-dl"
      :title="$t('search.group.download')"
      :aria-label="$t('search.group.download')"
      @click.stop
    >
      <Icon name="ph:download-simple-bold" />
    </a>
    <span v-else class="rr-dl rr-dl--remote" :title="$t('search.group.atOrigin')">
      <Icon name="ph:arrow-square-out-bold" />
    </span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  release: {
    id: string;
    infoHash: string;
    name: string;
    size: number;
    seeders: number;
    leechers: number;
    createdAt?: string | Date | null;
    moderatedAt?: string | Date | null;
    /**
     * Set when the release comes from the federated mirror rather than the
     * local catalogue. Its presence is what switches the row from "download
     * this" to "go and get it there", so it is one field rather than three
     * booleans nobody would keep in step.
     */
    remote?: { detailUrl: string | null; peers: string[] } | null;
  };
}>();

const chips = computed(() => releaseChips(props.release.name));
const tier = computed(() => resolutionTier(chips.value.resolution));

const hasChips = computed(
  () =>
    Boolean(
      chips.value.language ||
        chips.value.resolution ||
        chips.value.source ||
        chips.value.audio ||
        chips.value.codec ||
        chips.value.platform ||
        chips.value.format,
    ) || chips.value.flags.length > 0,
);

const split = computed(() => splitReleaseName(props.release.name));

/**
 * The release group — the `-NTb` at the end of the name. Two encodes with
 * identical chips are told apart by exactly this, so it earns its place even
 * though it is the one token the chip vocabulary cannot classify.
 */
const TEAM = /-([A-Za-z0-9][A-Za-z0-9._]{1,19})$/;
const team = computed(() => props.release.name.match(TEAM)?.[1] ?? null);

const age = computed(() =>
  formatAge(props.release.moderatedAt ?? props.release.createdAt ?? null),
);
</script>

<style scoped>
.rr {
  display: grid;
  grid-template-columns: 1fr auto auto auto auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.35rem 0.6rem 0.35rem 0;
  /* The rule is the row's one piece of pre-attentive information: scanning a
     season for "is there a 4K in here" is scanning a column of colour, not
     reading twenty filenames. */
  border-left: 2px solid var(--tier);
  transition: background-color 120ms ease;
}
.rr:hover {
  background: rgb(var(--bg-hover));
}

.rr--uhd {
  --tier: #d4a734;
}
.rr--hd {
  --tier: rgb(var(--info, 96 165 250));
}
.rr--sd {
  --tier: rgb(var(--line-strong));
}
.rr--low,
.rr--none {
  --tier: rgb(var(--line-default));
}

.rr-main {
  display: block;
  min-width: 0;
  padding-left: 0.75rem;
}

.rr-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  line-height: 1;
}

.chip {
  padding: 3px 5px;
  border-radius: 2px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
/* One hue per slot, held across every row. The colours are not decoration:
   they are how a slot is found without reading it. */
.chip--lang {
  background: rgb(52 211 153 / 0.14);
  color: rgb(110 231 183);
}
.chip--res {
  background: rgb(212 167 52 / 0.16);
  color: #e5bf58;
  font-weight: 600;
}
.chip--src {
  background: rgb(34 211 238 / 0.12);
  color: rgb(103 232 249);
}
.chip--hdr {
  background: rgb(167 139 250 / 0.14);
  color: rgb(196 181 253);
}
.chip--audio {
  background: rgb(251 191 36 / 0.12);
  color: rgb(252 211 77);
}
.chip--codec {
  background: rgb(var(--fg-default) / 0.07);
  color: rgb(var(--fg-muted));
}
.chip--plat {
  background: rgb(244 114 182 / 0.14);
  color: rgb(249 168 212);
}
.chip--fmt {
  background: rgb(129 140 248 / 0.14);
  color: rgb(165 180 252);
}
/* Which partner carries it. Neutral-bright: it is an origin, not a quality —
   but it is the one thing a member needs before clicking away from here. */
.chip--peer {
  background: rgb(56 189 248 / 0.12);
  color: rgb(125 211 252);
}
/* Flags are qualifiers, not identity — outlined so they read as an aside. */
.chip--flag {
  border: 1px solid rgb(var(--line-strong));
  color: rgb(var(--fg-faint));
}

.rr-team {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: rgb(var(--fg-faint));
  letter-spacing: 0.04em;
}
.rr-team::before {
  content: '·';
  margin-right: 0.35rem;
  opacity: 0.5;
}

.rr-name {
  display: block;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rr-name-lead {
  color: rgb(var(--fg-faint));
}
.rr-name-tail {
  color: rgb(var(--fg-default));
}

.rr-size {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: rgb(var(--fg-default));
  white-space: nowrap;
  text-align: right;
  min-width: 4rem;
}

.rr-seed,
.rr-leech {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  min-width: 2.4rem;
  justify-content: flex-end;
}
.rr-seed {
  color: rgb(var(--online));
}
/* A release nobody is seeding is the one fact worth flagging in a group:
   it looks available and is not. */
.rr-seed--dead {
  color: rgb(var(--danger));
}
.rr-leech {
  color: rgb(var(--fg-faint));
}

.rr-age {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.625rem;
  color: rgb(var(--fg-faint));
  white-space: nowrap;
  min-width: 3.5rem;
  text-align: right;
}

.rr-dl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: var(--radius-sm, 4px);
  color: rgb(var(--fg-muted));
  transition: background-color 120ms ease, color 120ms ease;
}
.rr-dl:hover {
  background: rgb(212 167 52 / 0.14);
  color: #e5bf58;
}
/* Not a button — a signpost. Dimmer, and it does not light up on hover,
   because the whole row is already the link that takes you there. */
.rr-dl--remote {
  color: rgb(var(--fg-faint));
}

/* On a phone the chips are the row and the numbers drop underneath, rather
   than the chips being squeezed into an ellipsis — a truncated chip row is a
   row that has stopped answering the only question it exists to answer. */
@media (max-width: 720px) {
  .rr {
    grid-template-columns: 1fr auto auto auto;
    grid-template-areas:
      'main main main dl'
      'size seed leech age';
    row-gap: 0.35rem;
    padding: 0.5rem 0.6rem 0.5rem 0;
  }
  .rr-main {
    grid-area: main;
  }
  .rr-size {
    grid-area: size;
    text-align: left;
    padding-left: 0.75rem;
  }
  .rr-seed {
    grid-area: seed;
  }
  .rr-leech {
    grid-area: leech;
  }
  .rr-age {
    grid-area: age;
  }
  .rr-dl {
    grid-area: dl;
  }
}
</style>
