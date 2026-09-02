<template>
  <Teleport to="body">
    <!-- A live region, because this container is the only channel every
         confirmation on the site travels through: a rotated key, a saved
         search, a reseed request, and every error including the ones a route
         hands back verbatim. Without it a screen reader hears nothing after
         pressing any of them — the toast appears, animates, and leaves in
         silence. `polite` rather than `assertive` so it waits for a gap instead
         of cutting the reader off mid-sentence, and `aria-atomic` so a toast is
         read as one message rather than as the fragments it is built from. -->
    <div
      class="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <TransitionGroup name="notification">
        <div
          v-for="notification in notifications"
          :key="notification.id"
          class="pointer-events-auto max-w-sm animate-in slide-in-from-right duration-200"
        >
          <div
            class="card !p-4 flex items-start gap-3 shadow-lg border"
            :class="borderClass(notification.type)"
          >
            <Icon
              :name="iconName(notification.type)"
              class="w-5 h-5 shrink-0 mt-0.5"
              :class="iconClass(notification.type)"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-text-primary">
                {{ notification.title }}
              </p>
              <p
                v-if="notification.message"
                class="text-xs text-text-muted mt-0.5"
              >
                {{ notification.message }}
              </p>
            </div>
            <button
              class="shrink-0 text-text-muted hover:text-text-strong transition-colors"
              @click="notificationStore.remove(notification.id)"
            >
              <Icon name="ph:x-bold" class="w-4 h-4" />
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const notificationStore = useNotificationStore();
const { notifications } = storeToRefs(notificationStore);

function iconName(type: string) {
  switch (type) {
    case 'success':
      return 'ph:check-circle-bold';
    case 'error':
      return 'ph:x-circle-bold';
    case 'warning':
      return 'ph:warning-bold';
    default:
      return 'ph:info-bold';
  }
}

/*
 * Les teintes du bandeau, prises au thème.
 *
 * C'étaient `text-green-400` / `text-red-400` / `text-yellow-400` /
 * `text-blue-400` et les bordures assorties : des couleurs Tailwind fixes, sur
 * une carte dont le fond suit le thème. En thème clair, `text-yellow-400`
 * (#facc15) sur la surface d'une carte tombe autour de 1,5:1 — l'icône du
 * bandeau d'avertissement était pratiquement invisible, et c'est le seul canal
 * par lequel le site dit qu'une action a échoué.
 */
function iconClass(type: string) {
  switch (type) {
    case 'success':
      return 'text-success';
    case 'error':
      return 'text-error';
    case 'warning':
      return 'text-warning';
    default:
      return 'text-info';
  }
}

function borderClass(type: string) {
  switch (type) {
    case 'success':
      return 'border-success/30';
    case 'error':
      return 'border-error/30';
    case 'warning':
      return 'border-warning/30';
    default:
      return 'border-info/30';
  }
}
</script>

<style scoped>
.notification-enter-active,
.notification-leave-active {
  transition: all var(--dur-4) ease;
}
.notification-enter-from {
  opacity: 0;
  transform: translateX(100%);
}
.notification-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>
