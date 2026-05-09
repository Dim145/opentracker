<template>
  <div class="user-registry">
    <!-- ── Eyebrow + headline ──────────────────────────────── -->
    <header class="registry-head">
      <div>
        <p class="registry-eyebrow">User registry · Operator console</p>
        <h2 class="registry-title">
          Population
          <span class="registry-title-accent">{{ data?.stats.total ?? 0 }}</span>
        </h2>
      </div>
      <div class="registry-head-tools">
        <button
          type="button"
          class="tool-btn"
          :disabled="loading"
          :title="loading ? 'Refreshing…' : 'Refresh'"
          @click="refresh"
        >
          <Icon
            name="ph:arrows-clockwise-bold"
            :class="{ 'animate-spin': loading }"
          />
        </button>
      </div>
    </header>

    <!-- ── KPI strip ───────────────────────────────────────── -->
    <ul class="kpi-strip" :class="{ 'kpi-strip--loading': !data }">
      <li
        v-for="kpi in kpis"
        :key="kpi.key"
        class="kpi"
        :class="[
          `kpi--${kpi.tone}`,
          { 'kpi--active': kpi.filter && isFilterActive(kpi.filter) },
        ]"
        :tabindex="kpi.filter ? 0 : -1"
        :role="kpi.filter ? 'button' : undefined"
        @click="kpi.filter ? toggleKpiFilter(kpi.filter) : null"
        @keyup.enter="kpi.filter ? toggleKpiFilter(kpi.filter) : null"
      >
        <span class="kpi-label">
          <span v-if="kpi.dot" class="kpi-dot" :class="`kpi-dot--${kpi.tone}`" />
          {{ kpi.label }}
        </span>
        <span class="kpi-value">{{ kpi.value }}</span>
        <span v-if="kpi.sub" class="kpi-sub">{{ kpi.sub }}</span>
      </li>
    </ul>

    <!-- ── Filter bar ──────────────────────────────────────── -->
    <div class="filters">
      <div class="filter-search">
        <Icon name="ph:magnifying-glass-bold" class="filter-search-icon" />
        <input
          v-model="searchInput"
          type="search"
          placeholder="Search by username…"
          class="filter-search-input"
          @keydown.enter.prevent
        />
        <button
          v-if="searchInput"
          type="button"
          class="filter-search-clear"
          aria-label="Clear search"
          @click="searchInput = ''"
        >
          <Icon name="ph:x-bold" />
        </button>
      </div>

      <div class="filter-row">
        <label class="filter-select">
          <span>Role</span>
          <select v-model="filters.role" class="filter-select-input">
            <option value="">All</option>
            <option value="none">No role</option>
            <option v-for="role in roles" :key="role.id" :value="role.id">
              {{ role.name }}
            </option>
          </select>
        </label>

        <label class="filter-select">
          <span>Activity</span>
          <select v-model="filters.activity" class="filter-select-input">
            <option value="">All</option>
            <option value="online">● Online (≤5 min)</option>
            <option value="active">Active (≤24 h)</option>
            <option value="idle">Idle (&gt;30 d)</option>
            <option value="never">Never logged back</option>
          </select>
        </label>

        <label class="filter-select">
          <span>Status</span>
          <select v-model="filters.status" class="filter-select-input">
            <option value="">All</option>
            <option value="staff">Staff (admin or mod)</option>
            <option value="admin">Admin only</option>
            <option value="mod">Moderator only</option>
            <option value="banned">Banned</option>
            <option value="ok">Active &amp; not banned</option>
          </select>
        </label>

        <button
          v-if="hasActiveFilters"
          type="button"
          class="filter-reset"
          @click="resetFilters"
        >
          <Icon name="ph:broom-bold" />
          Reset filters
        </button>
      </div>
    </div>

    <!-- ── Mobile card list ─ < md ────────────────────────── -->
    <!-- The 8-column table is unreadable on phones (every column adds
         horizontal scroll inside the card). We render a compact card
         per user with the same data and action set. -->
    <div class="md:hidden user-cards" :aria-busy="loading">
      <div
        v-if="loading && !data"
        class="user-card user-card--skeleton"
        v-for="i in pageSize"
        :key="`uc-sk-${i}`"
      >
        <div class="sk-bar" :style="{ width: `${40 + (i % 7) * 6}%` }" />
      </div>

      <div
        v-if="data && data.items.length === 0"
        class="user-card-empty"
      >
        <Icon name="ph:user-list" class="empty-icon" />
        <p class="empty-headline">No users match those filters</p>
        <button type="button" class="empty-link" @click="resetFilters">
          clearing all filters
        </button>
      </div>

      <article
        v-for="u in (data && data.items.length > 0) ? data.items : []"
        :key="`uc-${u.id}`"
        class="user-card"
        :class="{ 'user-card--banned': u.isBanned }"
      >
        <div class="user-card-head">
          <div class="avatar avatar--md" :style="avatarStyle(u)">
            {{ u.username.slice(0, 2).toUpperCase() }}
          </div>
          <div class="user-card-id">
            <NuxtLink
              :to="`/users/${u.id}`"
              class="user-card-name"
              :class="{ 'user-cell-name--banned': u.isBanned }"
            >
              {{ u.username }}
            </NuxtLink>
            <p class="user-card-meta">
              <span class="user-uid">#{{ u.id.slice(0, 8) }}</span>
              <ClientOnly>
                <span class="last-seen" :class="lastSeenTone(u)">
                  <span
                    v-if="lastSeenTone(u) === 'online'"
                    class="online-dot"
                  />
                  {{ formatLastSeen(u) }}
                </span>
                <template #fallback>
                  <span class="last-seen">…</span>
                </template>
              </ClientOnly>
            </p>
          </div>
        </div>

        <div class="role-stack user-card-roles">
          <span
            v-if="u.isAdmin"
            class="role-chip role-chip--admin"
            title="Permission level: admin"
          >
            <Icon name="ph:crown-fill" />
            Admin
          </span>
          <span
            v-else-if="u.isModerator"
            class="role-chip role-chip--mod"
            title="Permission level: moderator"
          >
            <Icon name="ph:shield-chevron-fill" />
            Mod
          </span>
          <RoleBadge
            v-for="r in u.roles"
            :key="r.id"
            :role="r"
            :title="`${r.assignmentMode === 'auto' ? 'Auto' : 'Manual'} · attached ${formatJoined(r.assignedAt)}`"
          />
          <span
            v-if="!u.isAdmin && !u.isModerator && u.roles.length === 0"
            class="role-chip role-chip--none"
          >
            <Icon name="ph:user" />
            Member
          </span>
        </div>

        <dl class="user-card-stats">
          <div>
            <dt>Ratio</dt>
            <dd :class="['ratio', ratioTone(u)]">{{ formatRatio(u) }}</dd>
          </div>
          <div>
            <dt>Up / Down</dt>
            <dd class="user-card-bytes">
              <span class="bytes">{{ formatSize(u.uploaded) }}</span>
              <span class="bytes-divider">/</span>
              <span class="bytes bytes-down">{{ formatSize(u.downloaded) }}</span>
            </dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd class="cell--mono">{{ formatJoined(u.createdAt) }}</dd>
          </div>
          <div v-if="u.invitesRemaining > 0">
            <dt>Invites</dt>
            <dd>
              <span class="invites">
                <Icon name="ph:envelope-bold" />
                {{ u.invitesRemaining }}
              </span>
            </dd>
          </div>
        </dl>

        <div class="user-card-actions">
          <button
            type="button"
            class="row-action"
            :class="{ 'row-action--danger-on': u.isBanned }"
            :title="u.isBanned ? 'Unban' : 'Ban (will also block their IP)'"
            :disabled="actionPending[`${u.id}:ban`]"
            @click="onToggleBan(u)"
          >
            <Icon
              :name="actionPending[`${u.id}:ban`] ? 'ph:circle-notch' : u.isBanned ? 'ph:lock-key-open-bold' : 'ph:lock-key-bold'"
              :class="{ 'animate-spin': actionPending[`${u.id}:ban`] }"
            />
          </button>
          <button
            v-if="user?.isAdmin"
            type="button"
            class="row-action"
            :class="{ 'row-action--mod-on': u.isModerator }"
            title="Toggle moderator"
            :disabled="actionPending[`${u.id}:mod`]"
            @click="onToggleStaff(u, 'isModerator')"
          >
            <Icon
              :name="actionPending[`${u.id}:mod`] ? 'ph:circle-notch' : 'ph:shield-chevron-bold'"
              :class="{ 'animate-spin': actionPending[`${u.id}:mod`] }"
            />
          </button>
          <button
            v-if="user?.isAdmin"
            type="button"
            class="row-action"
            :class="{ 'row-action--admin-on': u.isAdmin }"
            title="Toggle admin"
            :disabled="actionPending[`${u.id}:admin`]"
            @click="onToggleStaff(u, 'isAdmin')"
          >
            <Icon
              :name="actionPending[`${u.id}:admin`] ? 'ph:circle-notch' : 'ph:crown-bold'"
              :class="{ 'animate-spin': actionPending[`${u.id}:admin`] }"
            />
          </button>
          <button
            v-if="user?.isAdmin && roles.length > 0"
            type="button"
            class="row-action"
            :class="{ 'row-action--has-roles': u.roles.length > 0 }"
            :title="`Manage roles (${u.roles.length} attached)`"
            @click="openRolesModal(u)"
          >
            <Icon name="ph:identification-badge-bold" />
            <span v-if="u.roles.length > 0" class="row-action__count">{{
              u.roles.length
            }}</span>
          </button>
        </div>
      </article>
    </div>

    <!-- ── Table ─ ≥ md ─────────────────────────────────── -->
    <div class="table-wrap hidden md:block">
      <table class="reg-table" :aria-busy="loading">
        <thead>
          <tr>
            <th
              v-for="col in columns"
              :key="col.key"
              :class="[
                'th',
                col.sortable && 'th--sortable',
                col.align && `th--${col.align}`,
                col.sortable && currentSort === col.key && 'th--active',
              ]"
              :aria-sort="ariaSort(col.key)"
              @click="col.sortable && toggleSort(col.key)"
            >
              <span>{{ col.label }}</span>
              <Icon
                v-if="col.sortable"
                :name="sortIcon(col.key)"
                class="th-sort-icon"
              />
            </th>
            <th class="th th--right">Actions</th>
          </tr>
        </thead>

        <!-- Loading skeleton -->
        <tbody v-if="loading && !data">
          <tr v-for="i in pageSize" :key="`sk-${i}`" class="row row--skeleton">
            <td colspan="8">
              <div class="sk-bar" :style="{ width: `${30 + (i % 7) * 8}%` }" />
            </td>
          </tr>
        </tbody>

        <!-- Empty state -->
        <tbody v-else-if="data && data.items.length === 0">
          <tr>
            <td colspan="8" class="empty">
              <div class="empty-inner">
                <Icon name="ph:user-list" class="empty-icon" />
                <p class="empty-headline">No users match those filters</p>
                <p class="empty-sub">
                  Try widening the date range or
                  <button type="button" class="empty-link" @click="resetFilters">
                    clearing all filters
                  </button>
                  .
                </p>
              </div>
            </td>
          </tr>
        </tbody>

        <!-- Rows -->
        <tbody v-else>
          <tr
            v-for="u in data?.items ?? []"
            :key="u.id"
            class="row"
            :class="{ 'row--banned': u.isBanned }"
          >
            <td class="cell cell--user">
              <div class="user-cell">
                <div
                  class="avatar"
                  :style="avatarStyle(u)"
                  :title="`UID ${u.id}`"
                >
                  {{ u.username.slice(0, 2).toUpperCase() }}
                </div>
                <div class="user-cell-body">
                  <NuxtLink
                    :to="`/users/${u.id}`"
                    class="user-cell-name"
                    :class="{ 'user-cell-name--banned': u.isBanned }"
                  >
                    {{ u.username }}
                  </NuxtLink>
                  <p class="user-cell-meta">
                    <span class="user-uid">#{{ u.id.slice(0, 8) }}</span>
                    <span
                      v-if="u.lastIp"
                      class="user-ip"
                      :title="u.lastIp"
                    >
                      <Icon name="ph:globe-bold" />
                      {{ u.lastIp }}
                    </span>
                    <span
                      v-else-if="u.lastIpHash"
                      class="user-ip user-ip--hashed"
                      title="Stable hash of the user's last IP. Equal hashes mean equal IPs — useful for spotting multi-account abuse without seeing the raw address."
                    >
                      <Icon name="ph:fingerprint-bold" />
                      {{ u.lastIpHash }}
                    </span>
                  </p>
                </div>
              </div>
            </td>

            <td class="cell">
              <!-- Multi-role display: stack the staff indicator (admin /
                   mod) before the user's custom badges. Each chip is
                   self-coloured via <RoleBadge>; on hover the title
                   surfaces when it was attached + whether manually. -->
              <div class="role-stack">
                <span
                  v-if="u.isAdmin"
                  class="role-chip role-chip--admin"
                  title="Permission level: admin"
                >
                  <Icon name="ph:crown-fill" />
                  Admin
                </span>
                <span
                  v-else-if="u.isModerator"
                  class="role-chip role-chip--mod"
                  title="Permission level: moderator"
                >
                  <Icon name="ph:shield-chevron-fill" />
                  Mod
                </span>
                <RoleBadge
                  v-for="r in u.roles"
                  :key="r.id"
                  :role="r"
                  :title="`${r.assignmentMode === 'auto' ? 'Auto' : 'Manual'} · attached ${formatJoined(r.assignedAt)}`"
                />
                <span
                  v-if="!u.isAdmin && !u.isModerator && u.roles.length === 0"
                  class="role-chip role-chip--none"
                  title="No staff flag, no role attached"
                >
                  <Icon name="ph:user" />
                  Member
                </span>
              </div>
            </td>

            <td class="cell cell--mono">
              <span :title="u.createdAt">{{ formatJoined(u.createdAt) }}</span>
            </td>

            <td class="cell cell--mono">
              <!-- ClientOnly: lastSeenTone() and formatLastSeen() both call
                   Date.now(), which diverges between SSR and hydration. The
                   fallback shows the raw "Joined …" timestamp so the cell
                   isn't blank during the first paint. -->
              <ClientOnly>
                <span class="last-seen" :class="lastSeenTone(u)">
                  <span
                    v-if="lastSeenTone(u) === 'online'"
                    class="online-dot"
                  />
                  {{ formatLastSeen(u) }}
                </span>
                <template #fallback>
                  <span class="last-seen">…</span>
                </template>
              </ClientOnly>
            </td>

            <td class="cell cell--right cell--mono">
              <span class="ratio" :class="ratioTone(u)" :title="ratioTooltip(u)">
                {{ formatRatio(u) }}
              </span>
            </td>

            <td class="cell cell--right cell--mono">
              <span class="bytes">{{ formatSize(u.uploaded) }}</span>
              <span class="bytes-divider">/</span>
              <span class="bytes bytes-down">{{ formatSize(u.downloaded) }}</span>
            </td>

            <td class="cell cell--center">
              <span v-if="u.invitesRemaining > 0" class="invites">
                <Icon name="ph:envelope-bold" />
                {{ u.invitesRemaining }}
              </span>
              <span v-else class="cell-dash">—</span>
            </td>

            <td class="cell cell--right">
              <div class="row-actions">
                <button
                  type="button"
                  class="row-action"
                  :class="{ 'row-action--danger-on': u.isBanned }"
                  :title="u.isBanned ? 'Unban' : 'Ban (will also block their IP)'"
                  :disabled="actionPending[`${u.id}:ban`]"
                  @click="onToggleBan(u)"
                >
                  <Icon
                    :name="
                      actionPending[`${u.id}:ban`]
                        ? 'ph:circle-notch'
                        : u.isBanned
                          ? 'ph:lock-key-open-bold'
                          : 'ph:lock-key-bold'
                    "
                    :class="{
                      'animate-spin': actionPending[`${u.id}:ban`],
                    }"
                  />
                </button>

                <button
                  v-if="user?.isAdmin"
                  type="button"
                  class="row-action"
                  :class="{ 'row-action--mod-on': u.isModerator }"
                  title="Toggle moderator"
                  :disabled="actionPending[`${u.id}:mod`]"
                  @click="onToggleStaff(u, 'isModerator')"
                >
                  <Icon
                    :name="
                      actionPending[`${u.id}:mod`]
                        ? 'ph:circle-notch'
                        : 'ph:shield-chevron-bold'
                    "
                    :class="{
                      'animate-spin': actionPending[`${u.id}:mod`],
                    }"
                  />
                </button>

                <button
                  v-if="user?.isAdmin"
                  type="button"
                  class="row-action"
                  :class="{ 'row-action--admin-on': u.isAdmin }"
                  title="Toggle admin"
                  :disabled="actionPending[`${u.id}:admin`]"
                  @click="onToggleStaff(u, 'isAdmin')"
                >
                  <Icon
                    :name="
                      actionPending[`${u.id}:admin`]
                        ? 'ph:circle-notch'
                        : 'ph:crown-bold'
                    "
                    :class="{
                      'animate-spin': actionPending[`${u.id}:admin`],
                    }"
                  />
                </button>

                <button
                  v-if="user?.isAdmin && roles.length > 0"
                  type="button"
                  class="row-action"
                  :class="{ 'row-action--has-roles': u.roles.length > 0 }"
                  :title="`Manage roles (${u.roles.length} attached)`"
                  @click="openRolesModal(u)"
                >
                  <Icon name="ph:identification-badge-bold" />
                  <span
                    v-if="u.roles.length > 0"
                    class="row-action__count"
                    >{{ u.roles.length }}</span
                  >
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Pagination ──────────────────────────────────────── -->
    <footer v-if="data" class="pager">
      <span class="pager-summary">
        <span class="pager-summary-strong">
          {{ rangeStart }}–{{ rangeEnd }}
        </span>
        of
        <span class="pager-summary-strong">{{ data.total }}</span>
        <template v-if="hasActiveFilters">
          ·
          <button class="pager-clear" @click="resetFilters">
            clear filters
          </button>
        </template>
      </span>

      <div class="pager-controls">
        <label class="pager-size">
          <span>Rows</span>
          <select v-model.number="pageSize" class="pager-size-input">
            <option :value="10">10</option>
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>

        <div class="pager-buttons">
          <button
            class="pager-btn"
            :disabled="page === 1"
            title="First page"
            @click="goTo(1)"
          >
            <Icon name="ph:caret-double-left-bold" />
          </button>
          <button
            class="pager-btn"
            :disabled="page === 1"
            @click="goTo(page - 1)"
          >
            <Icon name="ph:caret-left-bold" />
            <span>Prev</span>
          </button>

          <span class="pager-where">
            Page <strong>{{ page }}</strong> of {{ totalPages }}
          </span>

          <button
            class="pager-btn"
            :disabled="page >= totalPages"
            @click="goTo(page + 1)"
          >
            <span>Next</span>
            <Icon name="ph:caret-right-bold" />
          </button>
          <button
            class="pager-btn"
            :disabled="page >= totalPages"
            title="Last page"
            @click="goTo(totalPages)"
          >
            <Icon name="ph:caret-double-right-bold" />
          </button>
        </div>
      </div>
    </footer>

    <!-- ── Multi-role management modal ─────────────────────────
         Lists every defined role; per row shows the live attached
         state (manual / auto / none) + an action that flips it. -->
    <Modal
      v-model="rolesModalOpen"
      :title="
        rolesModalUser
          ? `Manage roles · ${rolesModalUser.username}`
          : 'Manage roles'
      "
      icon="ph:identification-badge-bold"
      size="lg"
    >
      <div v-if="rolesModalUser" class="rm-body">
        <p class="rm-eyebrow">
          {{ rolesModalUser.roles.length }} of
          {{ roles.length }} role{{ roles.length === 1 ? '' : 's' }} attached
        </p>

        <ul v-if="roles.length > 0" class="rm-list">
          <li
            v-for="role in roles"
            :key="role.id"
            class="rm-row"
            :class="{
              'rm-row--on': isAttached(rolesModalUser, role.id),
              'rm-row--manual':
                isAttached(rolesModalUser, role.id) &&
                attachedManually(rolesModalUser, role.id),
            }"
          >
            <div class="rm-row__id">
              <RoleBadge :role="role" />
              <p class="rm-row__meta">
                <span
                  class="rm-row__mode"
                  :class="
                    role.assignmentMode === 'auto'
                      ? 'rm-row__mode--auto'
                      : 'rm-row__mode--manual'
                  "
                >
                  <Icon
                    :name="
                      role.assignmentMode === 'auto'
                        ? 'ph:lightning-fill'
                        : 'ph:hand-pointing-fill'
                    "
                  />
                  {{ role.assignmentMode === 'auto' ? 'Auto' : 'Manual' }}
                </span>
                <span class="rm-row__sep">·</span>
                <span>prio {{ role.priority }}</span>
                <template v-if="isAttached(rolesModalUser, role.id)">
                  <span class="rm-row__sep">·</span>
                  <span class="rm-row__attached">
                    {{
                      attachedManually(rolesModalUser, role.id)
                        ? 'Manual freeze'
                        : 'Auto-attached'
                    }}
                  </span>
                </template>
              </p>
            </div>
            <div class="rm-row__actions">
              <button
                v-if="!isAttached(rolesModalUser, role.id)"
                type="button"
                class="rm-action rm-action--attach"
                :disabled="!!rolesModalState[role.id]"
                @click="onAttachRole(role.id)"
              >
                <Icon
                  :name="
                    rolesModalState[role.id] === 'attaching'
                      ? 'ph:circle-notch'
                      : 'ph:plus-bold'
                  "
                  :class="{
                    'animate-spin': rolesModalState[role.id] === 'attaching',
                  }"
                />
                <span>Attach</span>
              </button>
              <button
                v-else
                type="button"
                class="rm-action rm-action--detach"
                :disabled="!!rolesModalState[role.id]"
                @click="onDetachRole(role.id)"
              >
                <Icon
                  :name="
                    rolesModalState[role.id] === 'detaching'
                      ? 'ph:circle-notch'
                      : 'ph:minus-bold'
                  "
                  :class="{
                    'animate-spin': rolesModalState[role.id] === 'detaching',
                  }"
                />
                <span>Detach</span>
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="rm-empty">
          No roles defined yet. Create one in
          <NuxtLink to="/admin/roles" class="rm-empty__link">
            Admin → Roles</NuxtLink
          >.
        </p>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { formatSize } from '~/utils/format';
