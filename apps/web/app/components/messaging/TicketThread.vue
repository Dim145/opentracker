<template>
  <!--
    One ticket, read as a transcript.

    The same component on both sides, with `staff` gating the controls
    rather than a second copy of the layout. A ticket is one thread and it
    has to read the same way to both parties — a member who is told "we
    closed this as not actionable" should be looking at the same page the
    moderator was.
  -->
  <div v-if="ticket" class="tk">
    <header class="tk-head">
      <div class="tk-head-top">
        <p class="tk-status" :class="`tk-status--${state}`">
          <Icon :name="ticketStateIcon(state)" />
          {{ stateLabel }}
        </p>

        <!--
          The one thing the member can do to their own ticket, behind the
          same overflow control the conversations use. Not a button in the
          bar: ending a thread you opened is a rare act, and a rare act
          sitting next to "Répondre" is one people hit by accident.

          `canClose` comes from the server, which is also what enforces it
          — the alternative is this template re-deriving "am I the opener
          and is it still open" and drifting out of step with the route.
        -->
        <div v-if="canClose" ref="menuRef" class="tk-menu">
          <button
            type="button"
            class="tk-menu-btn"
            :aria-label="$t('tickets.menuLabel')"
            :title="$t('tickets.menuLabel')"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click.stop="menuOpen = !menuOpen"
          >
            <Icon name="ph:dots-three-vertical-bold" />
          </button>

          <div v-if="menuOpen" class="tk-menu-pop" role="menu">
            <button
              type="button"
              class="tk-menu-item"
              role="menuitem"
              @click="menuOpen = false; withdrawing = true"
            >
              <Icon name="ph:check-circle" />
              {{ $t('tickets.withdraw') }}
            </button>
          </div>
        </div>
      </div>

      <p class="tk-facts">
        <span>{{ $t('tickets.openedBy', { name: ticket.openedByName ?? $t('messaging.deletedMember') }) }}</span>
        <span class="tk-sep" aria-hidden="true">·</span>
        <span>{{ $t(`tickets.categories.${ticket.category}`) }}</span>
        <template v-if="ticket.assignedToName">
          <span class="tk-sep" aria-hidden="true">·</span>
          <span>{{ $t('tickets.takenBy', { name: ticket.assignedToName }) }}</span>
        </template>
      </p>
    </header>

    <!-- The closure, above the thread rather than under it: it is the
         outcome, and an outcome at the bottom of a long transcript is one
         somebody has to hunt for. -->
    <div v-if="isClosed" class="tk-closed">
      <p class="tk-closed-title">
        <Icon name="ph:lock-simple" />
        {{ closureLine }}
      </p>
      <p v-if="ticket.closingNote" class="tk-closed-note">{{ ticket.closingNote }}</p>
    </div>

    <ol class="tk-thread">
      <li
        v-for="m in messages"
        :key="m.id"
        class="tk-line"
        :class="m.fromStaff ? 'tk-line--staff' : 'tk-line--member'"
      >
        <p class="tk-author">
          <span class="tk-name" :class="{ 'tk-name--gone': !m.authorName }">{{ m.authorName ?? $t('messaging.deletedMember') }}</span>
          <span v-if="m.fromStaff" class="tk-badge">{{ $t('tickets.staff') }}</span>
          <time class="tk-time" :datetime="m.createdAt">{{ stamp(m.createdAt) }}</time>
        </p>
        <p class="tk-body">{{ m.body }}</p>
      </li>
    </ol>

    <p v-if="error" class="tk-error">{{ error }}</p>

    <form v-if="!isClosed" class="tk-reply" @submit.prevent="send">
      <textarea
        v-model="draft"
        rows="3"
        class="tk-input"
        :placeholder="$t('tickets.replyPlaceholder')"
        :aria-label="$t('tickets.replyPlaceholder')"
      />
      <div class="tk-actions">
        <button type="submit" class="btn btn-sm btn-primary" :disabled="busy || !draft.trim()">
          {{ $t('tickets.reply') }}
        </button>

        <template v-if="staff">
          <span class="tk-spacer" />
          <button
            v-if="!ticket.assignedToId"
            type="button"
            class="btn btn-sm"
            :disabled="busy"
            @click="assign(true)"
          >
            {{ $t('mod.tickets.take') }}
          </button>
          <button
            v-else
            type="button"
            class="btn btn-sm"
            :disabled="busy"
            @click="assign(false)"
          >
            {{ $t('mod.tickets.release') }}
          </button>
          <button type="button" class="btn btn-sm" :disabled="busy" @click="closing = 'resolved'">
            {{ $t('mod.tickets.resolve') }}
          </button>
          <button
            type="button"
            class="btn btn-sm tk-btn-danger"
            :disabled="busy"
            @click="closing = 'rejected'"
          >
            {{ $t('mod.tickets.reject') }}
          </button>
        </template>
      </div>
    </form>

    <!-- Reopening is staff-only and deliberately not offered to the member:
         letting them lift a closure would make closing a suggestion. -->
    <div v-else-if="staff" class="tk-actions">
      <button type="button" class="btn btn-sm" :disabled="busy" @click="reopen">
        {{ $t('mod.tickets.reopen') }}
      </button>
    </div>

    <!-- A closure asks for its reason. One with none reads as a shrug. -->
    <Modal
      v-if="staff"
      :model-value="!!closing"
      :title="closing === 'rejected' ? $t('mod.tickets.reject') : $t('mod.tickets.resolve')"
      @update:model-value="(v: boolean) => { if (!v) closing = null; }"
    >
      <div class="flex flex-col gap-3">
        <p class="tk-hint">{{ $t('mod.tickets.closeHint') }}</p>
        <textarea
          v-model="note"
          rows="3"
          class="tk-input"
          :placeholder="$t('mod.tickets.notePlaceholder')"
          :aria-label="$t('mod.tickets.notePlaceholder')"
        />
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-sm" @click="closing = null">
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="closing === 'rejected' ? 'tk-btn-danger' : 'btn-primary'"
            :disabled="busy"
            @click="close"
          >
            {{ closing === 'rejected' ? $t('mod.tickets.reject') : $t('mod.tickets.resolve') }}
          </button>
        </div>
      </div>
    </Modal>

    <!-- Asked, not assumed. The member cannot undo this on their own —
         only the staff can reopen — so the sentence says exactly that
         rather than a generic "are you sure". -->
    <Modal
      :model-value="withdrawing"
      :title="$t('tickets.withdraw')"
      @update:model-value="(v: boolean) => { if (!v) withdrawing = false; }"
    >
      <div class="tk-close-form">
        <p class="tk-close-hint">{{ $t('tickets.withdrawHint') }}</p>
        <p v-if="error" class="tk-error">{{ error }}</p>
        <div class="tk-close-actions">
          <button type="button" class="btn btn-sm" @click="withdrawing = false">
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            :disabled="busy"
            @click="withdraw"
          >
            {{ $t('tickets.withdraw') }}
          </button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
