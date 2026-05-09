<template>
  <div class="roles-console">
    <!-- ── Eyebrow + headline ─────────────────────────────────────── -->
    <header class="rc-head">
      <div class="rc-head-text">
        <p class="rc-eyebrow">Permissions · Auto-assignment</p>
        <h2 class="rc-title">
          Roles
          <span class="rc-title-accent">{{ roles.length }}</span>
        </h2>
        <p class="rc-sub">
          Manual roles attach by hand from the user registry. Auto roles
          attach themselves whenever a user matches their rule set —
          <strong>"Certified"</strong> after fifteen approved uploads is
          the canonical example.
        </p>
      </div>
      <div class="rc-head-tools">
        <button
          type="button"
          class="rc-tool"
          :disabled="recomputing"
          :title="
            recomputing ? 'Recomputing…' : 'Re-run the engine for every user'
          "
          @click="recompute"
        >
          <Icon
            :name="recomputing ? 'ph:arrows-clockwise-bold' : 'ph:lightning-bold'"
            :class="{ 'animate-spin': recomputing }"
          />
          <span>Recompute</span>
        </button>
        <button
          type="button"
          class="rc-cta"
          @click="openCreate"
        >
          <Icon name="ph:plus-bold" />
          <span>New role</span>
        </button>
      </div>
    </header>

    <!-- ── Roles grid ─────────────────────────────────────────────── -->
    <div v-if="loading" class="rc-loading">
      <Icon name="ph:circle-notch" class="animate-spin text-text-muted" />
    </div>
    <div
      v-else-if="roles.length === 0"
      class="rc-empty"
    >
      <Icon name="ph:user-circle-gear" class="rc-empty__icon" />
      <p class="rc-empty__title">No roles yet</p>
      <p class="rc-empty__sub">
        Hit <strong>New role</strong> to define your first permission tier
        or auto-attached badge.
      </p>
    </div>
    <ul v-else class="role-list">
      <li
        v-for="role in roles"
        :key="role.id"
        class="role-card"
        :class="{
          'role-card--auto': role.assignmentMode === 'auto',
          'role-card--manual': role.assignmentMode === 'manual',
        }"
      >
        <header class="role-card__head">
          <div class="role-card__id">
            <span
              class="role-card__dot"
              :style="{ background: role.color }"
            />
            <div class="role-card__id-body">
              <h3 class="role-card__name">
                <Icon
                  v-if="role.icon"
                  :name="role.icon"
                  class="role-card__icon"
                  :style="{ color: role.color }"
                />
                {{ role.name }}
              </h3>
              <p class="role-card__meta">
                <span :class="
                  role.assignmentMode === 'auto'
                    ? 'role-card__mode role-card__mode--auto'
                    : 'role-card__mode'
                ">
                  <Icon
                    :name="
                      role.assignmentMode === 'auto'
                        ? 'ph:lightning-fill'
                        : 'ph:hand-pointing-fill'
                    "
                  />
                  {{ role.assignmentMode === 'auto' ? 'Auto' : 'Manual' }}
                </span>
                <span class="role-card__sep">·</span>
                <span class="role-card__priority">prio {{ role.priority }}</span>
                <span class="role-card__sep">·</span>
                <span
                  class="role-card__perm"
                  :class="
                    role.canUploadWithoutModeration
                      ? 'role-card__perm--privileged'
                      : ''
                  "
                >
                  <Icon
                    :name="
                      role.canUploadWithoutModeration
                        ? 'ph:rocket-launch-bold'
                        : 'ph:gauge-bold'
                    "
                  />
                  {{
                    role.canUploadWithoutModeration
                      ? 'Skip moderation'
                      : 'Moderated upload'
                  }}
                </span>
                <span
                  v-if="role.showAsBadge"
                  class="role-card__sep"
                  >·</span
                >
                <span
                  v-if="role.showAsBadge"
                  class="role-card__perm role-card__perm--badge"
                >
                  <Icon name="ph:eye-bold" />
                  Public badge
                </span>
              </p>
            </div>
          </div>
          <div class="role-card__actions">
            <button
              type="button"
              class="role-card__edit"
              title="Edit role"
              @click="openEdit(role)"
            >
              <Icon name="ph:pencil-bold" />
              <span>Edit</span>
            </button>
            <button
              type="button"
              class="role-card__del"
              title="Delete role"
              @click="onDelete(role)"
            >
              <Icon name="ph:trash-bold" />
            </button>
          </div>
        </header>

        <!-- Rule preview — only on auto roles, shows the AND/OR tree
             flat with each condition as a chip. -->
        <div
          v-if="role.assignmentMode === 'auto' && role.rules"
          class="role-card__rules"
        >
          <span class="role-card__rules-prefix">
            User must match
            <strong>{{ role.rules.combinator === 'or' ? 'any' : 'all' }}</strong>
            of:
          </span>
          <ul class="cond-strip">
            <li
              v-for="(cond, idx) in role.rules.conditions"
              :key="idx"
              class="cond-pill"
            >
              <span class="cond-pill__field">
                {{ FIELD_META[cond.field]?.label ?? cond.field }}
              </span>
              <span class="cond-pill__op">{{ COMPARATOR_LABEL[cond.comparator] }}</span>
              <span class="cond-pill__val">
                {{ formatConditionValue(cond) }}
              </span>
            </li>
            <li
              v-if="!role.rules.conditions || role.rules.conditions.length === 0"
              class="cond-pill cond-pill--warn"
            >
              <Icon name="ph:warning-circle-fill" />
              No conditions — engine never matches
            </li>
          </ul>
        </div>
        <div
          v-else-if="role.assignmentMode === 'manual'"
          class="role-card__rules role-card__rules--manual"
        >
          <Icon name="ph:hand-pointing-fill" class="text-text-muted" />
          <span>Attached only by an admin from the user registry.</span>
        </div>
      </li>
    </ul>

    <!-- ── Modal: create / edit ───────────────────────────────────── -->
    <Modal
      v-model="modalOpen"
      :title="editing.id ? 'Edit role' : 'New role'"
      icon="ph:user-circle-gear-bold"
      size="lg"
      :persistent="saving"
      bodyClass="!p-0"
    >
      <form class="role-form" @submit.prevent="submit">
        <!-- Identity row -->
        <section class="form-section">
          <header class="form-section__head">
            <span class="form-section__num">01</span>
            <h4 class="form-section__title">Identity</h4>
            <span class="form-section__rule" />
          </header>
          <div class="form-grid">
            <label class="form-field">
              <span class="form-label">Name</span>
              <input
                ref="nameRef"
                v-model="form.name"
                type="text"
                maxlength="50"
                class="input form-input"
                placeholder="e.g. Certified"
                :disabled="saving"
              />
            </label>
            <label class="form-field form-field--narrow">
              <span class="form-label">Color</span>
              <div class="color-row">
                <input
                  v-model="form.color"
                  type="color"
                  class="color-pick"
                  :disabled="saving"
                />
                <code class="color-hex">{{ form.color }}</code>
              </div>
            </label>
            <label class="form-field form-field--narrow">
              <span class="form-label">Priority</span>
              <input
                v-model.number="form.priority"
                type="number"
                min="0"
                max="1000"
                class="input form-input"
                :disabled="saving"
              />
              <span class="form-hint">Higher wins between matching auto roles.</span>
            </label>
            <label class="form-field form-field--full">
              <span class="form-label">Icon (optional)</span>
              <input
                v-model="form.icon"
                type="text"
                maxlength="64"
                class="input form-input"
                placeholder="ph:shield-check"
                :disabled="saving"
              />
              <span class="form-hint">
                Phosphor icon name. Leave empty for a coloured dot.
              </span>
            </label>
          </div>
        </section>

        <!-- Assignment + permissions -->
        <section class="form-section">
          <header class="form-section__head">
            <span class="form-section__num">02</span>
            <h4 class="form-section__title">Assignment</h4>
            <span class="form-section__rule" />
          </header>
          <div class="mode-grid" role="radiogroup">
            <label
              class="mode-card"
              :class="{ 'mode-card--on': form.assignmentMode === 'manual' }"
            >
              <input
                type="radio"
                :checked="form.assignmentMode === 'manual'"
                :disabled="saving"
                @change="form.assignmentMode = 'manual'"
              />
              <span class="mode-card__head">
                <Icon name="ph:hand-pointing-bold" />
                Manual
              </span>
              <span class="mode-card__sub">
                Admin attaches it from the user registry. The auto engine
                never touches manual roles.
              </span>
            </label>
            <label
              class="mode-card"
              :class="{ 'mode-card--on': form.assignmentMode === 'auto' }"
            >
              <input
                type="radio"
                :checked="form.assignmentMode === 'auto'"
                :disabled="saving"
                @change="form.assignmentMode = 'auto'"
              />
              <span class="mode-card__head">
                <Icon name="ph:lightning-bold" />
                Auto
              </span>
              <span class="mode-card__sub">
                Granted whenever a user matches the rules below.
                Highest-priority match wins.
              </span>
            </label>
          </div>

          <div class="toggle-grid">
            <label
              class="toggle-row"
              :class="{ 'toggle-row--on': form.showAsBadge }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.showAsBadge"
                class="toggle"
                :class="{ 'toggle--on': form.showAsBadge }"
                :disabled="saving"
                @click="form.showAsBadge = !form.showAsBadge"
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">Show as a public badge</p>
                <p class="toggle-sub">
                  Users with this role get a coloured chip on their
                  profile alongside any Admin/Mod indicator.
                </p>
              </div>
            </label>
            <label
              class="toggle-row"
              :class="{
                'toggle-row--on': form.canUploadWithoutModeration,
                'toggle-row--privileged': form.canUploadWithoutModeration,
              }"
            >
              <button
                type="button"
                role="switch"
                :aria-checked="form.canUploadWithoutModeration"
                class="toggle"
                :class="{ 'toggle--on': form.canUploadWithoutModeration }"
                :disabled="saving"
                @click="
                  form.canUploadWithoutModeration =
                    !form.canUploadWithoutModeration
                "
              >
                <span class="toggle-knob" />
              </button>
              <div class="toggle-body">
                <p class="toggle-title">Skip moderation</p>
                <p class="toggle-sub">
                  Uploads from members with this role go straight to the
                  index without passing through the pending queue.
                </p>
              </div>
            </label>
          </div>
        </section>

        <!-- Rule builder (auto roles only) -->
        <section
          v-if="form.assignmentMode === 'auto'"
          class="form-section form-section--rules"
        >
          <header class="form-section__head">
            <span class="form-section__num">03</span>
            <h4 class="form-section__title">Rules</h4>
            <span class="form-section__rule" />
          </header>

          <p class="form-help">
            Combine the conditions below — pick
            <strong>all</strong> if every must hold,
            <strong>any</strong> if just one is enough.
          </p>

          <div class="combinator-row" role="radiogroup">
            <label
              class="combinator-pill"
              :class="{
                'combinator-pill--on': form.rules.combinator === 'and',
              }"
            >
              <input
                type="radio"
                :checked="form.rules.combinator === 'and'"
                :disabled="saving"
                @change="form.rules.combinator = 'and'"
              />
              <Icon name="ph:plus-bold" />
              All conditions (AND)
            </label>
            <label
              class="combinator-pill"
              :class="{ 'combinator-pill--on': form.rules.combinator === 'or' }"
            >
              <input
                type="radio"
                :checked="form.rules.combinator === 'or'"
                :disabled="saving"
                @change="form.rules.combinator = 'or'"
              />
              <Icon name="ph:divide-bold" />
              Any condition (OR)
            </label>
          </div>

          <ul class="cond-list">
            <li
              v-for="(cond, idx) in form.rules.conditions"
              :key="idx"
              class="cond-row"
            >
              <span class="cond-row__num">#{{ idx + 1 }}</span>
              <select
                v-model="cond.field"
                class="input cond-input cond-input--field"
                :disabled="saving"
              >
                <option
                  v-for="f in RULE_FIELDS"
                  :key="f"
                  :value="f"
                >
                  {{ FIELD_META[f].label }}
                </option>
              </select>
              <select
                v-model="cond.comparator"
                class="input cond-input cond-input--op"
                :disabled="saving"
              >
                <option
                  v-for="c in RULE_COMPARATORS"
                  :key="c"
                  :value="c"
                >
                  {{ COMPARATOR_LABEL[c] }}
                </option>
              </select>
              <input
                v-model.number="cond.value"
                type="number"
                step="any"
                class="input cond-input cond-input--val"
                :disabled="saving"
              />
              <span class="cond-row__unit">
                {{ FIELD_META[cond.field]?.unit ?? '' }}
              </span>
              <button
                type="button"
                class="cond-row__del"
                title="Remove condition"
                :disabled="saving"
                @click="removeCondition(idx)"
              >
                <Icon name="ph:x-bold" />
              </button>
            </li>
          </ul>
          <p
            v-if="form.rules.conditions.length === 0"
            class="cond-empty"
          >
            No conditions yet — add one to enable matching.
          </p>
          <button
            type="button"
            class="cond-add"
            :disabled="
              saving || form.rules.conditions.length >= 20
            "
            @click="addCondition"
          >
            <Icon name="ph:plus-bold" />
            Add condition
          </button>
        </section>

        <p v-if="formError" class="form-error">
          <Icon name="ph:warning-circle-fill" />
          {{ formError }}
        </p>
      </form>

      <template #footer>
        <button
          type="button"
          class="btn btn-ghost !px-4 !py-2 text-xs font-bold uppercase tracking-wider"
          :disabled="saving"
          @click="modalOpen = false"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary !px-4 !py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          :disabled="!canSubmit"
          @click="submit"
        >
          <Icon
            :name="saving ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
            :class="{ 'animate-spin': saving }"
          />
          <span>{{ editing.id ? 'Save changes' : 'Create role' }}</span>
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import Modal from '~/components/Modal.vue';