import Modal from '~/components/Modal.vue';
import RoleBadge from '~/components/RoleBadge.vue';

interface Role {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  priority: number;
  assignmentMode: 'manual' | 'auto';
  showAsBadge: boolean;
  canUploadWithoutModeration: boolean;
}

interface AttachedRole {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  priority: number;
  assignmentMode: 'manual' | 'auto';
  showAsBadge: boolean;
  assignedAt: string;
  assignedManually: boolean;
}

interface RegistryUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isModerator: boolean;
  isBanned: boolean;
  // List of every role currently attached to this user, ordered by
  // role.priority desc. Empty array = no roles. Drives the chips
  // shown in the Role column + the modal's "currently attached"
  // state.
  roles: AttachedRole[];
  // Raw IP — only sent to admin viewers. Moderators see `lastIpHash`
  // instead (a stable fingerprint, see `fingerprintIP` API-side).
  lastIp: string | null;
  lastIpHash: string | null;
  uploaded: number;
  downloaded: number;
  invitesRemaining: number;
  createdAt: string;
  lastSeen: string;
}

interface RegistryPayload {
  items: RegistryUser[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    total: number;
    banned: number;
    admins: number;
    moderators: number;
    activeLast24h: number;
    onlineNow: number;
  };
}

type StatusFilter = '' | 'staff' | 'admin' | 'mod' | 'banned' | 'ok';

