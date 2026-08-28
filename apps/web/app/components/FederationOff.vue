<template>
  <div class="fed-off">
    <div class="fed-off-icon">
      <Icon name="ph:broadcast-slash-bold" />
    </div>
    <h1 class="fed-off-title">{{ $t('federationOff.title') }}</h1>
    <p class="fed-off-lead">{{ $t('federationOff.lead') }}</p>
    <p v-if="isAdmin" class="fed-off-admin">
      {{ $t('federationOff.adminHint') }}
    </p>
    <div class="fed-off-actions">
      <NuxtLink v-if="isAdmin" to="/admin/federation" class="fed-off-btn primary">
        <Icon name="ph:sliders-horizontal-bold" />
        {{ $t('federationOff.goToSettings') }}
      </NuxtLink>
      <NuxtLink to="/torrents" class="fed-off-btn">
        <Icon name="ph:arrow-left-bold" />
        {{ $t('federationOff.back') }}
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Shown in place of a federation page when the owner has federation switched
 * off. The nav items are already hidden in that state, so anyone landing here
 * typed the URL, followed an old link, or is an admin checking — which is why
 * this explains the situation rather than 404ing, and points admins at the
 * switch instead of leaving them to find it.
 */
const { user } = useUserSession();
const isAdmin = computed(() => Boolean(user.value?.isAdmin));
</script>

<style scoped>
.fed-off {
  max-width: 34rem;
  margin: 0 auto;
  padding: 5rem 1.5rem;
  text-align: center;
}

.fed-off-icon {
  width: 5rem;
  height: 5rem;
  margin: 0 auto 1.75rem;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  border: 1px dashed var(--color-border, rgb(255 255 255 / 0.12));
  color: var(--color-text-secondary, rgb(255 255 255 / 0.45));
  font-size: 2rem;
}

.fed-off-title {
  font-size: 1.6rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

.fed-off-lead {
  color: var(--color-text-secondary, rgb(255 255 255 / 0.6));
  line-height: 1.6;
}

.fed-off-admin {
  margin-top: 0.75rem;
  color: var(--color-text-secondary, rgb(255 255 255 / 0.45));
  font-size: 0.875rem;
  line-height: 1.6;
}

.fed-off-actions {
  margin-top: 2rem;
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

.fed-off-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.1rem;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-border, rgb(255 255 255 / 0.12));
  color: var(--color-text-secondary, rgb(255 255 255 / 0.7));
  font-size: 0.9rem;
  transition: background-color var(--dur-2), color var(--dur-2), border-color var(--dur-2);
}

.fed-off-btn:hover {
  background: rgb(255 255 255 / 0.04);
  color: var(--color-text-primary, rgb(255 255 255 / 0.92));
}

.fed-off-btn.primary {
  border-color: rgb(56 189 248 / 0.35);
  color: rgb(125 211 252);
}

.fed-off-btn.primary:hover {
  background: rgb(56 189 248 / 0.08);
}
</style>
