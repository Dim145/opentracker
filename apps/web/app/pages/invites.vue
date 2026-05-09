<template>
  <!--
    The Invitation Registry
    ───────────────────────
    A 2-column editorial layout. Left rail acts as a manuscript-style
    masthead: oversized italic serif counter, ornamental rule, intent.
    Right rail is the working surface: a "draft a new invitation"
    panel followed by a numbered ledger of past codes.
    On narrow viewports the two stack; the masthead becomes a banner.
  -->
  <div class="reg">
    <div class="reg-grain" aria-hidden="true" />

    <aside class="reg-aside">
      <p class="reg-eyebrow">
        <span class="reg-eyebrow-rule" /> The Invitation Registry
      </p>

      <h1 class="reg-numeral">
        <span class="reg-numeral-value">{{ inviteData?.remaining ?? 0 }}</span>
      </h1>

      <p class="reg-numeral-cap">
        <em>{{ remainingLabel }}</em>
      </p>

      <hr class="reg-rule" />

      <p class="reg-prose">
        An invitation is a quiet trust. Each code you draft below
        offers the door to a single guest of your choosing — once
        passed through, it is theirs alone.
      </p>

      <div class="reg-ledger-pills">
        <span class="reg-pill reg-pill--active">
          <span class="reg-pill-dot" /> {{ counts.active }} active
        </span>
        <span class="reg-pill reg-pill--used">
          <span class="reg-pill-dot reg-pill-dot--success" />
          {{ counts.used }} used
        </span>
        <span v-if="counts.expired > 0" class="reg-pill reg-pill--expired">
          {{ counts.expired }} expired
        </span>
      </div>
    </aside>

    <main class="reg-main">
      <!-- ─── Generator ─────────────────────────────────── -->
      <section class="draft" :class="{ 'draft--empty': !canGenerate }">
        <header class="draft-head">
          <span class="draft-roman">I</span>
          <div>
            <h2 class="draft-title">Draft a new invitation</h2>
            <p class="draft-sub">
              Pick how long the code remains valid. After that window
              closes, the door reverts.
            </p>
          </div>
        </header>

        <div class="draft-body">
          <fieldset class="draft-field">
            <legend class="draft-legend">Window of validity</legend>
            <div class="draft-segments" role="radiogroup">
              <label
                v-for="opt in EXPIRY_OPTIONS"
                :key="String(opt.value)"
                class="draft-segment"
                :class="{ 'draft-segment--active': expiryChoice === opt.value }"
              >
                <input
                  type="radio"
                  name="expiry"
                  :value="opt.value"
                  v-model="expiryChoice"
                />
                <span class="draft-segment-label">{{ opt.short }}</span>
                <span class="draft-segment-help">{{ opt.label }}</span>
              </label>
            </div>
          </fieldset>

          <button
            type="button"
            class="draft-cta"
            :disabled="!canGenerate || isGenerating"
            @click="generateInvite"
          >
            <span class="draft-cta-glyph">
              <Icon
                v-if="isGenerating"
                name="ph:circle-notch"
                class="animate-spin"
              />
              <Icon v-else name="ph:feather" />
            </span>
            <span class="draft-cta-label">
              {{ isGenerating ? 'Sealing…' : 'Cast invitation' }}
            </span>
            <span class="draft-cta-arrow">→</span>
          </button>

          <p v-if="!canGenerate" class="draft-empty-note">
            <Icon name="ph:hourglass-low" />
            Your registry has reached its allotted count. An
            administrator may extend it.
          </p>
        </div>
      </section>

      <!-- ─── Ledger ─────────────────────────────────────── -->
      <section class="ledger">
        <header class="ledger-head">
          <span class="ledger-roman">II</span>
          <div>
            <h2 class="ledger-title">The ledger</h2>
            <p class="ledger-sub">
              Every code you have ever drafted, in chronological order.
            </p>
          </div>
        </header>

        <ol v-if="entries.length > 0" class="ledger-list">
          <li
            v-for="(invite, idx) in entries"
            :key="invite.id"
            class="ledger-row"
            :class="`ledger-row--${statusOf(invite)}`"
            :style="`--reveal-delay: ${idx * 30}ms`"
          >
            <span class="ledger-num" aria-hidden="true">
              {{ String(entries.length - idx).padStart(2, '0') }}
            </span>

            <span class="ledger-stripe" aria-hidden="true" />

            <div class="ledger-row-body">
              <div class="ledger-row-line">
                <code class="ledger-code">{{ formatCode(invite.code) }}</code>
                <span class="ledger-status">
                  <Icon :name="statusIcon(invite)" />
                  {{ statusLabel(invite) }}
                </span>
              </div>

              <dl class="ledger-meta">
                <div>
                  <dt>Cast</dt>
                  <dd>{{ formatDate(invite.createdAt) }}</dd>
                </div>
                <div v-if="invite.usedByUser">
                  <dt>Received by</dt>
                  <dd>
                    <NuxtLink
                      :to="`/users/${invite.usedByUser.id}`"
                      class="ledger-user"
                    >
                      @{{ invite.usedByUser.username }}
                      <Icon name="ph:arrow-up-right" />
                    </NuxtLink>
                  </dd>
                </div>
                <div v-else>
                  <dt>{{ statusOf(invite) === 'expired' ? 'Closed' : 'Closes' }}</dt>
                  <dd>
                    {{ invite.expiresAt ? formatDate(invite.expiresAt) : 'Never' }}
                  </dd>
                </div>
              </dl>
            </div>

            <div class="ledger-actions">
              <button
                v-if="statusOf(invite) === 'active'"
                type="button"
                class="ledger-action"
                title="Copy invite link"
                @click="copyLink(invite.code)"
              >
                <Icon name="ph:link" />
              </button>
              <button
                v-if="canDelete(invite)"
                type="button"
                class="ledger-action ledger-action--danger"
                :disabled="pendingDelete === invite.id"
                title="Delete this code"
                @click="askDelete(invite)"
              >
                <Icon
                  :name="pendingDelete === invite.id ? 'ph:circle-notch' : 'ph:trash'"
                  :class="{ 'animate-spin': pendingDelete === invite.id }"
                />
              </button>
            </div>
          </li>
        </ol>

        <div v-else class="ledger-empty">
          <Icon name="ph:scroll" class="ledger-empty-glyph" />
          <p class="ledger-empty-headline">The page is blank.</p>
          <p class="ledger-empty-help">
            Cast your first invitation above to begin the ledger.
          </p>
        </div>
      </section>
    </main>

    <!-- ─── Reveal modal ──────────────────────────────── -->
    <Modal v-model="revealOpen" size="md" hide-close>
      <template #header>
        <div class="seal-head">
          <div class="seal-glyph" aria-hidden="true">
            <Icon name="ph:wax-seal-fill" />
          </div>
          <div>
            <p class="seal-eyebrow">Sealed at {{ sealedTime }}</p>
            <h3 class="seal-title">Your invitation has been cast</h3>
          </div>
        </div>
      </template>

      <div v-if="lastGenerated" class="seal-body">
        <p class="seal-instruction">
          The code below appears <em>once</em>. Copy it now — once you
          close this dialog, it returns to silence.
        </p>

        <div class="seal-card">
          <div class="seal-card-header">
            <span>Inscription</span>
            <span class="seal-card-flourish">⁂</span>
          </div>
          <code class="seal-code">{{ formatCode(lastGenerated.code) }}</code>
          <div class="seal-card-footer">
            <span>
              {{
                lastGenerated.expiresAt
                  ? `Closes ${formatDate(lastGenerated.expiresAt)}`
                  : 'Closes never'
              }}
            </span>
            <span>{{ inviteData?.remaining ?? 0 }} remaining</span>
          </div>
        </div>

        <div class="seal-actions">
          <button type="button" class="seal-btn seal-btn--primary" @click="copyCode(lastGenerated.code)">
            <Icon name="ph:copy-bold" />
            Copy code
          </button>
          <button type="button" class="seal-btn seal-btn--ghost" @click="copyLink(lastGenerated.code)">
            <Icon name="ph:link" />
            Copy invite link
          </button>
        </div>

        <p class="seal-warning">
          <Icon name="ph:warning" />
          If you misplace it, delete the row from the ledger to refund
          the slot, then cast again.
        </p>
      </div>

      <template #footer>
        <div class="seal-footer">
          <button type="button" class="seal-btn seal-btn--ghost" @click="revealOpen = false">
            I have it safe
          </button>
        </div>
      </template>
    </Modal>

    <!-- ─── Confirm delete ─────────────────────────────── -->
    <Modal v-model="confirmOpen" size="sm" title="Strike from the ledger?">
      <div class="confirm-body">
        <p class="confirm-text">
          This row will be <strong>permanently struck</strong> from
          your registry.
        </p>
        <p v-if="pendingInvite && willRefund(pendingInvite)" class="confirm-soft">
          The slot will return to your remaining count.
        </p>
        <p v-else-if="pendingInvite" class="confirm-soft">
          Its window has already closed — the slot will <em>not</em>
          return.
        </p>
      </div>
      <template #footer>
        <div class="confirm-footer">
          <button type="button" class="seal-btn seal-btn--ghost" @click="confirmOpen = false">
            Keep it
          </button>
          <button
            type="button"
            class="seal-btn seal-btn--danger"
            :disabled="pendingDelete !== null"
            @click="confirmDelete"
          >
            <Icon
              :name="pendingDelete ? 'ph:circle-notch' : 'ph:trash'"
              :class="{ 'animate-spin': pendingDelete }"
            />
            Strike it
          </button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Modal from '~/components/Modal.vue';
