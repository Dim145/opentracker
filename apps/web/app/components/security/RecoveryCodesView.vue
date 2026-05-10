<template>
  <!-- Generic recovery-code grid + copy + download. The TOTP setup
       wizard and the regenerate flow both render this component
       once they have cleartext codes from the API. -->
  <div class="rcv">
    <ul class="rcv-grid">
      <li v-for="(c, i) in codes" :key="i" class="rcv-item">
        <code>{{ c }}</code>
      </li>
    </ul>
    <div class="rcv-actions">
      <button class="btn-ghost" type="button" @click="copyAll">
        <Icon name="ph:copy-bold" />
        {{ copied ? $t('common.copied') : $t('security.recoveryCodes.copyAll') }}
      </button>
      <button class="btn-ghost" type="button" @click="download">
        <Icon name="ph:download-simple-bold" />
        {{ $t('security.recoveryCodes.downloadTxt') }}
      </button>
      <button class="btn-ghost" type="button" @click="print">
        <Icon name="ph:printer-bold" />
        {{ $t('security.recoveryCodes.print') }}
      </button>
    </div>
    <p class="rcv-warning">
      <Icon name="ph:warning-bold" />
      <span>
        {{ $t('security.recoveryCodes.warningPrefix') }}
        <strong>{{ $t('security.recoveryCodes.warningStrong') }}</strong>{{ $t('security.recoveryCodes.warningSuffix') }}
      </span>
    </p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ codes: string[] }>();

const { t } = useI18n();

const copied = ref(false);

async function copyAll() {
  try {
    await navigator.clipboard.writeText(props.codes.join('\n'));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    // ignored — older browser fallback handled by selection
  }
}

function download() {
  const blob = new Blob([props.codes.join('\n') + '\n'], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trackarr-recovery-codes.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function print() {
  // Open the codes in a clean printable window — no chrome, mono
  // font, easy to drop in a paper safe.
  const w = window.open('', 'rc-print');
  if (!w) return;
  const list = props.codes.map((c) => `<li><code>${c}</code></li>`).join('');
  const title = t('security.recoveryCodes.printTitle');
  const intro = t('security.recoveryCodes.printIntro');
  w.document.write(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<style>body{font-family:ui-monospace,monospace;padding:2rem;color:#111}` +
      `h1{font-size:1.2rem}ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:.5rem 1.5rem}` +
      `code{font-size:1.05rem;letter-spacing:.06em}` +
      `</style>` +
      `<h1>${title}</h1>` +
      `<p>${intro}</p>` +
      `<ul>${list}</ul>`
  );
  w.document.close();
  w.focus();
  w.print();
}
</script>

<style scoped>
.rcv {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin: 0.65rem 0;
}
.rcv-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.4rem 0.85rem;
}
.rcv-item {
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 3px;
  padding: 0.4rem 0.65rem;
  text-align: center;
}
.rcv-item code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-strong));
}
.rcv-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 2px;
  color: rgb(var(--fg-muted));
  cursor: pointer;
}
.btn-ghost:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}
.rcv-warning {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 11.5px;
  line-height: 1.55;
  color: rgb(var(--warning));
}
.rcv-warning strong {
  font-weight: 700;
}
@media (max-width: 480px) {
  .rcv-grid {
    grid-template-columns: 1fr;
  }
}
</style>