type RuleField =
  | 'approvedUploads'
  | 'totalUploads'
  | 'ratio'
  | 'uploadedBytes'
  | 'downloadedBytes'
  | 'accountAgeDays'
  | 'hnrCount'
  | 'completedSeeds';
type RuleComparator = 'gte' | 'gt' | 'lte' | 'lt' | 'eq';

interface RuleCondition {
  field: RuleField;
  comparator: RuleComparator;
  value: number;
}
interface RuleSet {
  combinator: 'and' | 'or';
  conditions: RuleCondition[];
}

interface Role {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  showAsBadge: boolean;
  priority: number;
  assignmentMode: 'manual' | 'auto';
  rules: RuleSet | null;
  canUploadWithoutModeration: boolean;
  createdAt: string;
}

const RULE_FIELDS: ReadonlyArray<RuleField> = [
  'approvedUploads',
  'totalUploads',
  'accountAgeDays',
  'ratio',
  'uploadedBytes',
  'downloadedBytes',
  'hnrCount',
  'completedSeeds',
];
const RULE_COMPARATORS: ReadonlyArray<RuleComparator> = [
  'gte',
  'gt',
  'lte',
  'lt',
  'eq',
];

const COMPARATOR_LABEL: Record<RuleComparator, string> = {
  gte: '≥',
  gt: '>',
  lte: '≤',
  lt: '<',
  eq: '=',
};