import { useNotificationStore } from '~/stores/notifications';

interface Invite {
  id: string;
  code: string;
  usedBy?: string | null;
  createdAt: string;
  usedAt?: string | null;
  expiresAt?: string | null;
  usedByUser?: { id: string; username: string } | null;
}

interface InviteResponse {
  invites: Invite[];
  remaining: number;
}

interface GeneratedInvite {
  code: string;
  expiresAt: string | null;
}

const notifications = useNotificationStore();
const isGenerating = ref(false);
const revealOpen = ref(false);
const lastGenerated = ref<GeneratedInvite | null>(null);
const sealedTime = ref('');
const confirmOpen = ref(false);
const pendingInvite = ref<Invite | null>(null);
const pendingDelete = ref<string | null>(null);

const EXPIRY_OPTIONS = [
  { value: 1, short: '1d', label: 'one day' },
  { value: 7, short: '7d', label: 'one week' },
  { value: 30, short: '30d', label: 'one month' },
  { value: 90, short: '90d', label: 'three months' },
  { value: null as number | null, short: '∞', label: 'forever' },
] as const;

const expiryChoice = ref<number | null>(30);

const { data: inviteData, refresh } = await useFetch<InviteResponse>(
  '/api/invites'
);

const canGenerate = computed(() => (inviteData.value?.remaining ?? 0) > 0);