const { user } = useUserSession();
const notifications = useNotificationStore();
const confirm = useConfirm();

// ── State ──────────────────────────────────────────────────────
const searchInput = ref('');
const debouncedSearch = ref('');
const filters = reactive({
  role: '',
  activity: '' as '' | 'online' | 'active' | 'idle' | 'never',
  status: '' as StatusFilter,
});
const sort = ref<
  'username' | 'createdAt' | 'lastSeen' | 'uploaded' | 'downloaded' | 'ratio'
>('createdAt');
const dir = ref<'asc' | 'desc'>('desc');
const page = ref(1);
const pageSize = ref(25);

// Track each ban/staff/role mutation so we can disable the button while
// it's in flight without re-fetching the whole table.
const actionPending = reactive<Record<string, boolean>>({});

// Debounce search → query
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedSearch.value = val.trim();
    page.value = 1;
  }, 250);
});

// Any filter change resets pagination
watch(
  () => [filters.role, filters.activity, filters.status],
  () => {
    page.value = 1;
  }
);

// ── Derived query string for the API call ──────────────────────
const apiQuery = computed(() => {
  const q: Record<string, string | number> = {
    page: page.value,
    pageSize: pageSize.value,
    sort: sort.value,
    dir: dir.value,
  };
  if (debouncedSearch.value) q.search = debouncedSearch.value;
  if (filters.role) q.role = filters.role;
  if (filters.activity) q.activity = filters.activity;
  // Status is a UX shortcut that maps onto the underlying boolean filters.
  switch (filters.status) {
    case 'staff':
      // Either admin or mod — we approximate via admin=true OR mod=true.
      // The backend doesn't take an OR shape, so we rely on the
      // server-side activity/role split for narrowing — for staff we
      // intentionally don't push admin/mod here and instead filter on
      // the result. (kept simple, see filterStaffClient).
      break;
    case 'admin':
      q.admin = 'true';
      break;
    case 'mod':
      q.mod = 'true';
      break;
    case 'banned':
      q.banned = 'true';
      break;
    case 'ok':
      q.banned = 'false';
      break;
  }
  return q;
});

