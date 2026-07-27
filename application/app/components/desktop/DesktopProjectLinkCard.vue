<script setup lang="ts">
/**
 * Desktop shell only: manage the folder on this machine linked to a project.
 * The link powers "run locally" retries and resolves "Open in IDE" paths
 * without manual workspace-root configuration. Renders nothing without the
 * IPC bridge, so the project page can mount it unconditionally.
 */
const props = defineProps<{ projectId: string | number }>();

const { available, link, busy, pickAndLink, unlink } = useDesktopProjectLink(() => props.projectId);
</script>

<template>
  <SectionCard v-if="available" icon="i-lucide-folder-symlink" title="Local folder">
    <template #subtitle>
      Link this project to its checkout on this machine to retry failures from here and open files in your IDE.
    </template>

    <div v-if="link" class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0 text-sm">
        <UIcon
          :name="link.exists ? 'i-lucide-folder-check' : 'i-lucide-folder-x'"
          class="size-4 shrink-0"
          :class="link.exists ? 'text-success' : 'text-warning'"
        />
        <code class="text-xs break-all">{{ link.path }}</code>
        <UBadge v-if="!link.exists" color="warning" variant="subtle" size="sm">missing</UBadge>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-folder-search"
          :loading="busy"
          @click="pickAndLink"
        >
          Change
        </UButton>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-unlink" :disabled="busy" @click="unlink">
          Unlink
        </UButton>
      </div>
    </div>

    <div v-else class="flex items-center justify-between gap-3">
      <p class="text-sm text-muted">No folder linked yet.</p>
      <UButton size="xs" icon="i-lucide-folder-plus" :loading="busy" @click="pickAndLink">Choose folder…</UButton>
    </div>
  </SectionCard>
</template>