const FIELD_META: Record<
  RuleField,
  { label: string; unit: string; format?: 'bytes' | 'days' | 'ratio' }
> = {
  approvedUploads: { label: 'Approved uploads', unit: '' },
  totalUploads: { label: 'Total uploads', unit: '' },
  accountAgeDays: { label: 'Account age', unit: 'days', format: 'days' },
  ratio: { label: 'Ratio', unit: '', format: 'ratio' },
  uploadedBytes: { label: 'Uploaded', unit: 'bytes', format: 'bytes' },
  downloadedBytes: { label: 'Downloaded', unit: 'bytes', format: 'bytes' },
  hnrCount: { label: 'Active H&R', unit: '' },
  completedSeeds: { label: 'Completed seeds', unit: '' },
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatConditionValue(cond: RuleCondition): string {
  const meta = FIELD_META[cond.field];
  if (meta?.format === 'bytes') return formatBytes(cond.value);
  if (meta?.format === 'ratio') return cond.value.toFixed(2);
  if (meta?.format === 'days') return `${cond.value}d`;
  return String(cond.value);
}

const notifications = useNotificationStore();
const confirm = useConfirm();

const roles = ref<Role[]>([]);
const loading = ref(true);

async function loadRoles() {
  loading.value = true;
  try {
    roles.value = (await $fetch('/api/admin/roles')) as Role[];
  } catch (err) {
    console.error('[Roles] load failed:', err);
  } finally {
    loading.value = false;
  }
}
onMounted(() => loadRoles());

// ── Modal state ────────────────────────────────────────────────────
interface Editing {
  id: string | null;
}
interface FormState {
  name: string;
  color: string;
  icon: string;
  showAsBadge: boolean;
  priority: number;
  assignmentMode: 'manual' | 'auto';
  rules: RuleSet;
  canUploadWithoutModeration: boolean;
}

const modalOpen = ref(false);
const editing = reactive<Editing>({ id: null });
const form = reactive<FormState>(blankForm());
const saving = ref(false);
const formError = ref<string | null>(null);
const nameRef = ref<HTMLInputElement | null>(null);

function blankForm(): FormState {
  return {
    name: '',
    color: '#6b7280',
    icon: '',
    showAsBadge: false,
    priority: 100,
    assignmentMode: 'manual',
    rules: { combinator: 'and', conditions: [] },
    canUploadWithoutModeration: false,
  };
}

function openCreate() {
  editing.id = null;
  Object.assign(form, blankForm());
  formError.value = null;
  modalOpen.value = true;
  nextTick(() => nameRef.value?.focus());
}

function openEdit(role: Role) {
  editing.id = role.id;
  Object.assign(form, blankForm());
  form.name = role.name;
  form.color = role.color || '#6b7280';
  form.icon = role.icon ?? '';
  form.showAsBadge = role.showAsBadge;
  form.priority = role.priority;
  form.assignmentMode = role.assignmentMode;
  form.canUploadWithoutModeration = role.canUploadWithoutModeration;
  form.rules = role.rules
    ? {
        combinator: role.rules.combinator ?? 'and',
        conditions: role.rules.conditions.map((c) => ({ ...c })),
      }
    : { combinator: 'and', conditions: [] };
  formError.value = null;
  modalOpen.value = true;
  nextTick(() => nameRef.value?.focus());
}

function addCondition() {
  if (form.rules.conditions.length >= 20) return;
  form.rules.conditions.push({
    field: 'approvedUploads',
    comparator: 'gte',
    value: 15,
  });
}
function removeCondition(idx: number) {
  form.rules.conditions.splice(idx, 1);
}

const canSubmit = computed(
  () => form.name.trim().length > 0 && !saving.value
);

async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      name: form.name.trim(),
      color: form.color,
      icon: form.icon.trim() || null,
      showAsBadge: form.showAsBadge,
      priority: form.priority,
      assignmentMode: form.assignmentMode,
      rules:
        form.assignmentMode === 'auto'
          ? {
              combinator: form.rules.combinator,
              conditions: form.rules.conditions.map((c) => ({
                field: c.field,
                comparator: c.comparator,
                value: Number(c.value),
              })),
            }
          : null,
      canUploadWithoutModeration: form.canUploadWithoutModeration,
    };

    if (editing.id) {
      await $fetch(`/api/admin/roles/${editing.id}`, {
        method: 'PUT',
        body: payload,
      });
      notifications.success('Role updated');
    } else {
      await $fetch('/api/admin/roles', {
        method: 'POST',
        body: payload,
      });
      notifications.success('Role created');
    }
    modalOpen.value = false;
    await loadRoles();
  } catch (err: any) {
    formError.value =
      err?.data?.message || err?.message || 'Failed to save role';
  } finally {
    saving.value = false;
  }
}