// ── Data ───────────────────────────────────────────────────────
const {
  data: rawData,
  pending: loading,
  refresh: refreshData,
} = await useFetch<RegistryPayload>('/api/admin/users', {
  query: apiQuery,
  watch: [apiQuery],
  default: () => null as unknown as RegistryPayload,
});

// "Staff" is a client-side narrowing because the API doesn't have an OR
// — keeps the pagination accurate enough for the small staff set.
const data = computed<RegistryPayload | null>(() => {
  if (!rawData.value) return null;
  if (filters.status !== 'staff') return rawData.value;
  return {
    ...rawData.value,
    items: rawData.value.items.filter((u) => u.isAdmin || u.isModerator),
    // Don't try to fix `total` for staff — we'd be lying. Fall through to
    // the visible-count summary instead.
    total: rawData.value.items.filter((u) => u.isAdmin || u.isModerator)
      .length,
  };
});

const roles = ref<Role[]>([]);
onMounted(async () => {
  if (user.value?.isAdmin) {
    try {
      roles.value = (await $fetch('/api/admin/roles')) as Role[];
    } catch {
      // Roles are admin-only and may 403 for moderators; that's fine.
    }
  }
});

function refresh() {
  refreshData();
}

// ── Sort ───────────────────────────────────────────────────────
function toggleSort(key: string) {
  // Same column → flip direction. Different column → start desc (or asc
  // for username, which reads more naturally A→Z by default).
  if (sort.value === key) {
    dir.value = dir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sort.value = key as typeof sort.value;
    dir.value = key === 'username' ? 'asc' : 'desc';
  }
  page.value = 1;
}

