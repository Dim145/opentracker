<template>
  <!--
    /requests/new — file a new bounty.

    The form reads as a single dossier sheet stamped onto the
    board: category picker (chip grid, hover reveals the slug),
    title + description fields, optional reward stake with a live
    "balance after" hint so the requester sees what they're
    committing.
  -->
  <div class="filing">
    <div class="filing-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-grain" />
    </div>

    <NuxtLink to="/requests" class="filing-back">
      <Icon name="ph:arrow-left-bold" />
      <span>{{ $t('requests.actions.backToBoard') }}</span>
    </NuxtLink>

    <header class="filing-head">
      <p class="filing-eyebrow">
        <span class="filing-eyebrow-mark" aria-hidden="true">§</span>
        <span>{{ $t('requests.new.eyebrow') }}</span>
      </p>
      <h1 class="filing-title">{{ $t('requests.new.title') }}</h1>
      <p class="filing-intro">{{ $t('requests.new.intro') }}</p>
    </header>

    <form class="filing-form" @submit.prevent="submit">
      <!-- Category picker — chip grid of top-level categories. -->
      <section class="filing-section">
        <header class="filing-section-head">
          <span class="filing-section-num">01</span>
          <h2 class="filing-section-title">
            {{ $t('requests.new.fields.category') }}
          </h2>
        </header>
        <div v-if="categoriesPending" class="filing-cat-loader">
          <Icon name="ph:circle-notch" class="loader-spin" />
        </div>
        <div v-else class="filing-cat-grid">
          <button
            v-for="cat in topLevelCategories"
            :key="cat.id"
            type="button"
            class="filing-cat-chip"
            :class="{ 'is-active': form.categoryId === cat.id }"
            @click="form.categoryId = cat.id"
          >
            <Icon :name="getCategoryIcon(cat)" />
            <span>{{ cat.name }}</span>
          </button>
        </div>
        <!-- Subcategory sub-picker, only when the parent has children. -->
        <div
          v-if="subCategories.length > 0"
          class="filing-cat-grid filing-cat-grid--sub"
        >
          <button
            v-for="cat in subCategories"
            :key="cat.id"
            type="button"
            class="filing-cat-chip filing-cat-chip--sub"
            :class="{ 'is-active': form.categoryId === cat.id }"
            @click="form.categoryId = cat.id"
          >
            <Icon :name="getCategoryIcon(cat)" />
            <span>{{ cat.name }}</span>
          </button>
        </div>
      </section>

      <!-- Title -->
      <section class="filing-section">
        <header class="filing-section-head">
          <span class="filing-section-num">02</span>
          <h2 class="filing-section-title">
            {{ $t('requests.new.fields.title') }}
          </h2>
        </header>
        <input
          v-model="form.title"
          type="text"
          class="filing-input"
          maxlength="200"
          :placeholder="$t('requests.new.fields.titlePlaceholder')"
          required
        />
        <span class="filing-counter tabular-nums">
          {{ form.title.length }}/200
        </span>
      </section>

      <!-- Description -->
      <section class="filing-section">
        <header class="filing-section-head">
          <span class="filing-section-num">03</span>
          <h2 class="filing-section-title">
            {{ $t('requests.new.fields.description') }}
          </h2>
        </header>
        <textarea
          v-model="form.description"
          class="filing-textarea"
          rows="6"
          maxlength="4000"
          :placeholder="$t('requests.new.fields.descriptionPlaceholder')"
          required
        />
        <span class="filing-counter tabular-nums">
          {{ form.description.length }}/4000
        </span>
      </section>

      <!-- Reward -->
      <section class="filing-section filing-section--reward">
        <header class="filing-section-head">
          <span class="filing-section-num">04</span>
          <h2 class="filing-section-title">
            {{ $t('requests.new.fields.reward') }}
          </h2>
          <span class="filing-section-optional">
            {{ $t('requests.new.fields.optional') }}
          </span>
        </header>
        <div class="filing-reward-row">
          <div class="filing-reward-input">
            <span class="filing-reward-mark">⊕</span>
            <input
              v-model.number="form.rewardPoints"
              type="number"
              min="0"
              :max="balance"
              step="10"
              class="filing-input"
              :placeholder="'0'"
            />
            <span class="filing-reward-unit">{{
              $t('requests.pointsShort')
            }}</span>
          </div>
          <div class="filing-balance">
            <div class="filing-balance-row">
              <span class="filing-balance-label">
                {{ $t('requests.new.balance.current') }}
              </span>
              <span class="filing-balance-value tabular-nums">
                {{ formatPoints(balance) }}
              </span>
            </div>
            <div class="filing-balance-row filing-balance-row--after">
              <span class="filing-balance-label">
                {{ $t('requests.new.balance.after') }}
              </span>
              <span
                class="filing-balance-value tabular-nums"
                :class="{ 'is-negative': insufficient }"
              >
                {{ formatPoints(balanceAfter) }}
              </span>
            </div>
          </div>
        </div>
        <p v-if="insufficient" class="filing-error">
          <Icon name="ph:warning-bold" />
          {{ $t('requests.new.errors.insufficient') }}
        </p>
        <p v-else class="filing-hint">
          <Icon name="ph:info-bold" />
          {{ $t('requests.new.rewardHint') }}
        </p>
      </section>

      <footer class="filing-actions">
        <NuxtLink to="/requests" class="filing-btn filing-btn--ghost">
          {{ $t('common.cancel') }}
        </NuxtLink>
        <button
          type="submit"
          class="filing-btn filing-btn--primary"
          :disabled="!canSubmit || submitting"
        >
          <Icon
            :name="submitting ? 'ph:circle-notch' : 'ph:megaphone-bold'"
            :class="{ 'loader-spin': submitting }"
          />
          <span>{{ $t('requests.new.actions.submit') }}</span>
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { getCategoryIcon } from '~/utils/categoryIcon';

