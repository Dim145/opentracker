/**
 * The admin panel's twenty destinations, grouped.
 *
 * This lives in a composable rather than inside `pages/admin.vue` because two
 * surfaces read it now: the sidebar and its mobile sheet, and the command
 * palette. The palette offering a page the sidebar has dropped — or missing one
 * it has gained — is the drift this prevents, and it is the reason the palette
 * does not keep a list of its own.
 */

export interface AdminNavItem {
  label: string;
  path: string;
  icon: string;
  description: string;
  /**
   * Hidden from anyone who is not the owner.
   *
   * Nothing sets this today: all twenty admin pages sit behind
   * `middleware: 'admin'`, and what the owner alone may do — transferring
   * ownership, editing a theme's raw CSS, managing federation peers, changing
   * roles, uploading a font — are operations inside those pages, guarded by
   * `requireOwnerSession` on the API side.
   *
   * It exists so that the first owner-only page cannot be added without the
   * question being asked. Both surfaces that read this list honour it, so
   * setting the flag is the whole of the work; forgetting to filter is not a
   * mistake that can be made downstream.
   */
  ownerOnly?: boolean;
}

export interface AdminNavGroup {
  key: string;
  label: string;
  icon: string;
  items: AdminNavItem[];
}

/**
 * Drops what the viewer may not reach, and any group left empty by that.
 *
 * Pure and exported so it can be tested without a Nuxt context — the guard is
 * worth more than the convenience of hiding it inside the composable.
 */
export function visibleAdminGroups(
  groups: AdminNavGroup[],
  isOwner: boolean
): AdminNavGroup[] {
  if (isOwner) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.ownerOnly),
    }))
    .filter((group) => group.items.length > 0);
}

export function useAdminNav() {
  const { t } = useI18n();
  const { user } = useUserSession();
  const isOwner = computed(() => !!user.value?.isOwner);

  /**
   * Dashboard and Settings are pinned outside the groups — one is where you
   * arrive, the other is where you end up, and burying either in a section
   * costs a click on the two most-reached rows.
   */
  const navHome = computed<AdminNavItem>(() => ({
    label: t('admin.nav.dashboard'),
    path: '/admin',
    icon: 'ph:layout',
    description: t('admin.descriptions.dashboard'),
  }));

  /**
   * Grouped by what the page governs, not by the feature that shipped it:
   * Banned IPs sits with people because that is what it acts on, and Torznab
   * sits with Federation because both are this tracker talking outwards.
   */
  const allGroups = computed(() => [
    {
      key: 'members',
      label: t('admin.nav.groups.members'),
      icon: 'ph:users-three',
      items: [
        {
          label: t('admin.nav.users'),
          path: '/admin/users',
          icon: 'ph:users',
          description: t('admin.descriptions.users'),
        },
        {
          label: t('admin.nav.roles'),
          path: '/admin/roles',
          icon: 'ph:user-circle-gear',
          description: t('admin.descriptions.roles'),
        },
        {
          label: t('admin.nav.invitations'),
          path: '/admin/invites',
          icon: 'ph:envelope-simple',
          description: t('admin.descriptions.invitations'),
        },
        {
          label: t('admin.nav.bannedIps'),
          path: '/admin/banned-ips',
          icon: 'ph:prohibit',
          description: t('admin.descriptions.bannedIps'),
        },
      ],
    },
    {
      key: 'catalogue',
      label: t('admin.nav.groups.catalogue'),
      icon: 'ph:books',
      items: [
        {
          label: t('admin.nav.categories'),
          path: '/admin/categories',
          icon: 'ph:folders',
          description: t('admin.descriptions.categories'),
        },
        {
          label: t('admin.nav.tags'),
          path: '/admin/tags',
          icon: 'ph:tag',
          description: t('admin.descriptions.tags'),
        },
        {
          label: t('admin.nav.uploadRules'),
          path: '/admin/upload-rules',
          icon: 'ph:check-square',
          description: t('admin.descriptions.uploadRules'),
        },
        {
          label: t('admin.nav.listingTemplates'),
          path: '/admin/templates',
          icon: 'ph:brackets-curly',
          description: t('admin.descriptions.listingTemplates'),
        },
      ],
    },
    {
      key: 'economy',
      label: t('admin.nav.groups.economy'),
      icon: 'ph:coins',
      items: [
        {
          label: t('admin.nav.bonusRules'),
          path: '/admin/bonus-rules',
          icon: 'ph:strategy',
          description: t('admin.descriptions.bonusRules'),
        },
        {
          label: t('admin.nav.bonusEvents'),
          path: '/admin/bonus-events',
          icon: 'ph:gift',
          description: t('admin.descriptions.bonusEvents'),
        },
        {
          label: t('admin.nav.shop'),
          path: '/admin/shop',
          icon: 'ph:storefront',
          description: t('admin.descriptions.shop'),
        },
        {
          label: t('admin.nav.freeleechPool'),
          path: '/admin/freeleech-pool',
          icon: 'ph:hand-coins',
          description: t('admin.descriptions.freeleechPool'),
        },
      ],
    },
    {
      key: 'integrations',
      label: t('admin.nav.groups.integrations'),
      icon: 'ph:plugs-connected',
      items: [
        {
          label: t('admin.nav.federation'),
          path: '/admin/federation',
          icon: 'ph:broadcast',
          description: t('admin.descriptions.federation'),
        },
        {
          label: t('admin.nav.federationTaxonomy'),
          path: '/admin/federation-taxonomy',
          icon: 'ph:tree-structure',
          description: t('admin.descriptions.federationTaxonomy'),
        },
        {
          label: t('admin.nav.torznab'),
          path: '/admin/torznab',
          icon: 'ph:plug',
          description: t('admin.descriptions.torznab'),
        },
        {
          label: t('admin.nav.notifications'),
          path: '/admin/notifications',
          icon: 'ph:bell-ringing',
          description: t('admin.descriptions.notifications'),
        },
      ],
    },
    {
      key: 'appearance',
      label: t('admin.nav.groups.appearance'),
      icon: 'ph:swatches',
      items: [
        {
          label: t('admin.nav.branding'),
          path: '/admin/branding',
          icon: 'ph:paint-brush',
          description: t('admin.descriptions.branding'),
        },
        {
          label: t('admin.nav.themes'),
          path: '/admin/themes',
          icon: 'ph:palette',
          description: t('admin.descriptions.themes'),
        },
      ],
    },
  ]);

  const navSettings = computed<AdminNavItem>(() => ({
    label: t('admin.nav.settings'),
    path: '/admin/settings',
    icon: 'ph:gear',
    description: t('admin.descriptions.settings'),
  }));

  /**
   * What this viewer may actually reach. Every consumer reads this rather than
   * the raw list, so an `ownerOnly` page cannot leak into a menu by omission.
   *
   * The two pinned entries are not filtered: the dashboard is where the panel
   * opens and settings is where it ends, and neither can sensibly be
   * owner-only. If that ever stops being true this is the line to change.
   */
  const navGroups = computed(() =>
    visibleAdminGroups(allGroups.value, isOwner.value)
  );

  /**
   * The flat view of the same destinations. Order matters: the dashboard has to
   * stay first, because it is `sectionFor`'s fallback.
   */
  const adminNavItems = computed<AdminNavItem[]>(() => [
    navHome.value,
    ...navGroups.value.flatMap((group) => group.items),
    navSettings.value,
  ]);

  return { navHome, navGroups, navSettings, adminNavItems };
}
