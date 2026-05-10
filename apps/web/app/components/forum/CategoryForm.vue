<template>
  <div class="cat-form">
    <div class="cat-form-row">
      <label class="cat-label">
        <span>{{ $t('forum.categoryForm.sectionName') }}</span>
        <input
          v-model="model.name"
          type="text"
          class="cat-input"
          :placeholder="$t('forum.categoryForm.sectionNamePlaceholder')"
          maxlength="100"
          autocomplete="off"
        />
      </label>
    </div>

    <div class="cat-form-row">
      <label class="cat-label">
        <span>{{ $t('forum.categoryForm.description') }}</span>
        <textarea
          v-model="model.description"
          rows="3"
          class="cat-input cat-input--textarea"
          :placeholder="$t('forum.categoryForm.descriptionPlaceholder')"
          maxlength="500"
        />
      </label>
    </div>

    <div class="cat-form-row cat-form-row--split">
      <label class="cat-label">
        <span>{{ $t('forum.categoryForm.order') }}</span>
        <input
          v-model.number="model.order"
          type="number"
          class="cat-input cat-input--number"
          min="0"
          step="1"
        />
      </label>

      <label class="cat-label">
        <span>{{ $t('forum.categoryForm.accent') }}</span>
        <div class="color-row">
          <input
            v-model="model.color"
            type="color"
            class="color-swatch"
            :aria-label="$t('forum.categoryForm.accentColor')"
          />
          <input
            v-model="model.color"
            type="text"
            class="cat-input cat-input--mono"
            placeholder="#9ca3af"
            maxlength="7"
            pattern="^#[0-9a-fA-F]{6}$"
          />
        </div>
      </label>
    </div>

    <div class="cat-form-row">
      <label class="cat-label">
        <span>{{ $t('forum.categoryForm.icon') }}</span>
        <div class="icon-row">
          <span class="icon-preview">
            <Icon :name="model.icon || 'ph:newspaper-clipping-bold'" />
          </span>
          <input
            v-model="model.icon"
            type="text"
            class="cat-input cat-input--mono"
            placeholder="ph:newspaper-clipping-bold"
            spellcheck="false"
            autocomplete="off"
          />
        </div>
        <p class="cat-help">
          {{ $t('forum.categoryForm.iconHintPrefix') }}
          <a
            href="https://phosphoricons.com"
            target="_blank"
            rel="noreferrer"
            class="cat-help-link"
            >{{ $t('forum.categoryForm.phosphor') }}</a
          >
          {{ $t('forum.categoryForm.iconHintMiddle') }} <code>ph:megaphone-bold</code>{{ $t('forum.categoryForm.iconHintSuffix') }}
        </p>
      </label>
    </div>

    <div class="icon-suggestions">
      <button
        v-for="suggestion in iconSuggestions"
        :key="suggestion"
        type="button"
        class="icon-chip"
        :class="{ 'icon-chip--on': model.icon === suggestion }"
        :title="suggestion"
        @click="model.icon = suggestion"
      >
        <Icon :name="suggestion" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface CategoryDraft {
  id?: string;
  name: string;
  description: string;
  color: string | null;
  icon: string | null;
  order: number;
}

const model = defineModel<CategoryDraft>({ required: true });

// A handful of curated icons covering the typical first-pass set: news,
// announcements, support, off-topic, rules, recommendations. The admin
// can paste any Phosphor id beyond these.
const iconSuggestions = [
  'ph:newspaper-clipping-bold',
  'ph:megaphone-bold',
  'ph:books-bold',
  'ph:lightbulb-filament-bold',
  'ph:question-bold',
  'ph:warning-bold',
  'ph:hand-waving-bold',
  'ph:gavel-bold',
  'ph:campfire-bold',
  'ph:popcorn-bold',
  'ph:ghost-bold',
  'ph:lock-bold',
];
</script>

<style scoped>
.cat-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.cat-form-row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.cat-form-row--split {
  display: grid;
  grid-template-columns: 6rem 1fr;
  gap: 1rem;
  align-items: end;
}
.cat-label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.cat-input {
  width: 100%;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 0.92rem;
  letter-spacing: 0;
  text-transform: none;
  color: rgb(var(--fg-default));
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  padding: 0.55rem 0.75rem;
  transition: border-color 0.12s;
}
.cat-input:focus {
  outline: none;
  border-color: rgb(var(--fg-default));
}
.cat-input--textarea {
  resize: vertical;
  min-height: 4.5rem;
  font-family: 'Inter', system-ui, sans-serif;
  line-height: 1.5;
}
.cat-input--mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.85rem;
}
.cat-input--number {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.color-swatch {
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}
.color-swatch::-webkit-color-swatch {
  border: 0;
  border-radius: 3px;
}
.color-swatch::-moz-color-swatch {
  border: 0;
  border-radius: 3px;
}

.icon-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.icon-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-elevated));
  font-size: 1.2rem;
  color: rgb(var(--fg-strong));
  flex-shrink: 0;
}

.cat-help {
  margin: 0;
  font-family: 'Inter', sans-serif;
  font-size: 11.5px;
  letter-spacing: 0;
  text-transform: none;
  color: rgb(var(--fg-muted));
  font-weight: 400;
}
.cat-help code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 2px;
  padding: 0 0.3rem;
  font-size: 11px;
}
.cat-help-link {
  color: rgb(var(--fg-strong));
  text-decoration: underline;
  text-underline-offset: 2px;
}

.icon-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  padding-top: 0.25rem;
}
.icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 1.1rem;
  cursor: pointer;
  transition: all 0.12s;
}
.icon-chip:hover {
  border-color: rgb(var(--line-strong));
  color: rgb(var(--fg-strong));
}
.icon-chip--on {
  border-color: rgb(var(--fg-default));
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.06);
}

@media (max-width: 480px) {
  .cat-form-row--split {
    grid-template-columns: 1fr;
  }
}
</style>
