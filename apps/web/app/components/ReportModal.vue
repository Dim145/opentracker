<template>
  <!--
    ReportModal — incident slip.

    The component is a small modal slid in front of the page that lets
    any authenticated user file a moderation report against a target
    entity (torrent, user, post, comment). It is shaped like a paper
    incident slip:

      ┌───────────────────────────────────┐
      │ ▢ FILE INCIDENT          ×        │  ← header with red flag
      │ TORRENT · The.Big.Lebowski.1998   │  ← target line (mono caption)
      │ ─────────────────────────────────  │
      │ REASON                             │
      │ [Spam] [Fake] [Copyright]          │  ← chip picker
      │ [Inappropriate] [Harassment] […]   │
      │                                    │
      │ ADDITIONAL DETAILS         142/2000│
      │ ┌───────────────────────────────┐  │
      │ │ …                             │  │
      │ └───────────────────────────────┘  │
      │ 🔒 Identity hidden from target     │  ← anonymity assurance
      │                  [Cancel] [File]   │  ← actions
      └─────^─^─^─^─^─^─^─^─^─^─^─^─^─^─┘  ← serrated edge

    The target row is informational so the operator can confirm what
    they're flagging before submitting — eliminates "wait, was that
    the right one?" panic. The serrated bottom edge is a single CSS
    pseudo-element (no SVG) that signals "form, to be torn off".
  -->
  <Teleport to="body">
    <Transition name="slip">
      <div
        v-if="isOpen"
        class="slip-backdrop"
        @click.self="close"
        @keydown.esc="close"
      >
        <div
          ref="slipRef"
          class="slip"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          :aria-labelledby="titleId"
        >
          <!-- ── Header ───────────────────────────────────────── -->
          <header class="slip-head">
            <span class="slip-eyebrow">
              <Icon name="ph:flag-fill" class="slip-eyebrow-icon" />
              <span :id="titleId">{{ $t('components.report.eyebrow') }}</span>
            </span>
            <button
              type="button"
              class="slip-close"
              :aria-label="$t('common.close')"
              @click="close"
            >
              <Icon name="ph:x-bold" />
            </button>
          </header>

          <!-- ── Target row ─────────────────────────────────── -->
          <div class="slip-target">
            <span class="slip-target-tag">{{ targetTypeLabel }}</span>
            <span class="slip-target-divider" aria-hidden="true">·</span>
            <span class="slip-target-name" :title="targetLabel || targetId">
              {{ targetLabel || $t('components.report.unnamedTarget') }}
            </span>
            <span class="slip-target-ref">#{{ targetIdShort }}</span>
          </div>

          <!-- ── Body ─────────────────────────────────────── -->
          <div class="slip-body">
            <!-- Reason picker — chip grid. Each chip is one of the
                 fixed motives mods scan for first; the value stored on
                 the report is the human label so the moderation page
                 reads clearly without an extra lookup. -->
            <div class="slip-field">
              <span class="slip-label">{{ $t('components.report.reason') }}</span>
              <div class="chips">
                <button
                  v-for="opt in reasonOptions"
                  :key="opt.value"
                  type="button"
                  class="chip"
                  :class="{ 'chip--active': reason === opt.value }"
                  :title="opt.value"
                  @click="reason = opt.value"
                >
                  <Icon :name="opt.icon" class="chip-icon" />
                  <span class="chip-label">{{ opt.label }}</span>
                </button>
              </div>
            </div>

            <!-- Details textarea with live counter. -->
            <div class="slip-field">
              <div class="slip-label-row">
                <span class="slip-label">
                  {{ $t('components.report.detailsLabel') }}
                </span>
                <span
                  class="slip-counter tabular-nums"
                  :class="{ 'slip-counter--warn': details.length > 1800 }"
                >
                  {{ details.length }}/2000
                </span>
              </div>
              <textarea
                v-model="details"
                rows="4"
                maxlength="2000"
                class="slip-textarea"
                :placeholder="$t('components.report.detailsPlaceholder')"
              />
            </div>

            <!-- Anonymity note. Reassures the reporter that the target
                 won't see their identity — important for harassment
                 cases where revealing the reporter could trigger
                 retaliation. -->
            <p class="slip-anonymous">
              <Icon name="ph:lock-key-bold" class="slip-anonymous-icon" />
              <span>{{ $t('components.report.anonymousNote') }}</span>
            </p>
          </div>

          <!-- ── Actions ──────────────────────────────────── -->
          <footer class="slip-foot">
            <button type="button" class="slip-btn slip-btn--ghost" @click="close">
              {{ $t('common.cancel') }}
            </button>
            <button
              type="button"
              class="slip-btn slip-btn--file"
              :disabled="!reason || isSubmitting"
              @click="submitReport"
            >
              <Icon
                :name="isSubmitting ? 'ph:circle-notch' : 'ph:paper-plane-tilt-bold'"
                :class="isSubmitting ? 'spin' : ''"
              />
              <span>{{ isSubmitting ? $t('components.report.filing') : $t('components.report.fileReport') }}</span>
            </button>
          </footer>

          <!-- Serrated bottom edge — pure CSS, decorative only. -->
          <span class="slip-serration" aria-hidden="true" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useNotificationStore } from '~/stores/notifications';

