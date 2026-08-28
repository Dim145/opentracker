<template>
  <span class="hint">
    <button
      type="button"
      class="hint-key"
      :aria-describedby="open ? id : undefined"
      @mouseenter="open = true"
      @mouseleave="open = false"
      @focus="open = true"
      @blur="open = false"
      @click.prevent="open = !open"
    >
      --{{ def.key }}
      <Icon v-if="def.reserved" name="ph:clock-bold" class="hint-reserved" />
    </button>

    <span v-if="open" :id="id" role="tooltip" class="hint-pop">
      <span class="hint-sample">
        <!-- A colour, on the surface it is meant to sit on. A swatch floating on
             the editor's own background answers the wrong question: what an
             admin needs to know about `--fg-muted` is whether it is legible
             against `--bg-surface`, not what the colour looks like alone. -->
        <template v-if="preview === 'colour'">
          <span class="s-colour" :style="{ background: onPage, color: asRgb }">
            <span class="s-chip" :style="{ background: asRgb }" />
            <span class="s-colour-text">Aa</span>
          </span>
        </template>

        <template v-else-if="preview === 'alpha'">
          <span class="s-alpha">
            <span class="s-alpha-fill" :style="{ opacity: value || '1' }" />
          </span>
        </template>

        <template v-else-if="preview === 'font'">
          <span class="s-font" :style="{ fontFamily: stack }">Aa Gg 0123</span>
        </template>

        <template v-else-if="preview === 'radius'">
          <span class="s-box" :style="{ borderRadius: value || '0' }" />
        </template>

        <template v-else-if="preview === 'shadow'">
          <!-- The same expression `main.css` uses, so the sample and the page
               cannot disagree about what the multiplier means. -->
          <span
            class="s-box s-box--shadow"
            :style="{
              boxShadow: `0 4px 14px rgb(var(--shadow-color) / calc(0.22 * ${num(value, 1)}))`,
            }"
          />
        </template>

        <template v-else-if="preview === 'tracking'">
          <span :style="{ letterSpacing: `calc(0.14em * ${num(value, 1)})` }">
            SPACING
          </span>
        </template>

        <template v-else-if="preview === 'scale'">
          <span :style="{ fontSize: `calc(0.8rem * ${num(value, 1)})` }">Aa Gg</span>
        </template>

        <!-- `motionStyle` rather than an object literal here: a `//` comment
             inside a template binding survives only as long as the newlines
             around it do, and the note it carried is worth keeping. -->
        <template v-else-if="preview === 'motion'">
          <span class="s-track">
            <span class="s-dot" :style="motionStyle" />
          </span>
        </template>

        <template v-else-if="preview === 'bezier'">
          <span class="s-track">
            <span
              class="s-dot"
              :style="{ animationTimingFunction: value || 'linear' }"
            />
          </span>
        </template>

        <template v-else-if="preview === 'pattern'">
          <span class="s-pattern" :style="patternStyle" />
        </template>

        <template v-else>
          <code class="s-raw">{{ value || '—' }}</code>
        </template>
      </span>

      <span class="hint-text">{{ hint }}</span>
      <code class="hint-value">{{ value || $t('admin.themes.inherited', { value: '' }) }}</code>
    </span>
  </span>
</template>

<script setup lang="ts">
/**
 * The hover hint on a token name.
 *
 * Two things, and the second is the one that earns its keep. A sentence saying
 * what the token does — `--bg-inset` and `--fg-subtle` are perfectly clear once
 * you know the system and opaque before that, and the alternative to a sentence
 * is an admin changing one and watching what moves. And a live sample rendered
 * with the value in the DRAFT, so it answers "what am I about to get" rather
 * than "what does the page currently look like".
 *
 * The samples are deliberately not one generic swatch. A colour is shown against
 * the surface it belongs on, because whether `--fg-muted` is legible is the
 * actual question; a multiplier is shown through the same `calc()` the real
 * stylesheet uses, so a preview cannot quietly disagree with the page; and
 * `motion-scale: 0` shows a still dot, because zero is a feature here and a
 * sample that animated anyway would be lying about it.
 */
import {
  FONT_STACKS,
  PATTERN_IMAGES,
  emittedValue,
  type TokenDef,
} from '@trackarr/shared/theme';

const props = defineProps<{
  def: TokenDef;
  /** The value in force for the draft: its override, or the base's. */
  value: string;
  /** The draft's other resolved tokens, for the samples that need context. */
  resolved: Record<string, string>;
}>();

const { t, te } = useI18n();
const open = ref(false);
const id = useId();

const hint = computed(() => {
  const key = `admin.themes.tokenHints.${props.def.key}`;
  // A token added without its sentence should read as missing rather than as
  // the key path, which is what vue-i18n renders by default. The unit suite
  // fails on that case too; this is what an admin sees if it ever ships.
  return te(key) ? t(key) : '';
});

/** Which sample to draw. Keyed on the token, not only on its kind. */
const preview = computed(() => {
  const { key, kind } = props.def;
  if (kind === 'rgb') return 'colour';
  if (kind === 'alpha') return 'alpha';
  if (kind === 'bezier') return 'bezier';
  if (key.startsWith('font-')) return 'font';
  if (key === 'radius' || key === 'radius-pill') return 'radius';
  if (key === 'shadow-strength') return 'shadow';
  if (key === 'tracking-scale') return 'tracking';
  if (key === 'ui-scale') return 'scale';
  if (key === 'motion-scale') return 'motion';
  if (key === 'bg-pattern-kind' || key === 'bg-pattern-step') return 'pattern';
  return 'raw';
});

function num(v: string, fallback: number): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

const asRgb = computed(() => `rgb(${props.value})`);

