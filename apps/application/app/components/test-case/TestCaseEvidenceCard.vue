<script setup lang="ts">
/**
 * "Failure evidence" for a single test-run case — everything captured at the moment
 * of failure, grouped into one foldable card: screenshots, video, traces and any
 * non-media attachments. Folds to a one-line peek so the whole failure reads at a
 * glance, and mirrors the cluster page's evidence grouping.
 */
import type { AttachmentInfo, TraceInfo } from '~~/types/api';
import { isImageFile, isVideoFile } from '~/utils/text-format';

const props = defineProps<{
  attachments: AttachmentInfo[];
  traces: TraceInfo[];
  storageKey: string;
}>();

const config = useRuntimeConfig();

// Both lists are optional in practice — a case with no attachments or no traces
// can arrive with the prop undefined — so read them through null-safe locals to
// keep the counts numeric (an undefined `.length` turns the total into NaN).
const attachments = computed(() => (Array.isArray(props.attachments) ? props.attachments : []));
const traces = computed(() => (Array.isArray(props.traces) ? props.traces : []));

const screenshotCount = computed(() => attachments.value.filter((a) => isImageFile(a.path, a.contentType)).length);
const videoCount = computed(() => attachments.value.filter((a) => isVideoFile(a.path, a.contentType)).length);
const otherAttachments = computed(() =>
  attachments.value.filter((a) => !isImageFile(a.path, a.contentType) && !isVideoFile(a.path, a.contentType)),
);

const totalCount = computed(
  () => screenshotCount.value + videoCount.value + traces.value.length + otherAttachments.value.length,
);

const peek = computed(() => {
  const parts: string[] = [];
  if (screenshotCount.value) parts.push(`${screenshotCount.value} screenshot${screenshotCount.value === 1 ? '' : 's'}`);
  if (videoCount.value) parts.push(`${videoCount.value} video${videoCount.value === 1 ? '' : 's'}`);
  if (traces.value.length) parts.push(`${traces.value.length} trace${traces.value.length === 1 ? '' : 's'}`);
  if (otherAttachments.value.length) {
    parts.push(`${otherAttachments.value.length} file${otherAttachments.value.length === 1 ? '' : 's'}`);
  }
  return parts.join(' · ') || 'No evidence captured';
});

function fileUrl(path: string, contentType?: string | null): string {
  return fileApiUrl(path, contentType, config.app?.baseURL);
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

// Forward reveal so a diagnosis citation can unfold + scroll to this card.
const card = ref<{ reveal?: () => void } | null>(null);
defineExpose({ reveal: () => card.value?.reveal?.() });
</script>

<template>
  <CollapsibleSectionCard
    ref="card"
    :storage-key="storageKey"
    icon="i-lucide-camera"
    title="Failure evidence"
    :count="totalCount"
    help="case.evidence"
  >
    <template #folded>{{ peek }}</template>

    <div class="space-y-3">
      <TestEvidenceScreenshots :attachments="attachments" />
      <TestEvidenceVideos :attachments="attachments" />
      <TestEvidenceTraces :traces="traces" />

      <!-- Non-media attachments -->
      <TestEvidenceSection
        v-if="otherAttachments.length"
        icon="i-lucide-paperclip"
        label="Attachments"
        :count="otherAttachments.length"
        :collapsible="false"
      >
        <div class="divide-y divide-default">
          <div v-for="att in otherAttachments" :key="att.id" class="flex items-center justify-between gap-2 px-3 py-2">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-file" class="size-4 text-gray-400 shrink-0" />
              <span class="text-sm truncate">{{ fileName(att.path) }}</span>
              <span v-if="att.size" class="text-xs text-gray-400 shrink-0">{{ formatBytes(att.size) }}</span>
            </div>
            <UButton
              :to="fileUrl(att.path, att.contentType)"
              target="_blank"
              icon="i-lucide-external-link"
              size="xs"
              color="neutral"
              variant="soft"
              label="Open"
            />
          </div>
        </div>
      </TestEvidenceSection>

      <FeatureUnavailable
        v-if="totalCount === 0"
        icon="i-lucide-camera-off"
        title="No screenshots, video or traces captured"
        text="Evidence comes from Playwright's own capture settings — set trace, screenshot and video in your config (trace: 'retain-on-failure' is the usual starting point)."
        doc="reporter"
      />
    </div>
  </CollapsibleSectionCard>
</template>
