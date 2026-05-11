<template>
  <!--
    /shop — Cabinet of curiosities.

    Different conceptual register from the rest of Trackarr's
    admin consoles: here we're showing wares to a user, not
    levers to an operator. The visual reaches for editorial /
    antique-boutique cues — italic serif display, gold ornament
    corners, "Spécimen N°XX" mono headers, "ÉDITION LIMITÉE"
    ribbons on low-stock pieces — instead of the numbered
    dashboard blocks the admin pages use.

    The gold thread (#d4a734) stays — it's the currency the user
    earned and is now spending — but it's deployed more
    expressively: hairline frames with corner brackets, item-name
    serif italics, an animated coin counter on the balance card,
    a "stamp" press feedback on the acquire button.
  -->
  <div class="shop">
    <!-- Atmospheric backdrop — a soft warm vignette so the page
         doesn't feel like just another admin screen. Pure CSS,
         no images, no extra DOM bloat. -->
    <div class="shop-bg" aria-hidden="true">
      <div class="shop-bg-grain" />
      <div class="shop-bg-glow shop-bg-glow--top" />
      <div class="shop-bg-glow shop-bg-glow--bottom" />
    </div>

    <NuxtLink to="/me" class="back-link">
      <Icon name="ph:arrow-left-bold" />
      <span>{{ $t('shop.backToProfile') }}</span>
    </NuxtLink>

    <!-- ── Hero — page title + balance card ───────────────── -->
    <header class="hero">
      <div class="hero-pitch">
        <span class="hero-eyebrow">
          <span class="hero-eyebrow-rule" aria-hidden="true" />
          {{ $t('shop.eyebrow') }}
        </span>
        <h1 class="hero-title">
          <span class="hero-title-main">{{ $t('shop.titleMain') }}</span>
          <span class="hero-title-accent">{{ $t('shop.titleAccent') }}</span>
        </h1>
        <p class="hero-blurb">{{ $t('shop.blurb') }}</p>
      </div>

      <!-- Balance card — animated coin counter, ornate frame with
           corner brackets. Acts as the focal anchor on the right. -->
      <aside class="balance">
        <span class="balance-corner balance-corner--tl" aria-hidden="true" />
        <span class="balance-corner balance-corner--tr" aria-hidden="true" />
        <span class="balance-corner balance-corner--bl" aria-hidden="true" />
        <span class="balance-corner balance-corner--br" aria-hidden="true" />

        <span class="balance-eyebrow">{{ $t('shop.balance') }}</span>
        <div class="balance-figure">
          <Icon name="ph:coin-fill" class="balance-coin" />
          <span class="balance-num tabular-nums" aria-live="polite">
            {{ animatedBalance }}
          </span>
        </div>
        <span class="balance-unit">{{ $t('shop.points') }}</span>
      </aside>
    </header>

    <!-- ── Loading ────────────────────────────────────────── -->
    <div v-if="pending" class="shop-loading">
      <Icon name="ph:circle-notch" class="animate-spin" />
    </div>

    <!-- ── Empty cabinet ─────────────────────────────────── -->
    <div v-else-if="items.length === 0" class="empty">
      <span class="empty-corner empty-corner--tl" aria-hidden="true" />
      <span class="empty-corner empty-corner--tr" aria-hidden="true" />
      <span class="empty-corner empty-corner--bl" aria-hidden="true" />
      <span class="empty-corner empty-corner--br" aria-hidden="true" />
      <Icon name="ph:treasure-chest-bold" class="empty-icon" />
      <h2 class="empty-headline">{{ $t('shop.empty.headline') }}</h2>
      <p class="empty-help">{{ $t('shop.empty.help') }}</p>
    </div>

    <!-- ── Item grid ─────────────────────────────────────── -->
    <ul v-else class="grid">
      <li
        v-for="(item, i) in items"
        :key="item.id"
        class="piece"
        :class="{
          'piece--locked': item.cost > bonusPoints,
          'piece--rare': item.stock !== null && item.stock <= 3,
          'piece--sold-out': item.stock !== null && item.stock <= 0,
        }"
        :style="{ '--stagger': `${i * 80}ms` }"
      >
        <!-- Hairline frame corners — pure CSS ornaments that
             grow on hover into a soft gold glow. -->
        <span class="piece-corner piece-corner--tl" aria-hidden="true" />
        <span class="piece-corner piece-corner--tr" aria-hidden="true" />
        <span class="piece-corner piece-corner--bl" aria-hidden="true" />
        <span class="piece-corner piece-corner--br" aria-hidden="true" />

        <!-- Specimen header — mono catalogue number + stock band -->
        <header class="piece-head">
          <span class="piece-num">
            {{ $t('shop.specimen') }}
            <span class="piece-num-val tabular-nums">
              N°{{ String(i + 1).padStart(2, '0') }}
            </span>
          </span>
          <span
            v-if="item.stock !== null"
            class="piece-edition"
            :class="{ 'piece-edition--rare': item.stock <= 3 }"
          >
            <Icon name="ph:diamond-fill" />
            <template v-if="item.stock <= 0">
              {{ $t('shop.soldOut') }}
            </template>
            <template v-else>
              {{ $t('shop.editionOf', item.stock, { n: item.stock }) }}
            </template>
          </span>
        </header>

        <!-- Glyph — large coin / icon, centred -->
        <div class="piece-glyph">
          <span class="piece-glyph-halo" aria-hidden="true" />
          <Icon
            :name="item.icon || defaultIconFor(item.effect.type)"
            class="piece-glyph-icon"
          />
        </div>

        <!-- Name + description in serif italic -->
        <h3 class="piece-name">{{ item.name }}</h3>
        <p v-if="item.description" class="piece-desc">{{ item.description }}</p>

        <!-- Effect — formal grant language with a small ornament -->
        <p class="piece-effect">
          <span class="piece-effect-rule" aria-hidden="true" />
          <Icon name="ph:sparkle-bold" class="piece-effect-icon" />
          <span>{{ describeEffect(item.effect) }}</span>
          <span class="piece-effect-rule" aria-hidden="true" />
        </p>

        <!-- Foot — cost + acquire CTA -->
        <footer class="piece-foot">
          <div class="piece-cost">
            <span class="piece-cost-num tabular-nums">
              {{ formatNumber(item.cost) }}
            </span>
            <span class="piece-cost-unit">{{ $t('shop.points') }}</span>
          </div>
          <button
            type="button"
            class="acquire"
            :class="{
              'acquire--locked': item.cost > bonusPoints,
              'acquire--sold': item.stock !== null && item.stock <= 0,
            }"
            :disabled="
              pendingItemId !== null ||
              item.cost > bonusPoints ||
              (item.stock !== null && item.stock <= 0)
            "
            @click="confirmAndBuy(item)"
          >
            <Icon
              :name="buttonIcon(item)"
              :class="pendingItemId === item.id ? 'spin' : ''"
            />
            <span>{{ buttonLabel(item) }}</span>
          </button>
        </footer>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();
