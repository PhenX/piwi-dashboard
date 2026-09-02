<script setup lang="ts">
/**
 * Shows where the instance keeps its database and files on disk, with copy
 * buttons. Used on Settings → Storage (all builds) and Settings → About (the
 * desktop connection hub). Paths come from `/api/admin/stats`
 * (`databaseLocation` / `storageLocation`).
 */
defineProps<{
  database: string;
  storage: string;
}>();

const { copy } = useCopy();
</script>

<template>
  <SectionCard icon="i-lucide-folder-open" title="Data location">
    <template #subtitle> Where this instance keeps its database and files on disk. </template>

    <div class="space-y-4 text-sm">
      <div class="space-y-1">
        <div class="text-muted">Database</div>
        <div class="flex items-start gap-2">
          <code class="text-xs break-all flex-1">{{ database }}</code>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Copy database location"
            @click="copy(database, { toast: true })"
          />
        </div>
      </div>
      <div class="space-y-1">
        <div class="text-muted">File storage</div>
        <div class="flex items-start gap-2">
          <code class="text-xs break-all flex-1">{{ storage }}</code>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Copy storage location"
            @click="copy(storage, { toast: true })"
          />
        </div>
      </div>
    </div>
  </SectionCard>
</template>
