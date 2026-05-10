<template>
  <div class="max-w-5xl mx-auto py-8 sm:py-12">
    <!-- Header -->
    <header class="mb-10">
      <NuxtLink
        to="/me"
        class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-text-strong transition-colors mb-5"
      >
        <Icon name="ph:arrow-left-bold" />
        {{ $t('shop.backToProfile') }}
      </NuxtLink>

      <div class="flex items-start justify-between gap-6 flex-wrap">
        <div class="min-w-0 flex-1">
          <p
            class="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1.5"
          >
            {{ $t('shop.eyebrow') }}
          </p>
          <h1
            class="text-3xl sm:text-4xl md:text-5xl font-black text-text-strong tracking-tighter break-words leading-[0.95]"
          >
            {{ $t('shop.titleMain') }}
            <span class="font-extralight italic text-text-muted">
              {{ $t('shop.titleAccent') }}
            </span>
          </h1>
          <p class="text-xs text-text-muted leading-relaxed max-w-xl mt-4">
            {{ $t('shop.blurb') }}
          </p>
        </div>

        <!-- Balance card — strong typographic anchor on the right.
             Acts as the focal point so the user always knows what
             they have to spend without scrolling. -->
        <div
          class="bg-bg-secondary border border-border rounded p-4 min-w-[12rem] relative overflow-hidden"
        >
          <div
            class="absolute inset-x-0 top-0 h-px bg-accent/40"
            aria-hidden="true"
          />
          <p
            class="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('shop.balance') }}
          </p>
          <p
            class="font-mono text-3xl font-bold text-text-strong tabular-nums leading-none flex items-baseline gap-1.5"
          >
            <Icon name="ph:coin-fill" class="text-accent text-2xl shrink-0" />
            {{ formatNumber(bonusPoints) }}
          </p>
          <p
            class="text-[9px] font-mono uppercase tracking-widest text-text-faint mt-2"
          >
            {{ $t('shop.points') }}
          </p>
        </div>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="pending" class="py-16 flex justify-center">
      <Icon name="ph:circle-notch" class="animate-spin text-3xl text-text-muted" />
    </div>

    <!-- Empty state — editorial blank-shelf treatment. -->
    <div
      v-else-if="items.length === 0"
      class="py-16 text-center border border-dashed border-border rounded relative"
    >
      <div
        class="absolute inset-x-12 top-1/2 -translate-y-1/2 h-px bg-fg-default/5"
        aria-hidden="true"
      />
      <Icon
        name="ph:scroll"
        class="text-5xl text-text-faint mx-auto mb-3 relative"
      />
      <p class="text-sm font-bold text-text-strong mb-1 relative">
        {{ $t('shop.empty.headline') }}
      </p>
      <p class="text-xs text-text-muted relative max-w-md mx-auto leading-relaxed">
        {{ $t('shop.empty.help') }}
      </p>
    </div>

    <!-- Item grid -->
    <ul
      v-else
      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 list-none p-0 m-0"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="bg-bg-secondary border border-border rounded p-4 flex flex-col gap-3 transition-all hover:-translate-y-0.5 hover:border-fg-default/30 relative overflow-hidden"
        :class="{
          'opacity-60': item.cost > bonusPoints,
        }"
      >
        <!-- Top accent stripe — orange on low stock, accent otherwise. -->
        <div
          class="absolute inset-x-3 top-0 h-px"
          :class="
            item.stock !== null && item.stock <= 3
              ? 'bg-warning/60'
              : 'bg-accent/40'
          "
          aria-hidden="true"
        />

        <!-- Icon -->
        <div class="flex items-center justify-between">
          <div
            class="w-10 h-10 rounded bg-fg-default/5 border border-border flex items-center justify-center text-xl text-text-strong"
          >
            <Icon :name="item.icon || defaultIconFor(item.effect.type)" />
          </div>
          <span
            v-if="item.stock !== null"
            class="text-[10px] font-mono uppercase tracking-widest"
            :class="item.stock <= 3 ? 'text-warning' : 'text-text-muted'"
          >
            {{ $t('shop.stock', item.stock, { n: item.stock }) }}
          </span>
        </div>

        <!-- Body -->
        <div class="flex-1">
          <h3 class="text-sm font-bold text-text-strong leading-tight">
            {{ item.name }}
          </h3>
          <p
            v-if="item.description"
            class="text-xs text-text-muted leading-relaxed mt-1.5"
          >
            {{ item.description }}
          </p>
          <p
            class="flex items-center gap-1.5 text-[11px] font-mono text-text-secondary mt-3 pt-3 border-t border-border"
          >
            <Icon name="ph:lightning-bold" class="text-[11px] text-accent" />
            {{ describeEffect(item.effect) }}
          </p>
        </div>

        <!-- Cost + buy button -->
        <div class="flex items-center justify-between gap-3 pt-1">
          <div class="leading-tight">
            <p
              class="font-mono text-xl font-bold text-text-strong tabular-nums leading-none"
            >
              {{ formatNumber(item.cost) }}
            </p>
            <p
              class="text-[9px] font-mono uppercase tracking-widest text-text-muted mt-1"
            >
              {{ $t('shop.points') }}
            </p>
          </div>
          <button
            type="button"
            class="text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            :class="
              item.cost > bonusPoints || (item.stock !== null && item.stock <= 0)
                ? 'border border-border text-text-muted'
                : 'bg-accent text-accent-fg hover:bg-accent-hover'
            "
            :disabled="
              pendingItemId !== null ||
              item.cost > bonusPoints ||
              (item.stock !== null && item.stock <= 0)
            "
            @click="confirmAndBuy(item)"
          >
            <Icon
              :name="
                pendingItemId === item.id
                  ? 'ph:circle-notch'
                  : item.cost > bonusPoints
                    ? 'ph:lock-bold'
                    : 'ph:check-circle-bold'
              "
              :class="pendingItemId === item.id ? 'animate-spin' : ''"
            />
            <span v-if="pendingItemId === item.id">{{ $t('shop.buying') }}</span>
            <span v-else-if="item.cost > bonusPoints">{{ $t('shop.notEnough') }}</span>
            <span v-else>{{ $t('shop.buy') }}</span>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();
const confirmDialog = useConfirm();
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

const { data, pending, refresh } = await useFetch<ShopResponse>('/api/shop/items');
const items = computed(() => data.value?.items ?? []);
const bonusPoints = ref(data.value?.bonusPoints ?? 0);
watch(
  () => data.value?.bonusPoints,
  (v) => {
    if (typeof v === 'number') bonusPoints.value = v;
  },
);

const pendingItemId = ref<string | null>(null);

function defaultIconFor(type: ShopItemEffect['type']): string {
  return type === 'invite' ? 'ph:envelope-simple-bold' : 'ph:cloud-arrow-up-bold';
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

function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

async function confirmAndBuy(item: ShopItem) {
  if (pendingItemId.value !== null) return;
  if (item.cost > bonusPoints.value) return;

  const ok = await confirmDialog.confirm({
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