const currentSort = computed(() => sort.value);

function ariaSort(key: string): 'ascending' | 'descending' | 'none' {
  if (sort.value !== key) return 'none';
  return dir.value === 'asc' ? 'ascending' : 'descending';
}
function sortIcon(key: string) {
  if (sort.value !== key) return 'ph:arrows-down-up';
  return dir.value === 'asc' ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold';
}

// ── Columns ────────────────────────────────────────────────────
interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}
const columns: Column[] = [
  { key: 'username', label: 'User', sortable: true },
  { key: 'role', label: 'Role' },
  { key: 'createdAt', label: 'Joined', sortable: true },
  { key: 'lastSeen', label: 'Last seen', sortable: true },
  { key: 'ratio', label: 'Ratio', sortable: true, align: 'right' },
  { key: 'volume', label: 'Up / Down', align: 'right' },
  { key: 'invites', label: 'Invites', align: 'center' },
];

// ── KPI strip ──────────────────────────────────────────────────
const kpis = computed(() => {
  const s = rawData.value?.stats ?? {
    total: 0,
    banned: 0,
    admins: 0,
    moderators: 0,
    activeLast24h: 0,
    onlineNow: 0,
  };
  return [
    {
      key: 'total',
      label: 'Population',
      value: s.total,
      tone: 'fg' as const,
      filter: null,
    },
    {
      key: 'online',
      label: 'Online now',
      value: s.onlineNow,
      sub: '≤ 5 min',
      tone: 'green' as const,
      dot: true,
      filter: 'online',
    },
    {
      key: 'active',
      label: 'Active 24h',
      value: s.activeLast24h,
      sub: '≤ 24 h',
      tone: 'aqua' as const,
      filter: 'active',
    },
    {
      key: 'staff',
      label: 'Staff',
      value: s.admins + s.moderators,
      sub: `${s.admins} admin · ${s.moderators} mod`,
      tone: 'gold' as const,
      filter: 'staff',
    },
    {
      key: 'banned',
      label: 'Banned',
      value: s.banned,
      sub: 'tracker access revoked',
      tone: 'red' as const,
      filter: 'banned',
    },
  ];
});

function isFilterActive(filter: string) {
  if (filter === 'online' || filter === 'active' || filter === 'idle' || filter === 'never') {
    return filters.activity === filter;
  }
  return filters.status === filter;
}

function toggleKpiFilter(filter: string) {
  if (filter === 'online' || filter === 'active' || filter === 'idle' || filter === 'never') {
    filters.activity = filters.activity === filter ? '' : (filter as typeof filters.activity);
    return;
  }
  filters.status =
    filters.status === filter ? '' : (filter as StatusFilter);
}

// ── Filter helpers ─────────────────────────────────────────────
const hasActiveFilters = computed(
  () =>
    debouncedSearch.value.length > 0 ||
    filters.role !== '' ||
    filters.activity !== '' ||
    filters.status !== ''
);
function resetFilters() {
  searchInput.value = '';
  debouncedSearch.value = '';
  filters.role = '';
  filters.activity = '';
  filters.status = '';
  page.value = 1;
}

// ── Pagination ─────────────────────────────────────────────────
const totalPages = computed(() =>
  data.value && data.value.total > 0
    ? Math.max(1, Math.ceil(data.value.total / pageSize.value))
    : 1
);
const rangeStart = computed(() =>
  data.value && data.value.total > 0
    ? (page.value - 1) * pageSize.value + 1
    : 0
);
const rangeEnd = computed(() =>
  data.value
    ? Math.min(page.value * pageSize.value, data.value.total)
    : 0
);
function goTo(p: number) {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
}

// Reset to page 1 when pageSize changes
watch(pageSize, () => {
  page.value = 1;
});

// ── Per-row formatting ─────────────────────────────────────────
function formatJoined(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  if (sameYear) return `${month} ${d.getDate()}`;
  return `${month} ${d.getDate()} '${String(d.getFullYear()).slice(2)}`;
}