const { t } = useI18n();

const props = defineProps<{
  isOpen: boolean;
  targetType: 'torrent' | 'user' | 'post' | 'comment';
  targetId: string;
  /** Optional human label shown in the slip's target row. */
  targetLabel?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submitted'): void;
}>();

const notifications = useNotificationStore();
const reason = ref('');
const details = ref('');
const isSubmitting = ref(false);

// Stable id for aria-labelledby; one per mounted instance.
const titleId = useId();

const targetTypeLabel = computed(() =>
  t(`components.report.targets.${props.targetType}`)
);

// Show a short hash-style suffix on the slip header so the operator
// can disambiguate when reporting one of many similar items (e.g.
// multiple seasons of the same show).
const targetIdShort = computed(() => {
  const id = props.targetId || '';
  if (id.length <= 8) return id;
  return id.slice(0, 8);
});

// Reason options — value is the label sent to the API (must be 10+
// chars to satisfy the Zod schema), the icon is purely cosmetic. The
// "other" reason includes the "see details" pointer so it clears the
// 10-char floor on its own and signals the user should explain.
const reasonOptions = computed(() => [
  {
    value: t('components.report.reasons.spam'),
    label: t('components.report.reasons.spam'),
    icon: 'ph:megaphone-bold',
  },
  {
    value: t('components.report.reasons.fake'),
    label: t('components.report.reasons.fake'),
    icon: 'ph:warning-circle-bold',
  },
  {
    value: t('components.report.reasons.copyright'),
    label: t('components.report.reasons.copyright'),
    icon: 'ph:copyright-bold',
  },
  {
    value: t('components.report.reasons.inappropriate'),
    label: t('components.report.reasons.inappropriate'),
    icon: 'ph:warning-octagon-bold',
  },
  {
    value: t('components.report.reasons.harassment'),
    label: t('components.report.reasons.harassment'),
    icon: 'ph:hand-palm-bold',
  },
  {
    value: t('components.report.reasons.other'),
    label: t('components.report.reasons.otherShort'),
    icon: 'ph:question-bold',
  },
]);

function close() {
  reason.value = '';
  details.value = '';
  emit('close');
}

async function submitReport() {
  if (!reason.value || isSubmitting.value) return;

  isSubmitting.value = true;
  try {
    await $fetch('/api/reports', {
      method: 'POST',
      body: {
        targetType: props.targetType,
        targetId: props.targetId,
        reason: reason.value,
        details: details.value || undefined,
      },
    });
    notifications.success(t('components.report.toasts.submitted'));
    emit('submitted');
    close();
  } catch (error: any) {
    notifications.error(
      error.data?.message || t('components.report.errors.submitFailed')
    );
  } finally {
    isSubmitting.value = false;
  }
}

// Focus + Esc management. The window-level listener fires even
// when the user has tabbed outside the slip, and the panel auto-
// focuses on open so the very first keystroke is captured.
const slipRef = ref<HTMLElement | null>(null);

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.isOpen) {
    e.preventDefault();
    close();
  }
}

watch(
  () => props.isOpen,
  (open) => {
    if (typeof window === 'undefined') return;
    if (open) {
      window.addEventListener('keydown', handleEsc);
      nextTick(() => slipRef.value?.focus());
    } else {
      window.removeEventListener('keydown', handleEsc);
    }
  }
);

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleEsc);
  }
});
</script>

<style scoped>
/* ── Backdrop ─────────────────────────────────────────────── */
.slip-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1.25rem;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
}

/* ── Slip — the incident form itself ──────────────────────── */
.slip {
  position: relative;
  width: 100%;
  max-width: 500px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.7),
    0 0 0 1px rgba(244, 63, 94, 0.08);
  /* Faint red rule along the top hints at the alert-grade nature
     of the document without screaming. */
}
.slip::before {
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 1rem;
  height: 2px;
  background: linear-gradient(
    to right,
    rgba(244, 63, 94, 0) 0%,
    rgba(244, 63, 94, 0.55) 50%,
    rgba(244, 63, 94, 0) 100%
  );
}