interface TicketRow {
  id: string;
  number: number;
  subject: string;
  category: string;
  status: string;
  closureReason: string | null;
  openedById: string | null;
  openedByName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  closedByName: string | null;
  closingNote: string | null;
  createdAt: string;
  lastMessageAt: string;
}
interface TicketLine {
  id: string;
  authorId: string | null;
  authorName: string | null;
  fromStaff: boolean;
  body: string;
  createdAt: string;
}

const props = defineProps<{ ticketId: string; staff?: boolean }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const { t, locale } = useI18n();
const draft = ref('');
const note = ref('');
const busy = ref(false);
const error = ref('');
const closing = ref<'resolved' | 'rejected' | null>(null);
const withdrawing = ref(false);
const menuOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);

const { data, refresh } = await useFetch<{
  ticket: TicketRow;
  messages: TicketLine[];
  canClose: boolean;
}>(() => `/api/tickets/${props.ticketId}`);

const ticket = computed(() => data.value?.ticket ?? null);
const messages = computed(() => data.value?.messages ?? []);
const isClosed = computed(
  () => !!ticket.value && ticket.value.status !== 'open'
);

/**
 * Only on the member's own side. Staff already have Résoudre and Rejeter,
 * which record who decided and why; a moderator reaching for the member's
 * control would file the outcome as "they withdrew it".
 */
const canClose = computed(() => !props.staff && !!data.value?.canClose);

/** The word, derived — never a sixth column that can drift. */
const state = computed(() =>
  ticket.value ? ticketState(ticket.value) : 'open'
);

async function withdraw() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await $fetch(`/api/tickets/${props.ticketId}/close`, { method: 'POST' });
    withdrawing.value = false;
    await refresh();
    emit('changed');
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}

// Clicking elsewhere closes the menu, and so does Escape — a menu you can
// only leave by picking something is a menu you picked by accident.
function onDocClick(e: MouseEvent) {
  if (!menuRef.value?.contains(e.target as Node)) menuOpen.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false;
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});

/**
 * Both sides read this component, and one closure reason is written from
 * a point of view: "Clôturé par toi" is right for the member who did it
 * and false for the moderator reading it afterwards. Everything else is
 * neutral and needs no branch.
 */
const stateLabel = computed(() =>
  props.staff && state.value === 'withdrawn'
    ? t('mod.tickets.withdrawn')
    : t(`tickets.status.${state.value}`)
);

const closureLine = computed(() => {
  const name = ticket.value?.closedByName ?? '—';
  return props.staff && state.value === 'withdrawn'
    ? t('mod.tickets.withdrawnBy', { name })
    : t(`tickets.closedAs.${state.value}`, { name });
});