function formatLastSeen(u: RegistryUser) {
  const seen = new Date(u.lastSeen).getTime();
  const created = new Date(u.createdAt).getTime();
  // We treat "lastSeen ≈ createdAt" as "never logged back in" — same
  // tolerance the API uses for the `never` activity bucket.
  if (Math.abs(seen - created) < 60_000) return 'never';
  const delta = Date.now() - seen;
  if (delta < 60_000) return 'just now';
  const min = Math.floor(delta / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

function lastSeenTone(u: RegistryUser):
  | 'online'
  | 'recent'
  | 'idle'
  | 'never' {
  const seen = new Date(u.lastSeen).getTime();
  const created = new Date(u.createdAt).getTime();
  if (Math.abs(seen - created) < 60_000) return 'never';
  const delta = Date.now() - seen;
  if (delta < 5 * 60_000) return 'online';
  if (delta < 24 * 3600_000) return 'recent';
  return 'idle';
}

function formatRatio(u: RegistryUser) {
  if (u.downloaded === 0) {
    return u.uploaded === 0 ? '—' : '∞';
  }
  return (u.uploaded / u.downloaded).toFixed(2);
}
function ratioTooltip(u: RegistryUser) {
  return `${formatSize(u.uploaded)} up / ${formatSize(u.downloaded)} down`;
}
function ratioTone(u: RegistryUser) {
  if (u.downloaded === 0) {
    return u.uploaded === 0 ? 'ratio--neutral' : 'ratio--great';
  }
  const r = u.uploaded / u.downloaded;
  if (r >= 1) return 'ratio--great';
  if (r >= 0.5) return 'ratio--ok';
  if (r > 0) return 'ratio--low';
  return 'ratio--zero';
}

// ── Avatar (initials with deterministic colour) ────────────────
function avatarStyle(u: RegistryUser) {
  // Use the highest-priority attached role's colour when present —
  // the API already orders by priority desc.
  const top = u.roles[0];
  if (top?.color) {
    return {
      background: `${top.color}1f`,
      color: top.color,
      borderColor: `${top.color}66`,
    };
  }
  // Hash the username into one of a handful of accent hues.
  let hash = 0;
  for (let i = 0; i < u.username.length; i++) {
    hash = (hash * 31 + u.username.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    background: `hsl(${hue} 45% 18%)`,
    color: `hsl(${hue} 70% 70%)`,
    borderColor: `hsl(${hue} 50% 32%)`,
  };
}

// ── Mutations ──────────────────────────────────────────────────
function patchUser(id: string, patch: Partial<RegistryUser>) {
  if (!rawData.value) return;
  const idx = rawData.value.items.findIndex((u) => u.id === id);
  if (idx < 0) return;
  rawData.value.items[idx] = {
    ...rawData.value.items[idx]!,
    ...patch,
  } as RegistryUser;
}

async function onToggleBan(u: RegistryUser) {
  const action = u.isBanned ? 'unban' : 'ban';
  const ok = await confirm({
    title: action === 'ban' ? 'Ban user' : 'Unban user',
    message:
      action === 'ban'
        ? `Ban ${u.username}? Their last known IP will be added to the IP blacklist and active sessions will be invalidated.`
        : `Restore ${u.username}'s tracker access?`,
    confirmText: action === 'ban' ? 'Ban' : 'Unban',
    destructive: action === 'ban',
  });
  if (!ok) return;
  const key = `${u.id}:ban`;
  actionPending[key] = true;
  try {
    await $fetch(`/api/admin/users/${u.id}/${action}`, {
      method: 'POST',
      body: action === 'ban' ? { reason: 'Banned by admin' } : {},
    });
    patchUser(u.id, { isBanned: !u.isBanned });
    if (rawData.value) {
      const s = rawData.value.stats;
      rawData.value.stats = {
        ...s,
        banned: action === 'ban' ? s.banned + 1 : Math.max(0, s.banned - 1),
      };
    }
    notifications.success(action === 'ban' ? 'User banned' : 'User unbanned');
  } catch (err: any) {
    notifications.error(err?.data?.message || `Failed to ${action} user`);
  } finally {
    actionPending[key] = false;
  }
}

async function onToggleStaff(u: RegistryUser, role: 'isAdmin' | 'isModerator') {
  const key = `${u.id}:${role === 'isAdmin' ? 'admin' : 'mod'}`;
  actionPending[key] = true;
  try {
    // The endpoint's body schema is strict — only the two boolean flags.
    // Spreading the whole RegistryUser used to trip a Zod
    // `unrecognized_keys` error that surfaced to the operator as a
    // wall of field names.
    const updated = await $fetch<RegistryUser>(
      `/api/admin/users/${u.id}/role`,
      {
        method: 'PUT',
        body: {
          isAdmin: role === 'isAdmin' ? !u.isAdmin : u.isAdmin,
          isModerator: role === 'isModerator' ? !u.isModerator : u.isModerator,
        },
      }
    );
    patchUser(u.id, updated);
    if (rawData.value) {
      const s = rawData.value.stats;
      const delta = updated[role] ? 1 : -1;
      rawData.value.stats = {
        ...s,
        admins: role === 'isAdmin' ? Math.max(0, s.admins + delta) : s.admins,
        moderators:
          role === 'isModerator'
            ? Math.max(0, s.moderators + delta)
            : s.moderators,
      };
    }
  } catch (err: any) {
    notifications.error(err?.data?.message || 'Failed to update user');
  } finally {
    actionPending[key] = false;
  }
}

// ── Multi-role modal ───────────────────────────────────────────
// `rolesModalUser` is the user currently being edited. While the
// modal is open we use `rolesModalState[roleId] = 'attached' |
// 'attaching' | 'detaching'` to render per-row spinners without
// blocking the rest of the table.
const rolesModalUser = ref<RegistryUser | null>(null);
const rolesModalOpen = computed({
  get: () => rolesModalUser.value !== null,
  set: (v: boolean) => {
    if (!v) rolesModalUser.value = null;
  },
});
const rolesModalState = reactive<Record<string, 'attaching' | 'detaching'>>({});

function openRolesModal(u: RegistryUser) {
  rolesModalUser.value = u;
  for (const k of Object.keys(rolesModalState)) delete rolesModalState[k];
}

function isAttached(u: RegistryUser, roleId: string) {
  return u.roles.some((r) => r.id === roleId);
}
function attachedManually(u: RegistryUser, roleId: string) {
  return u.roles.find((r) => r.id === roleId)?.assignedManually ?? false;
}

async function onAttachRole(roleId: string) {
  const u = rolesModalUser.value;
  if (!u) return;
  rolesModalState[roleId] = 'attaching';
  try {
    await $fetch(`/api/admin/users/${u.id}/roles`, {
      method: 'POST',
      body: { roleId },
    });
    // Update the in-memory row optimistically: if the role was
    // already attached (auto), bump it to manual; otherwise add it.
    const role = roles.value.find((r) => r.id === roleId);
    if (!role) return;
    const next = u.roles.filter((r) => r.id !== roleId);
    next.push({
      id: role.id,
      name: role.name,
      color: role.color,
      icon: role.icon ?? null,
      priority: role.priority ?? 0,
      assignmentMode: role.assignmentMode ?? 'manual',
      showAsBadge: role.showAsBadge ?? false,
      assignedAt: new Date().toISOString(),
      assignedManually: true,
    });
    next.sort((a, b) => b.priority - a.priority);
    patchUser(u.id, { roles: next });
    rolesModalUser.value = { ...u, roles: next };
    notifications.success(`Attached "${role.name}"`);
  } catch (err: any) {
    notifications.error(err?.data?.message || 'Failed to attach role');
  } finally {
    delete rolesModalState[roleId];
  }
}

async function onDetachRole(roleId: string) {
  const u = rolesModalUser.value;
  if (!u) return;
  rolesModalState[roleId] = 'detaching';
  try {
    await $fetch(`/api/admin/users/${u.id}/roles/${roleId}`, {
      method: 'DELETE',
    });
    const next = u.roles.filter((r) => r.id !== roleId);
    patchUser(u.id, { roles: next });
    rolesModalUser.value = { ...u, roles: next };
    const role = roles.value.find((r) => r.id === roleId);
    notifications.success(`Detached "${role?.name ?? 'role'}"`);
  } catch (err: any) {
    notifications.error(err?.data?.message || 'Failed to detach role');
  } finally {
    delete rolesModalState[roleId];
  }
}
</script>

<style scoped>
.user-registry {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 1480px;
  margin: 0 auto;
  padding: 0 0.25rem 4rem;
}

/* ─── Header ───────────────────────────────────────────────── */
.registry-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.registry-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0 0 0.4rem;
}
.registry-title {
  font-size: clamp(1.65rem, 3.4vw, 2.5rem);
  font-weight: 900;
  letter-spacing: -0.025em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  margin: 0;
  line-height: 1;
  display: inline-flex;
  align-items: baseline;
  gap: 0.6rem;
  font-variant-numeric: tabular-nums;
}
.registry-title-accent {
  font-weight: 400;
  color: rgb(var(--fg-muted));
  font-style: italic;
  letter-spacing: 0;
  font-size: 0.6em;
}
.registry-head-tools {
  display: flex;
  gap: 0.5rem;
}
.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  transition: all 0.15s;
}
.tool-btn:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.3);
}
.tool-btn:disabled {
  opacity: 0.6;
}