/* Serrated bottom edge — pure CSS perforation suggesting the slip
   is meant to be torn off and filed. */
.slip-serration {
  display: block;
  height: 12px;
  background:
    radial-gradient(circle at 6px 0, transparent 5px, rgb(var(--bg-elevated)) 5.5px) repeat-x;
  background-size: 12px 12px;
  background-position: 0 -6px;
  margin-top: -1px;
  /* The pseudo-perforation has to clip against the page background,
     not the slip's bg — so it pretends to "eat" into the slip. */
}

/* ── Header ──────────────────────────────────────────────── */
.slip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1.1rem 0.8rem;
}
.slip-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #f43f5e;
}
.slip-eyebrow-icon {
  font-size: 1rem;
  color: #f43f5e;
  filter: drop-shadow(0 0 6px rgba(244, 63, 94, 0.35));
}
.slip-close {
  background: transparent;
  border: 0;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.15s ease;
}
.slip-close:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-inset));
}

/* ── Target row ─────────────────────────────────────────── */
.slip-target {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1.1rem 0.9rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.slip-target-tag {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-inset));
  padding: 0.2rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  flex-shrink: 0;
}
.slip-target-divider {
  color: rgb(var(--fg-faint));
}
.slip-target-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.slip-target-ref {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

/* ── Body ────────────────────────────────────────────────── */
.slip-body {
  padding: 1rem 1.1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 1.05rem;
}
.slip-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.slip-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.slip-label-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}
.slip-counter {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  color: rgb(var(--fg-faint));
  letter-spacing: 0.05em;
  transition: color 0.18s ease;
}
.slip-counter--warn {
  color: #f59e0b;
}

/* ── Chip picker ────────────────────────────────────────── */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.7rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  white-space: nowrap;
}
.chip:hover:not(.chip--active) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
  background: rgb(var(--bg-inset));
}
.chip--active {
  color: #f43f5e;
  border-color: rgba(244, 63, 94, 0.55);
  background: rgba(244, 63, 94, 0.08);
  box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.25);
}
.chip-icon {
  font-size: 0.9rem;
}
.chip-label {
  letter-spacing: 0.01em;
}

/* ── Textarea ───────────────────────────────────────────── */
.slip-textarea {
  width: 100%;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  padding: 0.65rem 0.75rem;
  color: rgb(var(--fg-strong));
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.slip-textarea:focus {
  outline: none;
  border-color: rgba(244, 63, 94, 0.55);
  box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.12);
}
.slip-textarea::placeholder {
  color: rgb(var(--fg-faint));
}

/* ── Anonymity note ────────────────────────────────────── */
.slip-anonymous {
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  background: rgba(108, 209, 97, 0.05);
  border: 1px dashed rgba(108, 209, 97, 0.3);
  border-radius: var(--radius-sm);
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
}
.slip-anonymous-icon {
  font-size: 0.95rem;
  color: rgba(108, 209, 97, 0.85);
  flex-shrink: 0;
  margin-top: 0.05rem;
}

/* ── Actions footer ────────────────────────────────────── */
.slip-foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0 1.1rem 1.1rem;
}
.slip-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  white-space: nowrap;
}
.slip-btn:hover:not(:disabled) {
  background: rgb(var(--bg-inset));
  border-color: rgb(var(--line-strong));
}
.slip-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.slip-btn--ghost {
  background: transparent;
}
.slip-btn--file {
  background: #f43f5e;
  border-color: #f43f5e;
  color: white;
  text-transform: uppercase;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
}
.slip-btn--file:hover:not(:disabled) {
  background: #e11d48;
  border-color: #e11d48;
  box-shadow: 0 4px 14px -6px rgba(244, 63, 94, 0.5);
}

.spin {
  animation: slip-spin 1s linear infinite;
}
@keyframes slip-spin {
  to { transform: rotate(360deg); }
}

/* ── Enter / leave transition ────────────────────────────── */
.slip-enter-active,
.slip-leave-active {
  transition: opacity 0.2s ease;
}
.slip-enter-active .slip,
.slip-leave-active .slip {
  transition: transform 0.32s cubic-bezier(0.2, 0.85, 0.2, 1),
    opacity 0.22s ease;
}
.slip-enter-from,
.slip-leave-to {
  opacity: 0;
}
.slip-enter-from .slip,
.slip-leave-to .slip {
  opacity: 0;
  transform: translateY(-16px) scale(0.96);
}
</style>