const confirm = useConfirm();
const { fetch: refreshSession } = useUserSession();

useHead({ title: () => t('shop.headTitle') });

interface ShopItemEffect {
  type: 'upload_credit' | 'invite';
  args: Record<string, number>;
}
interface ShopItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  cost: number;
  stock: number | null;
  effect: ShopItemEffect;
}
interface ShopResponse {
  bonusPoints: number;
  items: ShopItem[];
}

const { data, pending, refresh } = await useFetch<ShopResponse>(
  '/api/shop/items',
);
const items = computed(() => data.value?.items ?? []);
const bonusPoints = ref(data.value?.bonusPoints ?? 0);

watch(
  () => data.value?.bonusPoints,
  (v) => {
    if (typeof v === 'number') {
      bonusPoints.value = v;
      runCounter(v);
    }
  },
);

const pendingItemId = ref<string | null>(null);

// ── Animated coin counter ─────────────────────────────────────
// Mirrors the /me bonus-tile animation: cubic ease-out from 0 to
// the live value over ~700 ms. Cancels and re-runs whenever the
// balance changes (e.g. after a purchase) so the counter ticks
// down visibly when points are spent.
const animatedBalance = ref('0');
let counterRaf: number | null = null;

function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.round(n)),
  );
}

function runCounter(target: number) {
  if (typeof window === 'undefined') {
    animatedBalance.value = formatNumber(target);
    return;
  }
  if (counterRaf !== null) cancelAnimationFrame(counterRaf);
  const startValue = parseInt(animatedBalance.value.replace(/\D/g, ''), 10) || 0;
  const delta = target - startValue;
  const duration = Math.min(900, Math.max(380, 300 + Math.abs(delta) / 6));
  const start = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const tick = (now: number) => {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);
    animatedBalance.value = formatNumber(startValue + delta * ease(t));
    if (t < 1) {
      counterRaf = requestAnimationFrame(tick);
    } else {
      counterRaf = null;
    }
  };
  counterRaf = requestAnimationFrame(tick);
}

