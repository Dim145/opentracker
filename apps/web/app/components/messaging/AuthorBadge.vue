<template>
  <!--
    One badge beside a name, in a message line.

    Deliberately smaller than <RoleBadge>, which is sized for a profile
    header: next to a username in a chat line the profile pill is taller
    than the text it annotates and drags the eye off the message.

    The three staff kinds carry no name from the server — they are
    translated here. An operator-defined role carries its own name and
    colour, because neither is ours to translate or theme.
  -->
  <span
    v-if="badge"
    class="ab"
    :style="style"
    :title="label"
  >
    <!--
      The icon is back: icons now come from this site's own endpoint
      rather than the public Iconify API, so a role whose icon the
      operator typed by hand resolves without leaving the origin. In the
      static shape, which has no server to ask, an icon outside the
      bundled set renders nothing — a gap, not a request elsewhere.
    -->
    <Icon
      v-if="badge.kind === 'role' && badge.icon"
      :name="badge.icon"
      class="ab-icon"
      aria-hidden="true"
    />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
export interface AuthorBadgeValue {
  kind: 'owner' | 'admin' | 'moderator' | 'role';
  name?: string;
  color?: string;
  icon?: string | null;
}

const props = defineProps<{ badge?: AuthorBadgeValue | null }>();
const { t } = useI18n();

const label = computed(() => {
  const b = props.badge;
  if (!b) return '';
  if (b.kind === 'role') return b.name ?? '';
  return t(`messaging.badge.${b.kind}`);
});

/*
 * Staff kinds map onto the app's own semantic tokens rather than fresh
 * hexes: owner takes the warm accent, admin the danger colour and
 * moderator the informational one, which is what the profile header
 * already uses for the same two roles. A role defined by the operator
 * brings its own hex and is mixed the same way <RoleBadge> mixes it, so
 * the two never disagree about what a given role looks like.
 */
const STAFF_TOKEN: Record<string, string> = {
  owner: '--accent-warm',
  admin: '--danger',
  moderator: '--info',
};

const style = computed(() => {
  const b = props.badge;
  if (!b) return {};
  if (b.kind !== 'role') {
    const token = STAFF_TOKEN[b.kind] ?? '--accent-warm';
    return {
      color: `rgb(var(${token}))`,
      backgroundColor: `rgb(var(${token}) / 0.14)`,
      borderColor: `rgb(var(${token}) / 0.4)`,
    };
  }
  const c = b.color || '#6b7280';
  return {
    color: `color-mix(in srgb, ${c} 78%, white 22%)`,
    backgroundColor: `color-mix(in srgb, ${c} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
  };
});
</script>

<style scoped>
.ab-icon { font-size: 0.7rem; }
.ab {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.05rem 0.35rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  /* Small, and uppercase rather than bold: at this size weight alone
     does not separate it from the username it sits next to. */
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  line-height: 1.4;
  white-space: nowrap;
}
</style>