/**
 * What a colour is shown against.
 *
 * The whole point of the sample, and it has to match what the token is FOR.
 * `--accent-fg` is text drawn on the accent, so showing it on a card answers a
 * question nobody asked and makes the sample contradict its own sentence — which
 * is what it did until this was fixed by looking at it. `fg-*` and `line-*` sit
 * on a card; everything else on the page.
 *
 * Read from the draft rather than from the live document, so the sample shows
 * the theme being edited and not the one being worn.
 */
const ON = new Map([
  ['accent-fg', 'accent'],
  ['accent-warm-fg', 'accent-warm'],
]);
const onPage = computed(() => {
  const against =
    ON.get(props.def.key) ??
    (/^(fg|line)-/.test(props.def.key) ? 'bg-surface' : 'bg-base');
  return `rgb(${props.resolved[against] ?? '0 0 0'})`;
});

const easing = computed(() => props.resolved['ease-standard'] || 'ease');

/**
 * The moving dot, for `motion-scale`.
 *
 * A zero-length animation never paints a frame, which is exactly right:
 * `motion-scale: 0` means nothing moves, and a sample that animated anyway
 * would be lying about the one value that matters most here.
 */
const motionStyle = computed(() => ({
  animationDuration: `calc(900ms * ${num(props.value, 1)})`,
  animationPlayState: num(props.value, 1) === 0 ? 'paused' : 'running',
  animationTimingFunction: easing.value,
}));

const stack = computed(() => {
  const v = props.value;
  if (!v) return 'inherit';
  // `emittedValue` is what the stylesheet will contain, uploads included, so
  // the sample uses the same face the page will.
  return emittedValue(props.def.key, v) || FONT_STACKS[v] || 'inherit';
});

const patternStyle = computed(() => {
  const kind =
    props.def.key === 'bg-pattern-kind' ? props.value : props.resolved['bg-pattern-kind'];
  const step =
    props.def.key === 'bg-pattern-step' ? props.value : props.resolved['bg-pattern-step'];
  const rgb = props.resolved['bg-pattern-rgb'] ?? '255 255 255';
  const alpha = props.resolved['bg-pattern-alpha'] ?? '0.1';
  return {
    background: `rgb(${props.resolved['bg-base'] ?? '0 0 0'})`,
    // The literal comes from the shared table for the same reason the emitter
    // takes it from there: a free-form image would be a `url()`.
    backgroundImage: PATTERN_IMAGES[kind ?? 'none'] ?? 'none',
    backgroundSize: `${step || '24px'} ${step || '24px'}`,
    // The pattern's own colour and opacity ride in these two custom properties,
    // exactly as the real stylesheet declares them.
    '--bg-pattern-rgb': rgb,
    '--bg-pattern-alpha': alpha,
  } as Record<string, string>;
});
</script>

<style scoped>
.hint {
  position: relative;
  display: inline-flex;
}
.hint-key {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-muted));
  text-align: left;
  cursor: help;
  border-bottom: 1px dotted rgb(var(--line-strong));
  transition: color calc(120ms * var(--motion-scale)) var(--ease-standard);
}
.hint-key:hover,
.hint-key:focus-visible {
  color: rgb(var(--fg-default));
}
.hint-reserved {
  opacity: 0.5;
}

.hint-pop {
  position: absolute;
  z-index: 40;
  bottom: calc(100% + 0.4rem);
  left: 0;
  display: grid;
  gap: 0.4rem;
  width: max-content;
  max-width: 20rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  box-shadow: 0 8px 28px rgb(var(--shadow-color) / calc(0.32 * var(--shadow-strength)));
  /* The hint follows the cursor to the token beneath it otherwise. */
  pointer-events: none;
}
.hint-text {
  font-size: 0.6875rem;
  line-height: 1.45;
  color: rgb(var(--fg-default));
}
.hint-value {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  color: rgb(var(--fg-faint));
}
.hint-sample {
  display: flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  font-size: 0.75rem;
  color: rgb(var(--fg-default));
  overflow: hidden;
}

.s-colour {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.45rem;
  border-radius: var(--radius-sm);
}
.s-chip {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
}
.s-colour-text {
  font-weight: 700;
}

.s-alpha {
  position: relative;
  width: 3rem;
  height: 1.5rem;
  border-radius: var(--radius-sm);
  /* A chequerboard, so an alpha of 0 is visibly transparent rather than
     visibly the same as the panel behind it. */
  background-image:
    linear-gradient(45deg, rgb(var(--fg-faint) / 0.3) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(var(--fg-faint) / 0.3) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(var(--fg-faint) / 0.3) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(var(--fg-faint) / 0.3) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  overflow: hidden;
}
.s-alpha-fill {
  position: absolute;
  inset: 0;
  background: rgb(var(--accent));
}

.s-font {
  font-size: 1rem;
}
.s-box {
  width: 3rem;
  height: 1.75rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
}
.s-box--shadow {
  margin: 0.25rem 0.5rem;
  border-radius: var(--radius-md);
}
.s-track {
  position: relative;
  width: 100%;
  height: 1rem;
}
.s-dot {
  position: absolute;
  top: 0.25rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: rgb(var(--accent));
  animation-name: hint-slide;
  animation-duration: 900ms;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}
@keyframes hint-slide {
  from { left: 0; }
  to { left: calc(100% - 0.5rem); }
}
.s-pattern {
  width: 100%;
  height: 2.25rem;
  border-radius: var(--radius-sm);
}
.s-raw {
  font-family: var(--font-mono);
  font-size: 0.625rem;
}

@media (prefers-reduced-motion: reduce) {
  .s-dot {
    animation: none;
  }
}
</style>
