<template>
  <Modal
    :model-value="!!modelValue"
    :title="$t('mod.warn.title')"
    icon="ph:hand-palm"
    icon-tone="warning"
    size="md"
    @update:model-value="close"
  >
    <div class="warn-body">
      <p class="warn-lead">
        {{ $t('mod.warn.lead', { name: subjectName }) }}
      </p>

      <label class="field-label" :for="reasonId">{{ $t('mod.panel.reasonLabel') }}</label>
      <select :id="reasonId" v-model="reasonCode" class="input" @change="applyTemplate">
        <option value="" disabled>{{ $t('mod.panel.reasonPlaceholder') }}</option>
        <option v-for="r in choices" :key="r.code" :value="r.code">
          {{ $t(`mod.reasons.${r.i18n}.label`) }}
        </option>
      </select>

      <label class="field-label" :for="messageId">{{ $t('mod.warn.messageLabel') }}</label>
      <textarea
        :id="messageId"
        v-model="message"
        class="input warn-textarea"
        rows="4"
        :placeholder="$t('mod.warn.messagePlaceholder')"
      />
      <p class="field-help">{{ $t('mod.warn.messageHelp') }}</p>

      <label class="field-label" :for="expiryId">{{ $t('mod.warn.expiryLabel') }}</label>
      <select :id="expiryId" v-model="expiresIn" class="input">
        <option v-for="e in EXPIRIES" :key="e" :value="e">
          {{ $t(`mod.warn.expiry.${e}`) }}
        </option>
      </select>
      <p class="field-help">{{ $t('mod.warn.expiryHelp') }}</p>

      <p v-if="error" class="warn-error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="close">
        {{ $t('common.cancel') }}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="!canSubmit || busy"
        @click="submit"
      >
        <Icon v-if="busy" name="ph:circle-notch" class="animate-spin" />
        {{ $t('mod.warn.submit') }}
      </button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
/**
 * Avertir, entre « ne rien faire » et « bannir ».
 *
 * La sanction sur signalement allait de `none` à `permanent` en six crans, et
 * aucun ne disait simplement « ceci n'était pas correct ». Un membre qui se
 * trompe une fois ne mérite pas d'être coupé ; ne rien faire ne lui apprend
 * rien, et il recommence de bonne foi.
 *
 * Le message est obligatoire, et c'est délibéré : un avertissement dont le
 * membre ne comprend pas l'objet est une punition, pas une correction.
 */
import { computed, ref, useId, watch } from 'vue';
import { reasonsForScope } from '@trackarr/shared/moderation';
import Modal from '~/components/Modal.vue';

interface Subject {
  uploader: { id: string; username: string } | null;
  infoHash?: string;
}

const props = defineProps<{ modelValue: Subject | null }>();
const emit = defineEmits<{
  'update:modelValue': [value: null];
  issued: [];
}>();

const { t } = useI18n();
const notifications = useNotificationStore();

const EXPIRIES = ['30d', '90d', '1y', 'never'] as const;
const choices = reasonsForScope('warning');

const reasonId = useId();
const messageId = useId();
const expiryId = useId();

const reasonCode = ref('');
const message = ref('');
const expiresIn = ref<(typeof EXPIRIES)[number]>('90d');
const busy = ref(false);
const error = ref('');
let lastTemplate = '';

const subjectName = computed(
  () => props.modelValue?.uploader?.username ?? '—'
);
const canSubmit = computed(
  () =>
    !!props.modelValue?.uploader?.id &&
    !!reasonCode.value &&
    message.value.trim().length > 0
);

watch(
  () => props.modelValue,
  () => {
    reasonCode.value = '';
    message.value = '';
    expiresIn.value = '90d';
    error.value = '';
    lastTemplate = '';
  }
);

function applyTemplate() {
  const r = choices.find((x) => x.code === reasonCode.value);
  if (!r) return;
  const body = t(`mod.reasons.${r.i18n}.body`);
  if (!message.value.trim() || message.value === lastTemplate) {
    message.value = body;
  }
  lastTemplate = body;
}

function close() {
  if (busy.value) return;
  emit('update:modelValue', null);
}

async function submit() {
  const uploader = props.modelValue?.uploader;
  if (!uploader || !canSubmit.value) return;
  busy.value = true;
  error.value = '';
  try {
    await $fetch('/api/mod/warnings', {
      method: 'POST',
      body: {
        userId: uploader.id,
        reasonCode: reasonCode.value,
        message: message.value.trim(),
        expiresIn: expiresIn.value,
        sourceType: props.modelValue?.infoHash ? 'torrent' : undefined,
        sourceId: props.modelValue?.infoHash,
      },
    });
    notifications.success(t('mod.warn.done', { name: uploader.username }));
    emit('issued');
    emit('update:modelValue', null);
  } catch (e: unknown) {
    error.value =
      (e as { data?: { message?: string } })?.data?.message ??
      t('common.actionFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.warn-body {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.warn-lead {
  margin: 0 0 0.35rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}
.warn-textarea {
  resize: vertical;
  min-height: 5rem;
  font-family: inherit;
  line-height: 1.5;
}
.warn-error {
  margin: 0.2rem 0 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid rgb(var(--danger) / 0.55);
  border-radius: var(--radius-sm);
  background: rgb(var(--danger) / 0.12);
  /* Le rouge sur son propre fond teinté tombait à 4,47:1 en thème sombre,
     sous le seuil. Le texte passe en avant-plan par défaut ; le rouge reste
     porté par la bordure et le fond, donc le message garde sa couleur sans
     que sa lisibilité en dépende. */
  color: rgb(var(--fg-default));
  font-size: 0.75rem;
}
</style>
