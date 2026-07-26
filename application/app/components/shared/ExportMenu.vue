<script setup lang="ts">
const props = defineProps<{
  /** API path of the export endpoint, e.g. `/api/failure-clusters/12/export`. */
  endpoint: string;
  /** Used only for the desktop shell's fallback filename; the server names the file. */
  baseName: string;
}>();

const { download } = useDesktopDownload();
const open = ref(false);

/**
 * These URLs are opened directly rather than going through `$fetch`, so the
 * app's base path has to be applied by hand — the demo is served from `/demo/`
 * and its service worker only intercepts requests under that prefix. A
 * root-relative `/api/...` would escape the scope entirely and 404.
 */
const base = computed(() => (useRuntimeConfig().app?.baseURL ?? '/').replace(/\/$/, ''));

function exportUrl(query: string): string {
  return `${base.value}${props.endpoint}?${query}`;
}

async function run(format: 'html' | 'zip' | 'json' | 'md') {
  open.value = false;
  // ZIP is the only binary format; the rest are text the shell can write directly.
  await download(exportUrl(`format=${format}`), `${props.baseName}.${format}`, { binary: format === 'zip' });
}

/**
 * PDF is the HTML report rendered in a tab and printed, so it opens the page
 * rather than downloading it — the server serves `print=1` inline for this.
 */
function printReport() {
  open.value = false;
  window.open(exportUrl('format=html&print=1'), '_blank');
}
</script>

<template>
  <UPopover v-model:open="open">
    <UButton icon="i-lucide-download" size="xs" color="neutral" variant="outline" title="Export for offline reading">
      Export
    </UButton>

    <template #content>
      <div class="w-64 p-1 space-y-0.5">
        <div class="flex items-center justify-between px-2 pt-1 pb-1">
          <p class="text-xs font-medium text-gray-500">Offline export</p>
          <HelpHint topic="export.offline" />
        </div>

        <UButton
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-file-code"
          title="One self-contained HTML file with screenshots and video embedded"
          @click="run('html')"
        >
          HTML — single file
        </UButton>

        <UButton
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-file-archive"
          title="Report plus the raw artifacts, including trace archives and data.json"
          @click="run('zip')"
        >
          ZIP — with all evidence
        </UButton>

        <UButton
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-printer"
          title="Opens the report with your browser's print dialog, for Save as PDF"
          @click="printReport"
        >
          PDF — via print
        </UButton>

        <USeparator class="my-1" />

        <UButton
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-file-text"
          title="Text summary for pasting into an issue"
          @click="run('md')"
        >
          Markdown
        </UButton>

        <UButton
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-file-json"
          title="Everything the report contains, machine-readable"
          @click="run('json')"
        >
          JSON
        </UButton>
      </div>
    </template>
  </UPopover>
</template>
