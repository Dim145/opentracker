<template>
  <div>
    <!-- Filter. Twenty destinations is past the point where scanning beats
         typing, so the list gets a filter rather than a deeper hierarchy.
         It is also what makes the accordion below affordable: reaching a
         page in a shut group costs two keystrokes, not a hunt. -->
    <div class="relative mb-2">
      <Icon
        name="ph:magnifying-glass"
        class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none"
      />
      <input
        v-model="query"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="$t('admin.nav.filterPlaceholder')"
        :aria-label="$t('admin.nav.filterPlaceholder')"
        class="
          admin-nav-filter
          w-full pl-8 pr-2.5 text-sm rounded-md
          bg-bg-secondary border border-border text-text-primary
          placeholder:text-text-muted
          focus:border-accent transition-colors
        "
        @keydown.enter.prevent="goToFirstMatch"
        @keydown.esc.prevent="query = ''"
      />
    </div>

    <nav :aria-label="$t('admin.eyebrow')" class="admin-nav">
      <!-- Filtering: the hierarchy is noise once a query has narrowed the
           list, so matches come back flat and in one place. -->
      <template v-if="trimmed">
        <p v-if="!matches.length" class="px-3 py-2 text-sm text-text-muted">
          {{ $t('admin.nav.noMatch') }}
        </p>
        <NuxtLink
          v-for="item in matches"
          :key="item.path"
          :to="item.path"
          class="admin-nav-link"
          :class="linkClass(item.path)"
          @click="onNavigate"
        >
          <Icon :name="item.icon" class="admin-nav-icon" />
          <span class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </template>

      <template v-else>
        <NuxtLink
          :to="home.path"
          class="admin-nav-link"
          :class="linkClass(home.path)"
          @click="onNavigate"
        >
          <Icon :name="home.icon" class="admin-nav-icon" />
          <span class="truncate">{{ home.label }}</span>
        </NuxtLink>

        <div v-for="group in groups" :key="group.key" class="admin-nav-group">
          <button
            type="button"
            class="admin-nav-link admin-nav-header"
            :class="headerClass(group)"
            :aria-expanded="openKey === group.key"
            :aria-controls="`admin-nav-panel-${group.key}`"
            @click="toggle(group.key)"
          >
            <Icon :name="group.icon" class="admin-nav-icon" />
            <span class="truncate">{{ group.label }}</span>
            <!-- A shut group still says whether the page you are on lives
                 inside it. Without this the active row simply vanishes when
                 its group closes and you lose your place. -->
            <span
              v-if="openKey !== group.key && holdsCurrent(group)"
              class="admin-nav-dot bg-accent"
              aria-hidden="true"
            />
            <Icon
              name="ph:caret-down"
              class="admin-nav-caret"
              :class="{ 'admin-nav-caret-open': openKey === group.key }"
            />
          </button>

          <!-- 0fr → 1fr animates the panel without measuring heights.
               `inert` is what keeps a shut panel out of the tab order and
               the accessibility tree — `overflow: hidden` does neither. -->
          <div
            class="admin-nav-panel"
            :class="{ 'admin-nav-panel-open': openKey === group.key }"
          >
            <div
              :id="`admin-nav-panel-${group.key}`"
              class="admin-nav-panel-inner border-l border-border"
              :inert="openKey === group.key ? undefined : true"
            >
              <NuxtLink
                v-for="item in group.items"
                :key="item.path"
                :to="item.path"
                class="admin-nav-link"
                :class="linkClass(item.path)"
                @click="onNavigate"
              >
                <Icon :name="item.icon" class="admin-nav-icon" />
                <span class="truncate">{{ item.label }}</span>
              </NuxtLink>
            </div>
          </div>
        </div>

        <div class="admin-nav-rule border-t border-border" />

        <NuxtLink
          :to="settings.path"
          class="admin-nav-link"
          :class="linkClass(settings.path)"
          @click="onNavigate"
        >
          <Icon :name="settings.icon" class="admin-nav-icon" />
          <span class="truncate">{{ settings.label }}</span>
        </NuxtLink>
      </template>
    </nav>
  </div>
</template>

<script setup lang="ts">
interface NavItem {
  label: string;
  path: string;
  icon: string;
  description?: string;
}

interface NavGroup {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
}

const props = defineProps<{
  home: NavItem;
  groups: NavGroup[];
  settings: NavItem;
  currentPath?: string;
}>();