const remainingLabel = computed(() => {
  const n = inviteData.value?.remaining ?? 0;
  if (n === 0) return 'invitations to extend — the registry is full';
  if (n === 1) return 'invitation remaining to extend';
  return 'invitations remaining to extend';
});

type Status = 'active' | 'used' | 'expired';
function statusOf(invite: Invite): Status {
  if (invite.usedBy) return 'used';
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now())
    return 'expired';
  return 'active';
}
function statusLabel(invite: Invite): string {
  return { active: 'Open', used: 'Received', expired: 'Closed' }[statusOf(invite)];
}
function statusIcon(invite: Invite): string {
  return {
    active: 'ph:envelope',
    used: 'ph:envelope-open',
    expired: 'ph:hourglass-simple-low',
  }[statusOf(invite)];
}
function canDelete(invite: Invite): boolean {
  return !invite.usedBy;
}
function willRefund(invite: Invite): boolean {
  return statusOf(invite) === 'active';
}

const entries = computed(() => inviteData.value?.invites ?? []);
const counts = computed(() => {
  const list = entries.value;
  return {
    active: list.filter((i) => statusOf(i) === 'active').length,
    used: list.filter((i) => statusOf(i) === 'used').length,
    expired: list.filter((i) => statusOf(i) === 'expired').length,
  };
});

