<template>
  <figure
    ref="anchor"
    v-bind="$attrs"
    class="ph"
    @mouseenter="schedule"
    @mouseleave="dismiss"
    @focusin="schedule"
    @focusout="dismiss"
  >
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      loading="lazy"
      decoding="async"
      class="ph-img"
    />
    <span v-else-if="loading" class="ph-skeleton" />
    <Icon v-else :name="fallbackIcon" class="ph-fallback" />
  </figure>

  <!--
    Teleported to the body because every ancestor that makes the row look like
    a row — the card's `overflow: hidden`, the list's stacking context — would
    clip a popover that is deliberately taller than its anchor.

    Mounted once and shown with a class, not created and destroyed with `v-if`
    and a `<Transition>`. The pair misbehaves through a `<Teleport>`: the
    enter classes are applied before the node is moved and the `enter-from`
    that pins it to `opacity: 0` is then never cleaned up, so the popover
    opened, faded in, and stayed in the DOM invisible and un-closable. A class
    toggle has no lifecycle to lose track of — and re-hovering a row costs
    nothing rather than a remount.

    `armed` is what keeps that cheap: nothing is rendered, and therefore no
    full-size image is fetched, until the row is hovered for the first time.
  -->
  <Teleport to="body">
    <div
      v-if="armed && large"
      class="ph-pop"
      :class="{ 'ph-pop--on': shown }"
      :style="popStyle"
      aria-hidden="true"
    >
      <img :src="large" :alt="alt" decoding="async" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * A thumbnail that shows the full poster on hover.
 *
 * The listing gives a poster forty pixels wide — enough to recognise something
 * already known, not enough to tell two seasons of the same show apart or to
 * read a title off the artwork. Hovering is the cheapest possible way to ask
 * for the real image: no click, no navigation, nothing to close.
 *
 * Deliberately hover-only. It carries no information the row does not already
 * state in text, so it is decoration for the eye rather than a control, and it
 * is hidden from assistive technology and never shown to a touch pointer —
 * where "hover" means "the first tap", and a card appearing under the finger
 * that was about to expand a group is a trap, not a preview.
 */
// Two roots — the thumbnail and the teleported popover — so Vue cannot guess
// where a parent's `class` should land, and drops it. The thumbnail is the
// one that occupies a slot in the parent's layout.
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Thumbnail source, as the row shows it. */
    src?: string | null;
    /** Full-size source for the popover. No popover without it. */
    large?: string | null;
    alt: string;
    loading?: boolean;
    fallbackIcon?: string;
  }>(),
  { src: null, large: null, loading: false, fallbackIcon: 'ph:package-bold' },
);

const anchor = ref<HTMLElement | null>(null);
/** Rendered at all — set on the first hover and never unset. */
const armed = ref(false);
/** Visible. Drives the class, not the existence of the node. */
const shown = ref(false);
const popStyle = ref<Record<string, string>>({});
let timer: ReturnType<typeof setTimeout> | null = null;
/** True between the decision to show and the pointer leaving. */
let pending = false;

/** Long enough that running the cursor down a list shows nothing. */
const DELAY_MS = 180;

/** Poster geometry and the gap kept from the anchor and the viewport edges. */
const CARD_W = 260;
const RATIO = 3 / 2;
const GAP = 14;
const MARGIN = 12;

function canHover(): boolean {
  return (
    import.meta.client &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

function schedule() {
  if (!canHover() || !props.large) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(place, DELAY_MS);
}

/**
 * Mount before showing, one frame apart, so the transition has a base state to
 * run from. Shown in the same tick as the mount, the browser would see only
 * the final values and the popover would snap in.
 */
async function reveal() {
  if (!armed.value) {
    armed.value = true;
    await nextTick();
    // A pointer that left during that frame must not be overruled.
    if (!pending) return;
  }
  shown.value = true;
}

function dismiss() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = false;
  shown.value = false;
}

/**
 * Measure, then hand the arithmetic to `placeBeside` — which flips sides and
 * clamps to the viewport, and is unit-tested there because a panel rendering
 * half off the bottom of the screen is only ever noticed by whoever happens to
 * hover the last row.
 */
function place() {
  const el = anchor.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const { left, top, width, height } = placeBeside(
    r,
    { width: window.innerWidth, height: window.innerHeight },
    { cardWidth: CARD_W, ratio: RATIO, gap: GAP, margin: MARGIN },
  );
  popStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
  pending = true;
  void reveal();
}

// A popover pinned to a viewport position is wrong the moment the page moves
// under it, and re-placing it while scrolling would have it chase the cursor.
// Dismissing is both cheaper and what a member expects.
onMounted(() => {
  window.addEventListener('scroll', dismiss, { passive: true, capture: true });
  window.addEventListener('resize', dismiss, { passive: true });
});
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  window.removeEventListener('scroll', dismiss, { capture: true });
  window.removeEventListener('resize', dismiss);
});
</script>

<style scoped>
.ph {
  margin: 0;
  width: 40px;
  height: 60px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  overflow: hidden;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  display: flex;
  align-items: center;
  justify-content: center;
}
.ph-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ph-fallback {
  width: 1.1rem;
  height: 1.1rem;
  color: rgb(var(--fg-faint));
}
.ph-skeleton {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    100deg,
    rgb(var(--bg-elevated)) 30%,
    rgb(var(--bg-hover)) 50%,
    rgb(var(--bg-elevated)) 70%
  );
  background-size: 300% 100%;
  animation: ph-shimmer calc(1.4s * var(--motion-scale)) ease-in-out infinite;
}
@keyframes ph-shimmer {
  to {
    background-position: -150% 0;
  }
}
</style>

<style>
/* Unscoped: the popover lives on the body, outside this component's tree. */
.ph-pop {
  position: fixed;
  z-index: 200;
  pointer-events: none;
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.12);
  /* Deep enough to read as lifted off a dark page — a poster is nearly all
     mid-tone, so a subtle shadow would simply disappear into it. */
  box-shadow:
    0 24px 60px rgb(0 0 0 / 0.6),
    0 4px 12px rgb(0 0 0 / 0.4);
  background: #0b0b0d;
  /* Resting state: mounted, invisible, out of the way. */
  opacity: 0;
  /* Grows out of the thumbnail rather than fading in place. */
  transform: scale(0.94);
  transition: opacity calc(130ms * var(--motion-scale)) ease, transform calc(130ms * var(--motion-scale)) cubic-bezier(0.2, 0.8, 0.3, 1);
}
.ph-pop--on {
  opacity: 1;
  transform: none;
}
.ph-pop img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

@media (prefers-reduced-motion: reduce) {
  .ph-pop {
    transition: opacity calc(80ms * var(--motion-scale)) linear;
    transform: none;
  }
}
</style>