const emit = defineEmits<{ navigate: [] }>();

const router = useRouter();

const query = ref('');
const trimmed = computed(() => query.value.trim());

/** The same twenty destinations, flat — what the filter searches. */
const allItems = computed<NavItem[]>(() => [
  props.home,
  ...props.groups.flatMap((group) => group.items),
  props.settings,
]);

// Ordering and accent-folding live in app/utils/navFilter.ts, where they are
// under test: both fail quietly, and neither shows up in a screenshot.
const matches = computed(() => filterNavItems(allItems.value, query.value));

function goToFirstMatch() {
  const first = matches.value[0];
  if (!first) return;
  query.value = '';
  emit('navigate');
  router.push(first.path);
}

function holdsCurrent(group: NavGroup) {
  return group.items.some((item) => item.path === props.currentPath);
}

/**
 * Which group is open follows the route. That means no state to carry across
 * visits, and no way to land on a page whose own group is shut. Clicking a
 * header still overrides it until the next navigation — and landing on a page
 * that belongs to no group (the dashboard, settings) leaves the open one
 * alone, so a detour there does not cost you your place.
 */
const openKey = ref<string | null>(null);
watch(
  () => props.currentPath,
  () => {
    const holder = props.groups.find(holdsCurrent);
    if (holder) openKey.value = holder.key;
  },
  { immediate: true }
);

function toggle(key: string) {
  openKey.value = openKey.value === key ? null : key;
}

function onNavigate() {
  query.value = '';
  emit('navigate');
}

// Colour states stay on utility classes; see the note above the stylesheet.
function linkClass(path: string) {
  return props.currentPath === path
    ? 'bg-bg-secondary text-text-primary border-border'
    : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary/50 border-transparent';
}

function headerClass(group: NavGroup) {
  return holdsCurrent(group)
    ? 'text-text-primary hover:bg-bg-secondary/50 border-transparent'
    : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary/50 border-transparent';
}
</script>

<style scoped>
/* This sheet owns layout only — never colour, background or border-colour.
   A scoped selector carries `[data-v-…]` (0,2,0) and would out-specify every
   Tailwind utility (0,1,0) it shares a property with, so the active state
   would silently lose. One owner per property: geometry here, palette on the
   utility classes in the template. */
.admin-nav {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

/* Mobile-first, and it has to stay that way: a media query adds no
   specificity, so whichever rule comes LAST wins between these two. Below md
   this list lives in the drawer and every row is a finger target, so the rows
   clear Apple's 44pt floor (Material asks 48dp; 44 is the common compromise).
   Above md it is a pointer sidebar, where 35px rows are what let all six
   groups fit without the column scrolling. */
.admin-nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.6875rem 0.75rem;
  border-radius: 0.375rem;
  border-width: 1px;
  border-style: solid;
  font-size: 0.875rem;
  font-weight: 500;
  text-align: left;
  transition:
    color 120ms ease,
    background-color 120ms ease,
    border-color 120ms ease;
}

.admin-nav-header {
  cursor: pointer;
}

.admin-nav-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.admin-nav-caret {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0.6;
  transition: transform 180ms ease;
}

.admin-nav-caret-open {
  transform: rotate(180deg);
}

.admin-nav-dot {
  width: 0.375rem;
  height: 0.375rem;
  margin-left: auto;
  border-radius: 9999px;
  flex-shrink: 0;
}

/* Whichever of the two lands first takes the auto margin; the other trails it. */
.admin-nav-dot + .admin-nav-caret {
  margin-left: 0.5rem;
}

.admin-nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.admin-nav-panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 180ms ease;
}

.admin-nav-panel-open {
  grid-template-rows: 1fr;
}

.admin-nav-panel-inner {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-height: 0;
  overflow: hidden;
  margin-left: 1.375rem;
  padding-left: 0.375rem;
}

.admin-nav-rule {
  margin: 0.375rem 0;
}

/* The field is 22px of content and border; 11px of padding either side puts
   it on the same 44px floor as the rows it filters. */
.admin-nav-filter {
  padding-top: 0.6875rem;
  padding-bottom: 0.6875rem;
}

@media (min-width: 768px) {
  .admin-nav-link {
    padding: 0.375rem 0.75rem;
  }

  .admin-nav-filter {
    padding-top: 0.3125rem;
    padding-bottom: 0.3125rem;
  }
}
</style>