async function onDelete(role: Role) {
  const ok = await confirm({
    title: 'Delete role',
    message: `Permanently remove the role “${role.name}”? Users currently assigned to it will lose its permissions.`,
    confirmText: 'Delete role',
    destructive: true,
  });
  if (!ok) return;
  try {
    await $fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
    notifications.success(`Role “${role.name}” deleted`);
    await loadRoles();
  } catch (err: any) {
    notifications.error(err?.data?.message || 'Failed to delete role');
  }
}

const recomputing = ref(false);
async function recompute() {
  recomputing.value = true;
  try {
    const result = (await $fetch('/api/admin/roles/recompute', {
      method: 'POST',
    })) as { changed: number; considered: number; skipped: number };
    notifications.success(
      `Engine swept ${result.considered} user(s) — ${result.changed} updated, ${result.skipped} manual override(s)`
    );
    await loadRoles();
  } catch (err: any) {
    notifications.error(err?.data?.message || 'Recompute failed');
  } finally {
    recomputing.value = false;
  }
}
</script>

<style scoped>
/* ─── Container + header ───────────────────────────────────────────── */
.roles-console {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 0.25rem 4rem;
}
.rc-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.25rem;
  flex-wrap: wrap;
}
.rc-head-text {
  flex: 1;
  min-width: 0;
}
.rc-eyebrow {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0 0 0.4rem;
}
.rc-title {
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
.rc-title-accent {
  font-weight: 400;
  color: #f5c518;
  font-style: italic;
  letter-spacing: 0;
  font-size: 0.6em;
}
.rc-sub {
  margin: 0.5rem 0 0;
  font-size: 12.5px;
  color: rgb(var(--fg-muted));
  max-width: 64ch;
  line-height: 1.5;
}
.rc-head-tools {
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
}
.rc-tool,
.rc-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1.05rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  transition: border-color 0.15s, color 0.15s;
}
.rc-tool:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.35);
  color: rgb(var(--fg-strong));
}
.rc-cta {
  background: rgb(var(--fg-strong));
  /* `--bg-primary` is a Tailwind alias, not a raw CSS variable —
     using it here resolves to `invalid` and falls back to the
     inherited light text, painting a white-on-white button. The raw
     equivalent is `--bg-base`. */
  color: rgb(var(--bg-base));
  border-color: rgb(var(--fg-strong));
}
.rc-cta:hover {
  filter: brightness(1.05);
}
.rc-tool:disabled {
  opacity: 0.6;
}