definePageMeta({ title: 'New request' });

const { t } = useI18n();
const router = useRouter();
const notifications = useNotificationStore();
const { user } = useUserSession();
useHead({ title: () => t('requests.new.headTitle') });

interface Category {
  id: string;
  name: string;
  slug: string;
  type: string | null;
  icon: string | null;
  parentId: string | null;
  isAdult: boolean;
}

const { data: categoriesData, pending: categoriesPending } = await useFetch<
  Category[]
>('/api/categories');

const topLevelCategories = computed(() =>
  (categoriesData.value ?? []).filter((c) => c.parentId === null),
);

const form = reactive({
  categoryId: '',
  title: '',
  description: '',
  rewardPoints: 0,
});

const subCategories = computed(() => {
  // Show subcategories when the user has picked a top-level. If
  // they pick a sub directly (deep-link?), surface its siblings
  // by walking up to the parent's children.
  const all = categoriesData.value ?? [];
  if (!form.categoryId) return [];
  const picked = all.find((c) => c.id === form.categoryId);
  if (!picked) return [];
  const parentId = picked.parentId ?? picked.id;
  return all.filter((c) => c.parentId === parentId);
});

const balance = computed(() =>
  Number(((user.value as any)?.bonusPoints ?? 0)) || 0,
);
const balanceAfter = computed(() =>
  Math.max(0, balance.value - (form.rewardPoints || 0)),
);
const insufficient = computed(
  () => (form.rewardPoints || 0) > balance.value,
);

const canSubmit = computed(
  () =>
    form.categoryId !== '' &&
    form.title.trim().length >= 3 &&
    form.description.trim().length >= 10 &&
    !insufficient.value,
);

const submitting = ref(false);