function stamp(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function fail(err: unknown) {
  error.value =
    (err as { data?: { message?: string } })?.data?.message ?? t('tickets.failed');
}

async function send() {
  const body = draft.value.trim();
  if (!body || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await $fetch(`/api/tickets/${props.ticketId}/messages`, {
      method: 'POST',
      body: { body },
    });
    draft.value = '';
    await refresh();
    emit('changed');
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}

async function assign(take: boolean) {
  busy.value = true;
  error.value = '';
  try {
    await $fetch(`/api/mod/tickets/${props.ticketId}/assign`, {
      method: 'POST',
      body: { take },
    });
    await refresh();
    emit('changed');
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}

async function close() {
  if (!closing.value) return;
  busy.value = true;
  error.value = '';
  try {
    await $fetch(`/api/mod/tickets/${props.ticketId}/close`, {
      method: 'POST',
      body: { reason: closing.value, note: note.value.trim() || undefined },
    });
    closing.value = null;
    note.value = '';
    await refresh();
    emit('changed');
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}

async function reopen() {
  busy.value = true;
  error.value = '';
  try {
    await $fetch(`/api/mod/tickets/${props.ticketId}/reopen`, { method: 'POST' });
    await refresh();
    emit('changed');
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.tk { display: flex; flex-direction: column; gap: 1rem; }

.tk-head { display: flex; flex-direction: column; gap: 0.35rem; }

/* The pill on the left, the menu pinned right — the same shape the
   conversation bar has, so the control is where the hand already goes. */
.tk-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.tk-menu { position: relative; display: inline-flex; flex: none; }
.tk-menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: background var(--dur-2) ease, color var(--dur-2) ease;
}
.tk-menu-btn:hover {
  background: rgb(var(--fg-default) / 0.06);
  color: rgb(var(--fg-strong));
}

.tk-menu-pop {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  z-index: 30;
  min-width: 13rem;
  padding: 0.25rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-elevated));
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);
}
.tk-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: rgb(var(--fg-default));
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}
.tk-menu-item:hover { background: rgb(var(--fg-default) / 0.06); }
.tk-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  align-self: flex-start;
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--line-default));
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
}
.tk-status--open { color: rgb(var(--accent-warm)); border-color: rgb(var(--accent-warm) / 0.4); }
.tk-status--taken { color: rgb(var(--info)); border-color: rgb(var(--info) / 0.4); }
.tk-status--resolved { color: rgb(var(--online)); border-color: rgb(var(--online) / 0.4); }
.tk-status--rejected { color: rgb(var(--fg-muted)); }
.tk-status--stale { color: rgb(var(--fg-subtle)); }
.tk-status--withdrawn { color: rgb(var(--fg-muted)); }
/* An erased author reads as an absence, not as a name in the same weight. */
.tk-name--gone { color: rgb(var(--fg-muted)); font-weight: 500; }

.tk-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
}
.tk-sep { color: rgb(var(--fg-subtle)); }

.tk-closed {
  padding: 0.7rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--fg-default) / 0.04);
}
.tk-closed-title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
}
.tk-closed-note {
  margin: 0.35rem 0 0;
  color: rgb(var(--fg-muted));
  font-size: 0.8rem;
  line-height: 1.6;
  white-space: pre-wrap;
}

.tk-thread {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 22rem;
  overflow-y: auto;
}

/* The two sides differ by a rail rather than by alignment: a ticket is a
   record, and a record reads top to bottom in one column. */
.tk-line {
  padding: 0.5rem 0.7rem;
  border-left: 2px solid rgb(var(--line-default));
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: rgb(var(--fg-default) / 0.03);
}
.tk-line--staff { border-left-color: rgb(var(--info)); }

.tk-author {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.25rem;
  font-size: 0.72rem;
}
.tk-name { font-weight: 700; }
.tk-badge {
  padding: 0 0.35rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--info) / 0.15);
  color: rgb(var(--info));
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.tk-time { margin-left: auto; color: rgb(var(--fg-subtle)); font-family: var(--font-mono); }

.tk-body {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tk-reply { display: flex; flex-direction: column; gap: 0.5rem; }
.tk-input {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-inset));
  color: rgb(var(--fg-default));
  font: inherit;
  font-size: 0.875rem;
  resize: vertical;
}
.tk-input:focus { outline: none; border-color: rgb(var(--accent)); }

.tk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.tk-spacer { flex: 1; }
.tk-btn-danger {
  border-color: rgb(var(--danger) / 0.5);
  color: rgb(var(--danger));
}
.tk-btn-danger:hover:not(:disabled) {
  background: rgb(var(--danger) / 0.12);
  border-color: rgb(var(--danger));
}

.tk-hint { margin: 0; color: rgb(var(--fg-muted)); font-size: 0.8rem; line-height: 1.6; }
.tk-error { margin: 0; color: rgb(var(--danger)); font-size: 0.8rem; }
</style>