onMounted(() => {
  runCounter(bonusPoints.value);
});
onBeforeUnmount(() => {
  if (counterRaf !== null) cancelAnimationFrame(counterRaf);
});

// ── Item helpers ──────────────────────────────────────────────
function defaultIconFor(type: ShopItemEffect['type']): string {
  return type === 'invite'
    ? 'ph:envelope-simple-bold'
    : 'ph:cloud-arrow-up-bold';
}

function describeEffect(effect: ShopItemEffect): string {
  if (effect.type === 'upload_credit') {
    const bytes = Number(effect.args.bytes ?? 0);
    return t('shop.effects.uploadCredit', { size: formatSize(bytes) });
  }
  if (effect.type === 'invite') {
    const count = Number(effect.args.count ?? 1);
    return t('shop.effects.invite', count, { n: count });
  }
  return '';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1).replace(/\.0$/, '')} ${units[i]}`;
}

function buttonIcon(item: ShopItem): string {
  if (pendingItemId.value === item.id) return 'ph:circle-notch';
  if (item.stock !== null && item.stock <= 0) return 'ph:prohibit-bold';
  if (item.cost > bonusPoints.value) return 'ph:lock-key-bold';
  return 'ph:hand-coins-bold';
}

function buttonLabel(item: ShopItem): string {
  if (pendingItemId.value === item.id) return t('shop.buying');
  if (item.stock !== null && item.stock <= 0) return t('shop.soldOut');
  if (item.cost > bonusPoints.value) return t('shop.notEnough');
  return t('shop.acquire');
}

// ── Purchase flow ─────────────────────────────────────────────
async function confirmAndBuy(item: ShopItem) {
  if (pendingItemId.value !== null) return;
  if (item.cost > bonusPoints.value) return;
  if (item.stock !== null && item.stock <= 0) return;

  const ok = await confirm({
    title: t('shop.confirm.title'),
    message: t('shop.confirm.message', {
      name: item.name,
      cost: formatNumber(item.cost),
    }),
    confirmText: t('shop.confirm.action'),
    cancelText: t('common.cancel'),
  });
  if (!ok) return;

  pendingItemId.value = item.id;
  try {
    const res = await $fetch<{
      success: boolean;
      bonusPoints: number;
      effect: ShopItemEffect;
    }>('/api/shop/buy', {
      method: 'POST',
      body: { itemId: item.id },
    });
    bonusPoints.value = res.bonusPoints;
    runCounter(res.bonusPoints);
    notifications.success(t('shop.toasts.bought', { name: item.name }));
    await refreshSession();
    await refresh();
  } catch (err: any) {
    notifications.error(err?.data?.message || t('shop.errors.buyFailed'));
  } finally {
    pendingItemId.value = null;
  }
}
</script>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────── */
.shop {
  position: relative;
  max-width: 1180px;
  margin: 0 auto;
  padding: 2.5rem 1.25rem 4rem;
  /* Editorial serif inherited by item names; everything else
     stays on the system sans stack. The fallback chain hits a
     pleasant serif on every OS without forcing a webfont. */
  --font-serif: 'Iowan Old Style', 'Palatino Linotype', 'Palatino',
    'Bitstream Vera Serif', 'Liberation Serif', 'P052', Georgia,
    'Times New Roman', serif;
}

/* Atmospheric backdrop — two warm gold haloes plus a faint grain
   overlay. Pure CSS, fixed position so it doesn't scroll. */
.shop-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  overflow: hidden;
}
.shop-bg-glow {
  position: absolute;
  width: 60vw;
  height: 60vw;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.12;
  background: radial-gradient(
    circle at center,
    rgba(212, 167, 52, 0.7) 0%,
    rgba(212, 167, 52, 0) 70%
  );
}
.shop-bg-glow--top {
  top: -30vw;
  right: -20vw;
}
.shop-bg-glow--bottom {
  bottom: -30vw;
  left: -20vw;
  opacity: 0.08;
}
.shop-bg-grain {
  position: absolute;
  inset: 0;
  opacity: 0.4;
  background-image: radial-gradient(
    rgba(255, 255, 255, 0.025) 1px,
    transparent 1px
  );
  background-size: 4px 4px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: color 0.16s ease, transform 0.18s ease;
}
.back-link:hover {
  color: #d4a734;
  transform: translateX(-2px);
}

.shop-loading {
  display: grid;
  place-items: center;
  padding: 6rem 2rem;
  color: rgb(var(--fg-muted));
  font-size: 1.8rem;
}

/* ── Hero ──────────────────────────────────────────────────── */
.hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2.5rem;
  align-items: end;
  margin: 1.75rem 0 3.5rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid rgba(212, 167, 52, 0.18);
  position: relative;
}
.hero::after {
  /* Stronger gold accent at the leftmost portion of the bottom
     rule — anchors the title side. */
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 88px;
  height: 1px;
  background: linear-gradient(
    to right,
    #d4a734 0%,
    rgba(212, 167, 52, 0) 100%
  );
}
@media (max-width: 720px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 1.75rem;
    align-items: stretch;
  }
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #d4a734;
  margin-bottom: 1.1rem;
}
.hero-eyebrow-rule {
  display: inline-block;
  width: 28px;
  height: 1px;
  background: #d4a734;
}

.hero-title {
  margin: 0;
  font-family: var(--font-serif);
  line-height: 0.95;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
}
.hero-title-main {
  display: block;
  font-size: clamp(2.4rem, 6vw, 4rem);
  font-weight: 800;
  font-style: normal;
}
.hero-title-accent {
  display: block;
  font-size: clamp(2.4rem, 6vw, 4rem);
  font-weight: 400;
  font-style: italic;
  color: #d4a734;
  margin-top: 0.05em;
}

.hero-blurb {
  margin: 1.5rem 0 0;
  font-size: 0.95rem;
  line-height: 1.65;
  color: rgb(var(--fg-muted));
  max-width: 48ch;
}

/* Balance card — ornate frame with corner brackets, animated
   coin counter inside. */
.balance {
  position: relative;
  min-width: 220px;
  padding: 1.4rem 1.6rem 1.5rem;
  background: linear-gradient(
    180deg,
    rgba(212, 167, 52, 0.04) 0%,
    rgb(var(--bg-elevated)) 80%
  );
  border: 1px solid rgba(212, 167, 52, 0.25);
}
.balance-corner {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 1px solid #d4a734;
  pointer-events: none;
}
.balance-corner--tl {
  top: -1px;
  left: -1px;
  border-right: 0;
  border-bottom: 0;
}
.balance-corner--tr {
  top: -1px;
  right: -1px;
  border-left: 0;
  border-bottom: 0;
}
.balance-corner--bl {
  bottom: -1px;
  left: -1px;
  border-right: 0;
  border-top: 0;
}
.balance-corner--br {
  bottom: -1px;
  right: -1px;
  border-left: 0;
  border-top: 0;
}

.balance-eyebrow {
  display: block;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-bottom: 0.55rem;
}
.balance-figure {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  line-height: 1;
}
.balance-coin {
  font-size: 1.9rem;
  color: #d4a734;
  /* Soft pulse so the coin feels alive without being annoying. */
  animation: shop-coin-pulse 5s ease-in-out infinite;
}
@keyframes shop-coin-pulse {
  0%, 100% { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 4px rgba(212, 167, 52, 0.3)); }
  50%      { transform: rotate(-8deg) scale(1.05); filter: drop-shadow(0 0 10px rgba(212, 167, 52, 0.55)); }
}
.balance-num {
  font-family: var(--font-serif);
  font-size: 2.2rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.02em;
}
.balance-unit {
  display: block;
  margin-top: 0.45rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}

/* ── Empty cabinet state ───────────────────────────────────── */
.empty {
  position: relative;
  padding: 4rem 2rem;
  text-align: center;
  border: 1px dashed rgba(212, 167, 52, 0.2);
  background: linear-gradient(
    180deg,
    rgba(212, 167, 52, 0.02) 0%,
    rgb(var(--bg-elevated) / 0.4) 100%
  );
}
.empty-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 1px solid rgba(212, 167, 52, 0.4);
}
.empty-corner--tl { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.empty-corner--tr { top: -1px; right: -1px; border-left: 0; border-bottom: 0; }
.empty-corner--bl { bottom: -1px; left: -1px; border-right: 0; border-top: 0; }
.empty-corner--br { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }

.empty-icon {
  font-size: 3rem;
  color: rgba(212, 167, 52, 0.5);
  margin-bottom: 1rem;
}
.empty-headline {
  margin: 0 0 0.6rem;
  font-family: var(--font-serif);
  font-size: 1.4rem;
  font-style: italic;
  font-weight: 500;
  color: rgb(var(--fg-strong));
}
.empty-help {
  margin: 0 auto;
  max-width: 44ch;
  font-size: 0.85rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}

/* ── Item grid ─────────────────────────────────────────────── */
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.4rem;
}
@media (min-width: 720px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (min-width: 1080px) {
  .grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

/* ── Piece (item card) ─────────────────────────────────────── */
.piece {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.4rem 1.5rem 1.4rem;
  background: linear-gradient(
    180deg,
    rgb(var(--bg-elevated)) 0%,
    rgb(var(--bg-elevated) / 0.85) 50%,
    rgb(var(--bg-surface) / 0.6) 100%
  );
  border: 1px solid rgb(var(--line-default));
  transition: transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1),
    border-color 0.22s ease, box-shadow 0.32s ease;
  animation: piece-in 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes piece-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.piece:hover {
  transform: translateY(-3px);
  border-color: rgba(212, 167, 52, 0.45);
  box-shadow: 0 18px 32px -16px rgba(0, 0, 0, 0.7),
    0 0 32px rgba(212, 167, 52, 0.08);
}

/* Corner brackets — expand outward on hover. */
.piece-corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 1px solid rgba(212, 167, 52, 0.45);
  pointer-events: none;
  transition: width 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
    height 0.28s cubic-bezier(0.2, 0.7, 0.2, 1), border-color 0.22s ease;
}
.piece-corner--tl { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.piece-corner--tr { top: -1px; right: -1px; border-left: 0; border-bottom: 0; }
.piece-corner--bl { bottom: -1px; left: -1px; border-right: 0; border-top: 0; }
.piece-corner--br { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
.piece:hover .piece-corner {
  width: 28px;
  height: 28px;
  border-color: #d4a734;
}

.piece--locked { opacity: 0.55; }
.piece--locked:hover { transform: none; box-shadow: none; }
.piece--sold-out {
  opacity: 0.5;
}
.piece--sold-out .piece-name {
  text-decoration: line-through;
  text-decoration-color: rgba(212, 167, 52, 0.4);
}

/* Specimen header — catalogue number + edition badge */
.piece-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.piece-num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}
.piece-num-val {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.piece-edition {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.25rem 0.55rem;
  border: 1px solid rgba(212, 167, 52, 0.35);
  border-radius: 999px;
  color: #d4a734;
  background: rgba(212, 167, 52, 0.05);
}
.piece-edition--rare {
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.5);
  background: rgba(255, 107, 107, 0.08);
  /* Subtle attention pulse on low-stock pieces. */
  animation: piece-rare-pulse 2.4s ease-in-out infinite;
}
@keyframes piece-rare-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 107, 107, 0); }
  50%      { box-shadow: 0 0 0 4px rgba(255, 107, 107, 0.12); }
}
.piece-edition > svg {
  font-size: 0.7rem;
}

/* Glyph — large icon with a halo */
.piece-glyph {
  position: relative;
  width: 72px;
  height: 72px;
  margin: 0.25rem auto 0.35rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(
    circle at center,
    rgba(212, 167, 52, 0.18) 0%,
    rgba(212, 167, 52, 0.04) 60%,
    transparent 100%
  );
}
.piece-glyph-halo {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(212, 167, 52, 0.35);
  opacity: 0;
  transition: opacity 0.22s ease, transform 0.32s ease;
}
.piece:hover .piece-glyph-halo {
  opacity: 1;
  transform: scale(1.12);
}
.piece-glyph-icon {
  font-size: 2.1rem;
  color: #d4a734;
  filter: drop-shadow(0 0 6px rgba(212, 167, 52, 0.35));
}

/* Name + description */
.piece-name {
  margin: 0;
  text-align: center;
  font-family: var(--font-serif);
  font-size: 1.35rem;
  font-weight: 500;
  font-style: italic;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.piece-desc {
  margin: 0;
  text-align: center;
  font-size: 0.78rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
  font-style: italic;
  max-width: 36ch;
  margin-inline: auto;
}

/* Effect — between two ornament rules, like a stamp inside the
   card */
.piece-effect {
  display: grid;
  grid-template-columns: 1fr auto auto auto 1fr;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-strong));
  text-transform: uppercase;
}
.piece-effect-rule {
  height: 1px;
  background: linear-gradient(
    to right,
    rgba(212, 167, 52, 0) 0%,
    rgba(212, 167, 52, 0.45) 50%,
    rgba(212, 167, 52, 0) 100%
  );
}
.piece-effect-icon {
  color: #d4a734;
  font-size: 0.85rem;
}

/* Foot — cost + acquire CTA */
.piece-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  margin-top: auto;
  padding-top: 0.85rem;
  border-top: 1px dashed rgba(212, 167, 52, 0.2);
}
.piece-cost {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  line-height: 1;
}
.piece-cost-num {
  font-family: var(--font-serif);
  font-size: 1.6rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: -0.01em;
}
.piece-cost-unit {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  margin-top: 0.2rem;
}

/* Acquire button — bold gold CTA. Pressed state mimics a wax-seal
   stamp impression. */
.acquire {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1.05rem;
  background: linear-gradient(
    180deg,
    #e8b94e 0%,
    #d4a734 50%,
    #b88a22 100%
  );
  color: #1a1a1a;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: 0;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.22s ease,
    opacity 0.18s ease;
  box-shadow: 0 4px 12px -4px rgba(212, 167, 52, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
.acquire::before {
  /* Subtle highlight sweep on hover — wax catching light. */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 30%,
    rgba(255, 255, 255, 0.18) 50%,
    transparent 70%
  );
  transform: translateX(-100%);
  transition: transform 0.6s cubic-bezier(0.2, 0.7, 0.2, 1);
  pointer-events: none;
}
.acquire:hover:not(:disabled)::before {
  transform: translateX(100%);
}
.acquire:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -4px rgba(212, 167, 52, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.acquire:active:not(:disabled) {
  /* "Stamping" feedback — squashes 2px on press. */
  transform: translateY(1px);
  box-shadow: 0 2px 6px -2px rgba(212, 167, 52, 0.5),
    inset 0 1px 2px rgba(0, 0, 0, 0.15);
}
.acquire:disabled {
  cursor: not-allowed;
}
.acquire--locked,
.acquire--sold {
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-muted));
  border: 1px solid rgb(var(--line-default));
  box-shadow: none;
  opacity: 0.8;
}
.acquire--locked::before,
.acquire--sold::before {
  display: none;
}
.acquire--sold {
  text-decoration: line-through;
}

.spin {
  animation: shop-spin 1s linear infinite;
}
@keyframes shop-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