function formatPoints(n: number): string {
  return n.toLocaleString('fr-FR').replace(/\s/g, ' ');
}

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    const { id } = await $fetch<{ id: string }>('/api/requests', {
      method: 'POST',
      body: {
        categoryId: form.categoryId,
        title: form.title.trim(),
        description: form.description.trim(),
        rewardPoints: form.rewardPoints || 0,
      },
    });
    notifications.success(t('requests.new.toasts.created'));
    await router.push(`/requests/${id}`);
  } catch (err: any) {
    notifications.error(
      err?.data?.message || t('requests.new.toasts.failed'),
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.filing {
  position: relative;
  isolation: isolate;
  max-width: 760px;
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
  --brass: 212 167 52;
  --brass-deep: 158 113 31;
  --danger: 244 63 94;
}
.tabular-nums { font-variant-numeric: tabular-nums; }

.filing-aura {
  position: absolute;
  top: -2rem;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
  height: 60vh;
  max-height: 460px;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.aura-blob {
  position: absolute;
  width: 480px;
  height: 480px;
  top: -180px;
  left: -120px;
  filter: blur(90px);
  opacity: 0.32;
  border-radius: 50%;
  background: radial-gradient(circle, rgb(var(--brass) / 0.5), transparent 65%);
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.5;
  mix-blend-mode: overlay;
}

.filing-back {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: color 0.15s, transform 0.2s;
}
.filing-back:hover {
  color: rgb(var(--brass));
  transform: translateX(-2px);
}

.filing-head { margin-bottom: 2.2rem; }
.filing-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin: 0 0 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgb(var(--brass));
}
.filing-eyebrow-mark {
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-size: 18px;
  line-height: 0;
  transform: translateY(2px);
  filter: drop-shadow(0 0 8px rgb(var(--brass) / 0.4));
}
.filing-title {
  margin: 0;
  font-family: 'Fraunces', 'Charter', Georgia, serif;
  font-style: italic;
  font-weight: 600;
  font-size: clamp(1.8rem, 4vw, 2.5rem);
  line-height: 1.05;
  color: rgb(var(--fg-strong));
}
.filing-intro {
  margin: 0.6rem 0 0;
  max-width: 58ch;
  font-size: 14px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}

.filing-form {
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
}
.filing-section {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 1.1rem 1.2rem 1rem;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.025), transparent 50%),
    rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: 0.5rem;
}
.filing-section-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.filing-section-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: rgb(var(--brass));
  padding: 0.18rem 0.45rem;
  border: 1px solid rgb(var(--brass) / 0.4);
  border-radius: 0.22rem;
  background: rgb(var(--brass) / 0.08);
}
.filing-section-title {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.filing-section-optional {
  margin-left: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}

.filing-cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem;
}
.filing-cat-grid--sub {
  margin-top: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.filing-cat-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.55rem 0.7rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  color: rgb(var(--fg-muted));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 0.15s, background 0.18s, border-color 0.18s, transform 0.18s;
}
.filing-cat-chip:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
  transform: translateY(-1px);
}
.filing-cat-chip.is-active {
  color: rgb(var(--brass));
  background: rgb(var(--brass) / 0.14);
  border-color: rgb(var(--brass) / 0.55);
  box-shadow: inset 0 0 0 1px rgb(var(--brass) / 0.3);
}
.filing-cat-chip--sub {
  font-size: 9.5px;
  padding: 0.42rem 0.6rem;
}
.filing-cat-chip > svg { font-size: 0.95rem; }

.filing-cat-loader {
  display: flex;
  justify-content: center;
  padding: 1.5rem 0;
}
.loader-spin { font-size: 1.2rem; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.filing-input,
.filing-textarea {
  width: 100%;
  padding: 0.65rem 0.85rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.5;
  transition: border-color 0.18s, box-shadow 0.18s;
}
.filing-textarea { resize: vertical; min-height: 120px; }
.filing-input:focus,
.filing-textarea:focus {
  outline: 0;
  border-color: rgb(var(--brass) / 0.55);
  box-shadow: 0 0 0 3px rgb(var(--brass) / 0.12);
}
.filing-counter {
  align-self: flex-end;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.05em;
  color: rgb(var(--fg-faint));
}

/* Reward stake row */
.filing-reward-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  align-items: stretch;
}
@media (max-width: 540px) {
  .filing-reward-row { grid-template-columns: 1fr; }
}
.filing-reward-input {
  position: relative;
  display: flex;
  align-items: center;
}
.filing-reward-mark {
  position: absolute;
  left: 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.05rem;
  font-weight: 900;
  color: rgb(var(--brass));
  pointer-events: none;
}
.filing-reward-input .filing-input {
  padding-left: 2.1rem;
  padding-right: 3rem;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgb(var(--brass));
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.08), transparent 70%),
    rgb(var(--bg-base));
  border-color: rgb(var(--brass) / 0.35);
}
.filing-reward-unit {
  position: absolute;
  right: 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--brass) / 0.7);
  pointer-events: none;
}
.filing-balance {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.7rem 0.85rem;
  background: rgb(var(--bg-base));
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.35rem;
}
.filing-balance-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.filing-balance-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.filing-balance-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 800;
  color: rgb(var(--fg-default));
}
.filing-balance-row--after .filing-balance-value {
  color: rgb(var(--brass));
}
.filing-balance-value.is-negative { color: rgb(var(--danger)); }

.filing-hint,
.filing-error {
  margin: 0;
  display: inline-flex;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: 12px;
  line-height: 1.45;
  color: rgb(var(--fg-muted));
}
.filing-hint > svg, .filing-error > svg { margin-top: 0.15rem; flex-shrink: 0; }
.filing-error { color: rgb(var(--danger)); }

/* Actions */
.filing-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.filing-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1.2rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
  text-decoration: none;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, color 0.18s, transform 0.2s;
}
.filing-btn--ghost:hover {
  border-color: rgb(var(--fg-default) / 0.4);
}
.filing-btn--primary {
  background:
    linear-gradient(180deg, rgb(var(--brass) / 0.3), rgb(var(--brass) / 0.1)),
    rgb(var(--bg-elevated));
  border-color: rgb(var(--brass) / 0.6);
  color: rgb(var(--brass));
}
.filing-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px -14px rgb(var(--brass) / 0.5);
}
.filing-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