/* ─── Empty + loading states ───────────────────────────────────────── */
.rc-loading {
  display: flex;
  justify-content: center;
  padding: 4rem 0;
  font-size: 1.4rem;
}
.rc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 4rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-secondary));
  color: rgb(var(--fg-muted));
  text-align: center;
}
.rc-empty__icon {
  font-size: 2.5rem;
  opacity: 0.6;
}
.rc-empty__title {
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.rc-empty__sub {
  margin: 0;
  font-size: 12px;
  max-width: 36rem;
}

/* ─── Role list ────────────────────────────────────────────────────── */
.role-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 1rem;
}
.role-card {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.1rem 1.2rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.55rem;
  background: rgb(var(--bg-secondary));
  position: relative;
  overflow: hidden;
}
.role-card--auto {
  border-left: 3px solid #34d4d8;
  padding-left: calc(1.2rem - 2px);
}
.role-card--manual {
  border-left: 3px solid rgb(var(--line-default));
  padding-left: calc(1.2rem - 2px);
}
.role-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.role-card__id {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  min-width: 0;
}
.role-card__dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 9999px;
  margin-top: 0.5rem;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgb(var(--bg-secondary)),
    0 0 6px currentColor;
}
.role-card__id-body {
  min-width: 0;
}
.role-card__name {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  color: rgb(var(--fg-strong));
  letter-spacing: 0;
}
.role-card__icon {
  font-size: 1.05rem;
}
.role-card__meta {
  margin: 0.2rem 0 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
}
.role-card__sep {
  opacity: 0.4;
}
.role-card__mode {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.05rem 0.45rem;
  border-radius: 0.25rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  text-transform: uppercase;
  font-weight: 700;
}
.role-card__mode--auto {
  color: #34d4d8;
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.08);
}
.role-card__priority {
  text-transform: uppercase;
  font-weight: 700;
}
.role-card__perm {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  text-transform: uppercase;
  font-weight: 700;
}
.role-card__perm--privileged {
  color: #6cd161;
}
.role-card__perm--badge {
  color: #f5c518;
}
.role-card__actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}
.role-card__edit,
.role-card__del {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.65rem;
  border-radius: 0.3rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
  transition: all 0.15s;
}
.role-card__edit:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.35);
}
.role-card__del:hover {
  color: rgb(var(--danger));
  border-color: rgba(229, 62, 62, 0.45);
  background: rgba(229, 62, 62, 0.08);
}