function formatCode(code: string): string {
  return code.match(/.{1,8}/g)?.join('  ') ?? code;
}
function formatDate(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function inviteUrl(code: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/auth/register?code=${code}`;
}

async function generateInvite() {
  if (isGenerating.value || !canGenerate.value) return;
  isGenerating.value = true;
  try {
    const res = await $fetch<{
      success: true;
      invite: { code: string; expiresAt: string | null };
    }>('/api/invites', {
      method: 'POST',
      body: { expiresInDays: expiryChoice.value },
    });
    lastGenerated.value = {
      code: res.invite.code,
      expiresAt: res.invite.expiresAt,
    };
    sealedTime.value = new Date().toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
    revealOpen.value = true;
    await refresh();
    notifications.success('Invitation cast.');
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        'Failed to cast invitation.'
    );
  } finally {
    isGenerating.value = false;
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    notifications.success('Code copied.');
  } catch {
    notifications.error('Could not copy. Select and copy manually.');
  }
}
async function copyLink(code: string) {
  try {
    await navigator.clipboard.writeText(inviteUrl(code));
    notifications.success('Invite link copied.');
  } catch {
    notifications.error('Could not copy.');
  }
}

function askDelete(invite: Invite) {
  pendingInvite.value = invite;
  confirmOpen.value = true;
}
async function confirmDelete() {
  if (!pendingInvite.value) return;
  pendingDelete.value = pendingInvite.value.id;
  try {
    const res = await $fetch<{ success: true; refunded: boolean }>(
      `/api/invites/${pendingInvite.value.id}`,
      { method: 'DELETE' }
    );
    confirmOpen.value = false;
    pendingInvite.value = null;
    await refresh();
    notifications.success(
      res.refunded ? 'Struck from the ledger. Slot returned.' : 'Struck from the ledger.'
    );
  } catch (err: unknown) {
    notifications.error(
      (err as { data?: { message?: string } })?.data?.message ??
        'Failed to strike entry.'
    );
  } finally {
    pendingDelete.value = null;
  }
}
</script>

<style scoped>
/*
 * The Invitation Registry — a deliberate departure from the rest of
 * the operator console. We borrow from antique-book typography:
 * Fraunces italic for human voice, JetBrains Mono for inscriptions,
 * a warm gilt accent reserved for the act of casting itself.
 *
 * The page is built around two columns on wide screens (a contemplative
 * masthead and a working ledger), collapsing into a single column on
 * narrow ones. Each block fades up in sequence on first paint.
 */

/* Page-local custom properties so we can tune the warm gilt + the
   parchment grain without leaking into the rest of the app. */
.reg {
  --gild: #d4a574;
  --gild-soft: rgba(212, 165, 116, 0.16);
  --gild-line: rgba(212, 165, 116, 0.38);
  --paper: color-mix(in srgb, var(--bg-secondary) 88%, var(--bg-primary));
  --ink: var(--text-primary);
  --ink-soft: var(--text-secondary);
  --ink-muted: var(--text-muted);

  position: relative;
  display: grid;
  grid-template-columns: minmax(280px, 380px) 1fr;
  gap: 4rem;
  max-width: 1180px;
  margin: 0 auto;
  padding: 1rem 0 4rem;
}
@media (max-width: 960px) {
  .reg {
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
}

/* Subtle parchment-like grain overlay across the whole page. */
.reg-grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(
      ellipse at 30% 0%,
      color-mix(in srgb, var(--gild) 6%, transparent),
      transparent 55%
    ),
    radial-gradient(
      ellipse at 80% 110%,
      color-mix(in srgb, var(--accent) 5%, transparent),
      transparent 60%
    );
  z-index: 0;
}
.reg-aside,
.reg-main {
  position: relative;
  z-index: 1;
}

/* ── Aside (masthead) ──────────────────────────────────── */

.reg-aside {
  position: sticky;
  top: calc(var(--header-h) + 2rem);
  align-self: start;
  padding-top: 0.5rem;
  animation: reveal-up 600ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@media (max-width: 960px) {
  .reg-aside { position: static; }
}

.reg-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--gild);
  font-weight: 500;
}
.reg-eyebrow-rule {
  width: 28px;
  height: 1px;
  background: var(--gild-line);
}

.reg-numeral {
  margin: 1.5rem 0 0.25rem;
  line-height: 0.9;
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-weight: 400;
  font-size: clamp(7rem, 14vw, 11rem);
  font-variation-settings: 'opsz' 144;
  letter-spacing: -0.06em;
  color: var(--ink);
  display: block;
}
.reg-numeral-value {
  /* Solid colour with a warm gilt shadow for depth — earlier we
     used `background-clip: text + color: transparent` for a vertical
     gradient effect, but it rendered as fully invisible on the
     italic Fraunces "0" glyph because of how the variable font's
     opsz 144 builds extremely thin strokes. */
  display: inline-block;
  color: var(--ink);
  text-shadow:
    0 1px 0 color-mix(in srgb, var(--gild) 30%, transparent),
    0 12px 32px color-mix(in srgb, var(--gild) 22%, transparent);
}

.reg-numeral-cap {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-size: 1.05rem;
  color: var(--ink-muted);
  font-style: italic;
  margin: 0 0 1.75rem;
  max-width: 22ch;
  line-height: 1.4;
}
.reg-numeral-cap em {
  color: var(--ink-soft);
  font-style: italic;
}

.reg-rule {
  border: 0;
  height: 1px;
  background:
    linear-gradient(
      90deg,
      var(--gild-line),
      color-mix(in srgb, var(--gild-line) 30%, transparent) 60%,
      transparent
    );
  margin: 0 0 1.25rem;
}

.reg-prose {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-size: 0.95rem;
  font-style: italic;
  line-height: 1.6;
  color: var(--ink-muted);
  max-width: 32ch;
  margin: 0 0 1.75rem;
}

.reg-ledger-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.reg-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3rem 0.625rem;
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-muted);
  border: 1px solid var(--line-default);
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
}
.reg-pill-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--gild);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gild) 18%, transparent);
}
.reg-pill-dot--success {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent);
}
.reg-pill--active { color: var(--gild); border-color: var(--gild-line); }
.reg-pill--used { color: var(--success); border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.reg-pill--expired { color: var(--ink-muted); }

/* ── Main column ──────────────────────────────────────── */

.reg-main {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  min-width: 0;
}

/* ── Generator (Draft) ─────────────────────────────────── */

.draft {
  position: relative;
  background: var(--paper);
  border: 1px solid var(--line-default);
  border-radius: 14px;
  padding: 1.75rem;
  overflow: hidden;
  animation: reveal-up 600ms 60ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.draft::before {
  /* Hairline gilt edge along the top, like an embossed page. */
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--gild-line) 30%,
    var(--gild-line) 70%,
    transparent
  );
}
.draft::after {
  /* Diagonal hatch parchment in the corner — only visible in the
     light, never dominant. */
  content: '';
  position: absolute;
  right: -120px;
  bottom: -120px;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(
    circle at center,
    color-mix(in srgb, var(--gild) 8%, transparent),
    transparent 70%
  );
  pointer-events: none;
}

.draft--empty {
  opacity: 0.85;
}

.draft-head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}
.draft-roman {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 1.5rem;
  color: var(--gild);
  font-variation-settings: 'opsz' 144;
  line-height: 1;
  padding-top: 0.125rem;
  flex-shrink: 0;
  width: 28px;
}
.draft-title {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-weight: 500;
  font-size: 1.6rem;
  color: var(--ink);
  margin: 0;
  line-height: 1.15;
  letter-spacing: -0.01em;
}
.draft-sub {
  font-size: 0.875rem;
  color: var(--ink-muted);
  line-height: 1.55;
  margin: 0.375rem 0 0;
  max-width: 52ch;
}

.draft-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.draft-field {
  border: 0;
  padding: 0;
  margin: 0;
}
.draft-legend {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-bottom: 0.625rem;
  padding: 0;
}
.draft-segments {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  border: 1.5px solid var(--line-default);
  background: var(--bg-primary);
  border-radius: 10px;
  padding: 6px;
}
@media (max-width: 540px) {
  .draft-segments {
    grid-template-columns: repeat(3, 1fr);
  }
}
.draft-segment {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0.625rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  transition:
    background 180ms ease,
    color 180ms ease,
    transform 180ms ease;
  isolation: isolate;
}
.draft-segment input { position: absolute; opacity: 0; pointer-events: none; }
.draft-segment-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-soft);
  letter-spacing: 0.04em;
}
.draft-segment-help {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 11px;
  color: var(--ink-muted);
}
.draft-segment:hover:not(.draft-segment--active) {
  background: color-mix(in srgb, var(--gild) 6%, transparent);
}
.draft-segment:hover:not(.draft-segment--active) .draft-segment-label {
  color: var(--ink);
}
.draft-segment--active {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--gild) 22%, transparent),
    color-mix(in srgb, var(--gild) 10%, transparent)
  );
  box-shadow:
    inset 0 0 0 1px var(--gild-line),
    0 4px 16px -8px color-mix(in srgb, var(--gild) 40%, transparent);
}
.draft-segment--active .draft-segment-label { color: var(--gild); }
.draft-segment--active .draft-segment-help { color: var(--ink-soft); }

.draft-cta {
  position: relative;
  display: inline-grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.875rem;
  padding: 0.95rem 1.25rem;
  border-radius: 10px;
  border: 1.5px solid var(--gild);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--gild) 16%, var(--bg-primary)),
    color-mix(in srgb, var(--gild) 4%, var(--bg-primary))
  );
  color: var(--ink);
  cursor: pointer;
  transition:
    transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 200ms ease,
    background 200ms ease;
  text-align: left;
}
.draft-cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 0 0 4px color-mix(in srgb, var(--gild) 12%, transparent),
    0 12px 28px -16px color-mix(in srgb, var(--gild) 60%, transparent);
}
.draft-cta:disabled {
  /* Distinct disabled treatment so the CTA doesn't look like a
     stray input field — desaturate the gilt and switch to a
     dashed neutral border. */
  cursor: not-allowed;
  background: var(--bg-tertiary);
  border-color: var(--line-default);
  border-style: dashed;
  color: var(--ink-muted);
}
.draft-cta:disabled .draft-cta-glyph {
  background: color-mix(in srgb, var(--ink-muted) 15%, transparent);
  color: var(--ink-muted);
}
.draft-cta:disabled .draft-cta-arrow { color: var(--ink-muted); }
.draft-cta-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--gild) 25%, transparent);
  color: var(--gild);
  font-size: 14px;
}
.draft-cta-label {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-weight: 500;
  font-size: 1.125rem;
  letter-spacing: -0.01em;
}
.draft-cta-arrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 18px;
  color: var(--gild);
  transition: transform 200ms ease;
}
.draft-cta:hover:not(:disabled) .draft-cta-arrow { transform: translateX(4px); }

.draft-empty-note {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warning) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 25%, transparent);
  color: var(--ink-muted);
  font-size: 0.8rem;
  font-style: italic;
  font-family: 'Fraunces', 'Times New Roman', serif;
}
.draft-empty-note :deep(svg),
.draft-empty-note .iconify { color: var(--warning); flex-shrink: 0; }

/* ── Ledger ──────────────────────────────────────────── */

.ledger {
  animation: reveal-up 600ms 120ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.ledger-head {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  margin-bottom: 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--line-default);
}
.ledger-roman {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 1.5rem;
  color: var(--gild);
  font-variation-settings: 'opsz' 144;
  line-height: 1;
  padding-top: 0.125rem;
  flex-shrink: 0;
  width: 28px;
}
.ledger-title {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-weight: 500;
  font-size: 1.6rem;
  color: var(--ink);
  margin: 0;
  line-height: 1.15;
  letter-spacing: -0.01em;
}
.ledger-sub {
  font-size: 0.875rem;
  color: var(--ink-muted);
  margin: 0.375rem 0 0;
}

.ledger-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.ledger-row {
  display: grid;
  grid-template-columns: 56px 4px 1fr auto;
  gap: 1rem;
  padding: 1.25rem 0;
  border-bottom: 1px solid var(--line-default);
  align-items: center;
  position: relative;
  animation: reveal-up 480ms var(--reveal-delay, 0ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.ledger-row:last-child { border-bottom: 0; }
.ledger-row:hover {
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--gild) 5%, transparent) 30%,
    transparent
  );
}

.ledger-num {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 1.6rem;
  font-weight: 400;
  color: var(--ink-muted);
  font-variation-settings: 'opsz' 144;
  letter-spacing: -0.04em;
  line-height: 1;
  text-align: right;
  padding-right: 0.5rem;
  border-right: 1px solid var(--line-default);
}
.ledger-row--active .ledger-num { color: var(--gild); }
.ledger-row--used .ledger-num { color: var(--success); }
.ledger-row--expired .ledger-num { color: var(--ink-muted); opacity: 0.7; }

.ledger-stripe {
  align-self: stretch;
  background: var(--ink-muted);
  opacity: 0.3;
  border-radius: 2px;
}
.ledger-row--active .ledger-stripe { background: var(--gild); opacity: 0.6; }
.ledger-row--used .ledger-stripe { background: var(--success); opacity: 0.5; }

.ledger-row-body { min-width: 0; }
.ledger-row-line {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
  margin-bottom: 0.375rem;
}
.ledger-code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--ink);
  padding: 0.3rem 0.625rem;
  background: var(--bg-primary);
  border: 1px solid var(--line-default);
  border-radius: 6px;
  word-break: break-all;
}
.ledger-row--expired .ledger-code { color: var(--ink-muted); }

.ledger-status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-radius: 999px;
  border: 1px solid transparent;
}
.ledger-row--active .ledger-status {
  color: var(--gild);
  background: var(--gild-soft);
  border-color: var(--gild-line);
}
.ledger-row--used .ledger-status {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
}
.ledger-row--expired .ledger-status {
  color: var(--ink-muted);
  background: var(--bg-tertiary);
  border-color: var(--line-default);
}

.ledger-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
  margin: 0;
  font-size: 12px;
}
.ledger-meta > div {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
}
.ledger-meta dt {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-muted);
  font-weight: 500;
}
.ledger-meta dd {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  color: var(--ink-soft);
  margin: 0;
}
.ledger-user {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--gild);
  font-style: italic;
  font-weight: 500;
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--gild) 35%, transparent);
  transition: border-color 160ms ease, color 160ms ease;
}
.ledger-user:hover {
  border-color: var(--gild);
  color: color-mix(in srgb, var(--gild) 80%, white);
}

.ledger-actions {
  display: inline-flex;
  gap: 4px;
  align-self: center;
}
.ledger-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}
.ledger-action:hover:not(:disabled) {
  color: var(--ink);
  background: color-mix(in srgb, var(--gild) 8%, transparent);
  border-color: var(--gild-line);
}
.ledger-action--danger:hover:not(:disabled) {
  color: var(--error);
  background: color-mix(in srgb, var(--error) 8%, transparent);
  border-color: color-mix(in srgb, var(--error) 30%, transparent);
}
.ledger-action:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Empty ledger ─────────────────────────────────────── */
.ledger-empty {
  text-align: center;
  padding: 4rem 2rem;
  border: 1px dashed color-mix(in srgb, var(--gild) 30%, var(--line-default));
  border-radius: 14px;
  background:
    repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--gild) 3%, transparent),
      color-mix(in srgb, var(--gild) 3%, transparent) 1px,
      transparent 1px,
      transparent 14px
    ),
    var(--paper);
}
.ledger-empty-glyph {
  font-size: 2.5rem;
  color: var(--gild);
  opacity: 0.55;
  margin-bottom: 0.75rem;
}
.ledger-empty-headline {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 1.25rem;
  color: var(--ink-soft);
  margin: 0 0 0.25rem;
}
.ledger-empty-help {
  font-size: 0.85rem;
  color: var(--ink-muted);
  margin: 0;
}

/* ── Reveal modal (sealed letter) ─────────────────────── */
.seal-head {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}
.seal-glyph {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(
    140deg,
    color-mix(in srgb, var(--gild) 80%, #b8814a),
    color-mix(in srgb, var(--gild) 50%, #6b3f1c)
  );
  color: #2a1505;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  box-shadow:
    inset 0 -2px 4px rgba(0, 0, 0, 0.25),
    0 8px 24px -10px color-mix(in srgb, var(--gild) 60%, transparent);
}
.seal-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin: 0 0 0.125rem;
}
.seal-title {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-weight: 500;
  font-size: 1.25rem;
  color: var(--ink);
  margin: 0;
  letter-spacing: -0.01em;
}

.seal-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.seal-instruction {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 0.95rem;
  color: var(--ink-muted);
  line-height: 1.55;
  margin: 0;
}
.seal-instruction em {
  color: var(--gild);
  text-decoration: underline;
  text-decoration-color: var(--gild-line);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
  font-style: italic;
}

.seal-card {
  background:
    repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--gild) 4%, transparent),
      color-mix(in srgb, var(--gild) 4%, transparent) 12px,
      transparent 12px,
      transparent 24px
    ),
    var(--bg-primary);
  border: 1px solid var(--gild-line);
  border-radius: 10px;
  padding: 1.25rem;
  text-align: center;
  position: relative;
}
.seal-card-header,
.seal-card-footer {
  display: flex;
  justify-content: space-between;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.seal-card-flourish { color: var(--gild); font-size: 14px; }
.seal-code {
  display: block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(0.95rem, 2vw, 1.2rem);
  letter-spacing: 0.06em;
  color: var(--ink);
  font-weight: 700;
  user-select: all;
  word-spacing: 0.5em;
  line-height: 1.5;
  padding: 1rem 0;
  margin: 0;
}

.seal-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.seal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.7rem 1.1rem;
  border-radius: 8px;
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 0.95rem;
  font-weight: 500;
  border: 1.5px solid var(--line-default);
  background: var(--bg-primary);
  color: var(--ink-soft);
  cursor: pointer;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 160ms ease,
    color 160ms ease;
  flex: 1;
  min-width: 160px;
}
.seal-btn:hover:not(:disabled) {
  border-color: var(--gild-line);
  color: var(--ink);
  transform: translateY(-1px);
}
.seal-btn--primary {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--gild) 22%, var(--bg-primary)),
    color-mix(in srgb, var(--gild) 8%, var(--bg-primary))
  );
  border-color: var(--gild);
  color: var(--ink);
}
.seal-btn--primary:hover:not(:disabled) {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--gild) 14%, transparent);
}
.seal-btn--ghost {
  background: var(--bg-tertiary);
}
.seal-btn--danger {
  background: color-mix(in srgb, var(--error) 18%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--error) 50%, transparent);
  color: var(--ink);
}
.seal-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--error) 28%, var(--bg-primary));
}
.seal-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.seal-warning {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  font-size: 12px;
  color: var(--ink-muted);
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  line-height: 1.55;
  margin: 0;
  padding: 0.75rem 0.875rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warning) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 22%, transparent);
}
.seal-warning :deep(svg),
.seal-warning .iconify { color: var(--warning); flex-shrink: 0; margin-top: 2px; }

.seal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 0.875rem 1.25rem;
  border-top: 1px solid var(--line-default);
}

/* ── Confirm modal ─────────────────────────────────── */
.confirm-body { padding: 1.25rem; }
.confirm-text {
  font-family: 'Fraunces', 'Times New Roman', serif;
  font-style: italic;
  font-size: 1rem;
  color: var(--ink-soft);
  line-height: 1.55;
  margin: 0;
}
.confirm-text strong {
  color: var(--ink);
  font-weight: 600;
  font-style: italic;
}
.confirm-soft {
  font-size: 0.875rem;
  color: var(--ink-muted);
  font-style: italic;
  font-family: 'Fraunces', 'Times New Roman', serif;
  margin: 0.625rem 0 0;
}
.confirm-footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.875rem 1.25rem;
  border-top: 1px solid var(--line-default);
}

/* ── Page-load motion ─────────────────────────────── */
@keyframes reveal-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .reg *,
  .reg *::before,
  .reg *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
