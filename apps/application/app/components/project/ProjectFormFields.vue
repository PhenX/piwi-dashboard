<script setup lang="ts">
/**
 * Shared field set for the project create + edit forms so the two never drift.
 * Render inside a `<UForm>` (the parent owns the schema, submit and footer).
 *
 * The field set is API-driven and gated by `mode`:
 * - `create` shows the immutable `name` (POST /api/projects only accepts
 *   name/label/description/tags).
 * - `edit` shows `diagnosisInstructions` + `scmToken` (PUT /api/projects/[id]
 *   only; the SCM token is encrypted against an existing project).
 * Shared in both: label, description, tags.
 */
import type { TagInfo } from '~~/types/api';

withDefaults(
  defineProps<{
    mode: 'create' | 'edit';
    allTags: TagInfo[];
    /** Edit mode: whether a SCM token is already stored (adjusts placeholder/help). */
    hasToken?: boolean;
  }>(),
  { hasToken: false },
);

const emit = defineEmits<{ 'tag-created': [] }>();

const name = defineModel<string>('name', { default: '' });
const label = defineModel<string>('label', { default: '' });
const description = defineModel<string>('description', { default: '' });
const diagnosisInstructions = defineModel<string>('diagnosisInstructions', { default: '' });
const scmToken = defineModel<string>('scmToken', { default: '' });
const defaultBranch = defineModel<string>('defaultBranch', { default: '' });
const tags = defineModel<TagInfo[]>('tags', { default: () => [] });
</script>

<template>
  <div class="space-y-5">
    <UFormField
      v-if="mode === 'create'"
      label="Project name"
      name="name"
      required
      description="A unique identifier used to match test results from the reporter."
    >
      <UInput v-model="name" placeholder="e.g. my-app" class="w-full" />
    </UFormField>

    <UFormField
      label="Display label"
      name="label"
      description="A friendly name shown in the UI (defaults to project name if not set)."
    >
      <UInput v-model="label" placeholder="e.g. My Application" class="w-full" />
    </UFormField>

    <UFormField label="Description" name="description" description="Optional description of this project.">
      <UTextarea v-model="description" placeholder="Enter project description" :rows="3" class="w-full" />
    </UFormField>

    <template v-if="mode === 'edit'">
      <UFormField name="diagnosisInstructions" description="Combined with the global instructions from Settings → AI.">
        <template #label>
          <span class="inline-flex items-center gap-1">
            AI diagnosis instructions <HelpHint topic="project.ai-instructions" />
          </span>
        </template>
        <UTextarea
          v-model="diagnosisInstructions"
          placeholder="e.g. This project tests the payment checkout flow. The backend uses Stripe for payments and the payment API is at /api/v2/payments. Database errors are usually caused by connection pool exhaustion under load."
          :rows="5"
          class="w-full font-mono text-sm"
        />
      </UFormField>

      <UFormField
        name="scmToken"
        :description="
          hasToken
            ? 'Leave empty to keep the stored token, enter a new value to replace it, or save empty to remove it'
            : 'For GitHub, GitLab, or Bitbucket. Falls back to the global SCM token if not set.'
        "
      >
        <template #label>
          <span class="inline-flex items-center gap-1">SCM token <HelpHint topic="project.scm-token" /></span>
        </template>
        <UInput
          v-model="scmToken"
          type="password"
          :placeholder="hasToken ? '•••••••• (unchanged)' : 'ghp_..., glpat-..., or bitbucket token'"
          class="w-full font-mono"
        />
      </UFormField>

      <UFormField
        label="Default branch"
        name="defaultBranch"
        description="Baselines, flakiness and trends fall back to this branch. Leave empty to resolve it from the SCM provider (else 'main')."
      >
        <UInput v-model="defaultBranch" placeholder="e.g. main" class="w-full font-mono" />
      </UFormField>
    </template>

    <UFormField
      label="Tags"
      name="tags"
      description="Select existing tags or type a new name and press Enter to create one."
    >
      <TagsSelect v-model="tags" :all-tags="allTags" class="w-full" @tag-created="emit('tag-created')" />
    </UFormField>
  </div>
</template>