/* ─── Per-card rules preview ──────────────────────────────────────── */
.role-card__rules {
  border-top: 1px solid rgb(var(--line-default) / 0.7);
  padding-top: 0.75rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.55rem;
}
.role-card__rules--manual {
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.role-card__rules-prefix {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.role-card__rules-prefix strong {
  color: rgb(var(--fg-strong));
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 800;
}
.cond-strip {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.cond-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.18rem 0.55rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-default));
}
.cond-pill__field {
  font-weight: 700;
}
.cond-pill__op {
  font-size: 11.5px;
  font-weight: 900;
  color: #f5c518;
}
.cond-pill__val {
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cond-pill--warn {
  border-color: rgba(229, 62, 62, 0.5);
  background: rgba(229, 62, 62, 0.06);
  color: rgb(var(--danger));
}

/* ─── Modal form ──────────────────────────────────────────────────── */
.role-form {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 12rem);
  overflow-y: auto;
}
.form-section {
  padding: 1.25rem 1.4rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.form-section--rules {
  background: rgb(var(--bg-elevated) / 0.55);
}
.form-section:last-of-type {
  border-bottom: 0;
}
.form-section__head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 1rem;
}
.form-section__num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--fg-default));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  padding: 0.05rem 0.5rem;
  line-height: 1;
}
.form-section__title {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.form-section__rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    to right,
    rgb(var(--line-default)),
    rgb(var(--line-default) / 0)
  );
}
.form-help {
  margin: 0 0 0.85rem;
  font-size: 12px;
  color: rgb(var(--fg-muted));
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 10rem 10rem;
  gap: 0.85rem;
}
@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.form-field--narrow {
  width: 100%;
}
.form-field--full {
  grid-column: 1 / -1;
}
.form-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.form-input {
  width: 100%;
  padding: 0.6rem 0.85rem;
  font-size: 0.85rem;
}
.form-hint {
  font-size: 11px;
  color: rgb(var(--fg-muted));
  margin-top: 0.15rem;
}
.form-error {
  margin: 0;
  padding: 0.7rem 1.4rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 12px;
  color: rgb(var(--danger));
  background: rgba(229, 62, 62, 0.06);
  border-top: 1px solid rgba(229, 62, 62, 0.2);
}