/* ─── KPI strip ────────────────────────────────────────────── */
.kpi-strip {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
}
@media (max-width: 960px) {
  .kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 540px) {
  .kpi-strip {
    grid-template-columns: 1fr;
  }
}
.kpi {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1rem 1.1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  transition: all 0.15s;
}
.kpi[role='button'] {
  cursor: pointer;
}
.kpi[role='button']:hover {
  border-color: rgb(var(--fg-default) / 0.35);
  transform: translateY(-1px);
}
.kpi--active {
  border-color: rgb(var(--fg-strong));
  background: rgb(var(--fg-strong) / 0.04);
}
.kpi-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.kpi-value {
  font-size: 1.85rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.kpi-sub {
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}
.kpi-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgb(var(--fg-muted));
}
.kpi-dot--green {
  background: #6cd161;
  box-shadow: 0 0 0 0 rgba(108, 209, 97, 0.6);
  animation: kpi-pulse 2s infinite;
}
@keyframes kpi-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(108, 209, 97, 0.55);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(108, 209, 97, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(108, 209, 97, 0);
  }
}
.kpi--green .kpi-value {
  color: #6cd161;
}
.kpi--aqua .kpi-value {
  color: #34d4d8;
}
.kpi--gold .kpi-value {
  color: #f5c518;
}
.kpi--red .kpi-value {
  color: rgb(var(--danger));
}
.kpi--fg .kpi-value {
  color: rgb(var(--fg-strong));
}

/* ─── Filters ──────────────────────────────────────────────── */
.filters {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}
.filter-search {
  position: relative;
}
.filter-search-icon {
  position: absolute;
  left: 0.95rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.05rem;
  color: rgb(var(--fg-muted));
  pointer-events: none;
}
.filter-search-input {
  width: 100%;
  padding: 0.7rem 0.95rem 0.7rem 2.6rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-strong));
  font-size: 0.9rem;
  letter-spacing: 0.01em;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.filter-search-input:focus {
  outline: none;
  border-color: rgb(var(--fg-default) / 0.3);
  background: rgb(var(--bg-base));
}
.filter-search-input::placeholder {
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}
.filter-search-clear {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 9999px;
  color: rgb(var(--fg-muted));
}
.filter-search-clear:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-elevated));
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}
.filter-select {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 12rem;
}
.filter-select span {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.filter-select-input {
  padding: 0.55rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.35rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.filter-select-input:focus {
  outline: none;
  border-color: rgb(var(--fg-default) / 0.3);
}
.filter-reset {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.85rem;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  border: 1px dashed rgb(var(--line-default));
  border-radius: 9999px;
  background: transparent;
  align-self: flex-end;
  transition: all 0.15s;
}
.filter-reset:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.4);
  border-style: solid;
}

/* ─── Table ────────────────────────────────────────────────── */
.table-wrap {
  position: relative;
  overflow-x: auto;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
}

.reg-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}

.th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  vertical-align: bottom;
  padding: 0.85rem 1rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-secondary));
  border-bottom: 1px solid rgb(var(--line-default));
  white-space: nowrap;
}
.th--right {
  text-align: right;
}
.th--center {
  text-align: center;
}
.th--sortable {
  cursor: pointer;
  user-select: none;
  display: table-cell;
}
.th--sortable span {
  display: inline-block;
  transition: color 0.15s;
}
.th--sortable .th-sort-icon {
  margin-left: 0.35rem;
  font-size: 0.85em;
  opacity: 0.4;
  transition: opacity 0.15s;
  vertical-align: -2px;
}
.th--sortable:hover span {
  color: rgb(var(--fg-strong));
}
.th--sortable:hover .th-sort-icon {
  opacity: 1;
}
.th--active {
  color: rgb(var(--fg-strong));
}
.th--active .th-sort-icon {
  opacity: 1;
  color: rgb(var(--fg-strong));
}

.row {
  border-bottom: 1px solid rgb(var(--line-default) / 0.6);
  transition: background 0.12s;
}
.row:last-child {
  border-bottom: 0;
}
.row:hover {
  background: rgb(var(--bg-elevated) / 0.5);
}
.row--banned {
  background: rgba(229, 62, 62, 0.04);
}
.row--banned:hover {
  background: rgba(229, 62, 62, 0.08);
}
.row--skeleton:hover {
  background: transparent;
}
.sk-bar {
  height: 0.65rem;
  background: linear-gradient(
    90deg,
    rgb(var(--bg-elevated)),
    rgb(var(--line-default)),
    rgb(var(--bg-elevated))
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite;
  border-radius: 9999px;
  margin: 0.25rem 0;
}
@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.cell {
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  vertical-align: middle;
  color: rgb(var(--fg-default));
}
.cell--right {
  text-align: right;
}
.cell--center {
  text-align: center;
}
.cell--mono {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
  color: rgb(var(--fg-default));
}
.cell-dash {
  color: rgb(var(--fg-muted));
  opacity: 0.5;
}

/* User cell */
.user-cell {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 14rem;
}
.avatar {
  flex-shrink: 0;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 0.45rem;
  border: 1px solid;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.user-cell-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.user-cell-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.01em;
  text-decoration: none;
}
.user-cell-name:hover {
  text-decoration: underline;
}
.user-cell-name--banned {
  text-decoration: line-through;
  color: rgb(var(--danger));
}
.user-cell-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
}
.user-uid {
  letter-spacing: 0.04em;
}
.user-ip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  opacity: 0.85;
}
.user-ip--hashed {
  /* Stable IP fingerprint shown to moderators — different visual
   * affordance from a raw IP so the moderator knows it's a hash
   * (cursor:help to surface the tooltip). */
  font-family: ui-monospace, SFMono-Regular, monospace;
  letter-spacing: 0.06em;
  cursor: help;
}

/* Role chip */
.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.role-chip--admin {
  border-color: rgba(229, 62, 62, 0.4);
  background: rgba(229, 62, 62, 0.08);
  color: #ff6b6b;
}
.role-chip--mod {
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.08);
  color: #34d4d8;
}
.role-chip--custom {
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
  color: #f5c518;
}

/* Last seen */
.last-seen {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  white-space: nowrap;
}
.last-seen.online {
  color: #6cd161;
  font-weight: 700;
}
.last-seen.recent {
  color: rgb(var(--fg-default));
}
.last-seen.idle {
  color: rgb(var(--fg-muted));
}
.last-seen.never {
  color: rgb(var(--fg-muted));
  opacity: 0.55;
  font-style: italic;
}
.online-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #6cd161;
  animation: kpi-pulse 2s infinite;
}

