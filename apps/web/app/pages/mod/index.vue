<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <div class="card p-6">
      <h3 class="text-lg font-bold mb-4">{{ $t('mod.dashboard.pendingReports.title') }}</h3>
      <p class="text-sm text-text-muted">
        {{ $t('mod.dashboard.pendingReports.body') }}
      </p>
      <NuxtLink to="/mod/reports" class="btn btn-primary mt-4 inline-block">{{
        $t('mod.dashboard.pendingReports.cta')
      }}</NuxtLink>
    </div>
    <div class="card p-6">
      <h3 class="text-lg font-bold mb-4">{{ $t('mod.dashboard.recentHnR.title') }}</h3>
      <p class="text-sm text-text-muted">
        {{ $t('mod.dashboard.recentHnR.body') }}
      </p>
      <NuxtLink to="/mod/hnr" class="btn btn-primary mt-4 inline-block">{{
        $t('mod.dashboard.recentHnR.cta')
      }}</NuxtLink>
    </div>
  </div>
</template>