.color-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.color-pick {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 0.4rem;
  border: 1px solid rgb(var(--line-default));
  background: transparent;
  cursor: pointer;
}
.color-hex {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
}

/* ─── Mode picker ─────────────────────────────────────────────────── */
.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}
@media (max-width: 540px) {
  .mode-grid {
    grid-template-columns: 1fr;
  }
}
.mode-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.45rem;
  background: rgb(var(--bg-elevated));
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.mode-card:hover {
  border-color: rgb(var(--fg-default) / 0.25);
}
.mode-card--on {
  background: rgb(var(--bg-tertiary));
  box-shadow: inset 3px 0 0 #34d4d8;
}
.mode-card input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.mode-card__head {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.mode-card__sub {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}

/* ─── Permission toggles in the modal ─────────────────────────────── */
.toggle-grid {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.85rem;
}
.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-elevated));
  cursor: pointer;
}
.toggle-row--on {
  border-left: 3px solid #f5c518;
  padding-left: calc(1rem - 2px);
}
.toggle-row--privileged.toggle-row--on {
  border-left-color: #6cd161;
}
.toggle-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.toggle-title {
  font-size: 12.5px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
}
.toggle-sub {
  font-size: 11px;
  color: rgb(var(--fg-muted));
  margin: 0;
  line-height: 1.4;
}
.toggle {
  position: relative;
  flex-shrink: 0;
  width: 2.6rem;
  height: 1.5rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-tertiary));
  cursor: pointer;
}
.toggle--on {
  background: #f5c518;
  border-color: #f5c518;
}
.toggle-row--privileged .toggle--on {
  background: #6cd161;
  border-color: #6cd161;
}
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 9999px;
  background: rgb(var(--bg-secondary));
  transition: transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
.toggle--on .toggle-knob {
  transform: translateX(1.05rem);
  background: #fff;
}

/* ─── Rule combinator + condition rows ────────────────────────────── */
.combinator-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.combinator-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-default));
  cursor: pointer;
}
.combinator-pill input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.combinator-pill--on {
  background: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
}
.cond-list {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.cond-row {
  display: grid;
  grid-template-columns: 2.5rem 1fr 4.5rem 6rem auto auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.4rem;
  background: rgb(var(--bg-secondary));
}
@media (max-width: 720px) {
  .cond-row {
    grid-template-columns: auto 1fr 1fr;
    grid-auto-flow: row;
  }
}
.cond-row__num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
}
.cond-input {
  padding: 0.45rem 0.65rem !important;
  font-size: 12px !important;
}
.cond-input--field {
  text-transform: capitalize;
}
.cond-input--op {
  text-align: center;
  font-weight: 800;
}
.cond-input--val {
  font-variant-numeric: tabular-nums;
}
.cond-row__unit {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.cond-row__del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 0.3rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  cursor: pointer;
}
.cond-row__del:hover {
  color: rgb(var(--danger));
  border-color: rgba(229, 62, 62, 0.45);
}
.cond-empty {
  margin: 0 0 0.75rem;
  font-size: 12px;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.cond-add {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem;
  border-radius: 9999px;
  border: 1px dashed rgb(var(--line-default));
  background: transparent;
  color: rgb(var(--fg-muted));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
}
.cond-add:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.35);
}
.cond-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