/* Ratio + bytes */
.ratio {
  display: inline-block;
  padding: 0.18rem 0.55rem;
  border-radius: 0.3rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 3.2rem;
  text-align: center;
}
.ratio--great {
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.08);
  color: #6cd161;
}
.ratio--ok {
  color: rgb(var(--fg-strong));
}
.ratio--low {
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
  color: #f5c518;
}
.ratio--zero {
  border-color: rgba(229, 62, 62, 0.4);
  background: rgba(229, 62, 62, 0.08);
  color: #ff6b6b;
}
.ratio--neutral {
  color: rgb(var(--fg-muted));
}
.bytes {
  color: rgb(var(--fg-default));
}
.bytes-divider {
  margin: 0 0.25rem;
  color: rgb(var(--fg-muted));
  opacity: 0.5;
}
.bytes-down {
  color: rgb(var(--fg-muted));
}

/* Invites */
.invites {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}

/* Row actions */
.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  justify-content: flex-end;
}
.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.4rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  transition: all 0.12s;
}
.row-action:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.3);
  color: rgb(var(--fg-strong));
}
.row-action:disabled {
  opacity: 0.6;
}
.row-action--danger-on {
  background: rgba(229, 62, 62, 0.12);
  border-color: rgba(229, 62, 62, 0.4);
  color: #ff6b6b;
}
.row-action--mod-on {
  background: rgba(52, 212, 216, 0.12);
  border-color: rgba(52, 212, 216, 0.4);
  color: #34d4d8;
}
.row-action--admin-on {
  background: rgba(245, 197, 24, 0.12);
  border-color: rgba(245, 197, 24, 0.4);
  color: #f5c518;
}
.row-role-select {
  margin-left: 0.4rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  max-width: 9rem;
}
.row-role-select:focus {
  outline: none;
  border-color: rgb(var(--fg-default) / 0.3);
}

/* Empty state */
.empty {
  padding: 3rem 1rem;
  text-align: center;
}
.empty-inner {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  color: rgb(var(--fg-muted));
}
.empty-icon {
  font-size: 2.25rem;
  opacity: 0.5;
}
.empty-headline {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: rgb(var(--fg-default));
  letter-spacing: 0.02em;
}
.empty-sub {
  margin: 0;
  font-size: 0.8rem;
}
.empty-link {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-underline-offset: 3px;
}
.empty-link:hover {
  text-decoration-thickness: 2px;
}

/* ─── Pager ────────────────────────────────────────────────── */
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}
.pager-summary {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.pager-summary-strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.pager-clear {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-underline-offset: 3px;
}
.pager-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.pager-size {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.pager-size-input {
  padding: 0.35rem 0.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
}
.pager-buttons {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.7rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transition: all 0.15s;
}
.pager-btn:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.3);
  color: rgb(var(--fg-strong));
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager-where {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  padding: 0 0.65rem;
  letter-spacing: 0.06em;
}
.pager-where strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}

/* ─── Role stack (per-row chips) ─────────────────────────────────── */
.role-stack {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  max-width: 22rem;
}
.row-action__count {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 9999px;
  background: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.row-action--has-roles {
  position: relative;
}

/* ─── Roles modal ────────────────────────────────────────────────── */
.rm-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.rm-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0;
}
.rm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.rm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  padding: 0.7rem 0.95rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.45rem;
  background: rgb(var(--bg-elevated));
  transition: border-color 0.15s, background 0.15s;
}
.rm-row--on {
  border-left: 3px solid #34d4d8;
  padding-left: calc(0.95rem - 2px);
}
.rm-row--manual {
  border-left-color: #f5c518;
}
.rm-row__id {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}
.rm-row__meta {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.rm-row__sep {
  opacity: 0.5;
}
.rm-row__mode {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.05rem 0.4rem;
  border-radius: 0.2rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  text-transform: uppercase;
  font-weight: 700;
  font-size: 9.5px;
}
.rm-row__mode--auto {
  color: #34d4d8;
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.08);
}
.rm-row__attached {
  text-transform: uppercase;
  font-weight: 700;
}
.rm-row--manual .rm-row__attached {
  color: #f5c518;
}
.rm-row__actions {
  display: flex;
  flex-shrink: 0;
}
.rm-action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
  transition: all 0.15s;
}
.rm-action:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.3);
  color: rgb(var(--fg-strong));
}
.rm-action--attach:hover:not(:disabled) {
  border-color: rgba(108, 209, 97, 0.5);
  color: #6cd161;
  background: rgba(108, 209, 97, 0.08);
}
.rm-action--detach:hover:not(:disabled) {
  border-color: rgba(229, 62, 62, 0.5);
  color: rgb(var(--danger));
  background: rgba(229, 62, 62, 0.08);
}
.rm-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rm-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: rgb(var(--fg-muted));
  font-size: 12px;
}
.rm-empty__link {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* =============================================================================
 * Mobile card list (< md) — replaces the 8-column table when there isn't
 * enough horizontal real-estate for it. Each card mirrors the same data:
 * identity row, role stack, key/value stats grid, then the action rail.
 * ============================================================================= */
.user-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.5rem;
}
.user-card {
  background-color: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  transition: border-color 160ms ease;
}
.user-card:focus-within,
.user-card:hover {
  border-color: rgb(var(--line-strong));
}
.user-card--banned {
  border-color: rgb(var(--danger) / 0.45);
  background-color: rgb(var(--danger) / 0.04);
}
.user-card--skeleton {
  min-height: 4rem;
  display: flex;
  align-items: center;
}
.user-card-empty {
  text-align: center;
  padding: 2.5rem 1.25rem;
  color: rgb(var(--fg-muted));
  font-size: 12px;
  background-color: rgb(var(--bg-surface));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
}
.user-card-empty .empty-icon {
  font-size: 1.75rem;
  color: rgb(var(--fg-faint));
  display: block;
  margin: 0 auto 0.5rem;
}
.user-card-empty .empty-headline {
  font-weight: 700;
  color: rgb(var(--fg-default));
  margin-bottom: 0.4rem;
  letter-spacing: -0.005em;
}
.user-card-empty .empty-link {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-underline-offset: 2px;
  background: none;
  border: 0;
  cursor: pointer;
  font: inherit;
  padding: 0;
}

.user-card-head {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.avatar--md {
  width: 2.75rem;
  height: 2.75rem;
  font-size: 0.9rem;
}
.user-card-id {
  flex: 1;
  min-width: 0;
}
.user-card-name {
  display: block;
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-card-name:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.user-card-meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin: 0.15rem 0 0;
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

/* Role stack inside a card lays roles out left-to-right with wrap so a
   user with many roles doesn't blow the card height up. */
.user-card-roles {
  flex-wrap: wrap;
  gap: 0.4rem;
}

.user-card-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem 1rem;
  margin: 0;
  padding: 0.65rem 0;
  border-top: 1px solid rgb(var(--line-default) / 0.7);
  border-bottom: 1px solid rgb(var(--line-default) / 0.7);
}
.user-card-stats > div {
  min-width: 0;
}
.user-card-stats dt {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  margin-bottom: 0.2rem;
}
.user-card-stats dd {
  margin: 0;
  font-size: 12.5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: rgb(var(--fg-default));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-card-bytes {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.user-card-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.user-card-actions .row-action {
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
}
</style>
