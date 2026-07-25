<script setup lang="ts">
/**
 * The quarantine list, its exit progress, and the debt it represents.
 *
 * The streak column is the point of the view: a quarantined test still runs, so
 * it can earn its way out, and the table says when it has rather than waiting
 * to be asked.
 */
const props = defineProps<{ projectId: string | number; projectName?: string | null }>();

interface QuarantineEntry {
  id: number;
  testCaseId: number;
  title: string;
  filePath: string;
  reason: string | null;
  source: string;
  owner: string | null;
  tags: string[] | null;
  ageMs: number;
  consecutivePasses: number;
  releaseProposed: boolean;
  runsSinceQuarantine: number;
}

interface Candidate {
  testCaseId: number;
  title: string;
  filePath: string;
  flakyScore: number;
  wastedCiMinutes: number;
  rationale: string;
}

interface QuarantineResponse {
  entries: QuarantineEntry[];
  debt: { active: number; readyToRelease: number; oldestAgeMs: number; stillFailing: number };
  candidates: Candidate[];
  releaseAfterConsecutivePasses: number;
}

const toast = useToast();
const busy = ref<number | null>(null);

const { data, status, error, refresh } = await useFetch<QuarantineResponse>(
  () => `/api/projects/${props.projectId}/quarantine`,
);

function formatAge(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${Math.max(1, hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

async function quarantine(testCaseId: number, reason: string) {
  busy.value = testCaseId;
  try {
    await $fetch(`/api/projects/${props.projectId}/quarantine`, {
      method: 'POST',
      body: { testCaseId, reason, source: 'proposed' },
    });
    toast.add({ title: 'Quarantined', color: 'success' });
    await refresh();
  } catch {
    toast.add({ title: 'Could not quarantine that test', color: 'error' });
  } finally {
    busy.value = null;
  }
}

async function release(testCaseId: number) {
  busy.value = testCaseId;
  try {
    await $fetch(`/api/projects/${props.projectId}/quarantine/${testCaseId}`, { method: 'DELETE' });
    toast.add({ title: 'Released', color: 'success' });
    await refresh();
  } catch {
    toast.add({ title: 'Could not release that test', color: 'error' });
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="space-y-6">
    <SectionCard title="Quarantine" icon="i-lucide-shield-alert" :count="data?.debt.active" help="project.quarantine">
      <template #subtitle>
        A quarantined test keeps running and keeps reporting — it is excluded from the CI gate's verdict and nothing
        else. That is what lets it earn its way back out.
      </template>

      <LoadingState v-if="status === 'pending'" />
      <ErrorState v-else-if="error" :text="String(error)" />

      <template v-else>
        <StatTileGrid v-if="data && data.debt.active > 0" class="mb-4">
          <StatTile label="Quarantined" :value="data.debt.active" />
          <StatTile
            label="Ready to release"
            :value="data.debt.readyToRelease"
            :value-class="data.debt.readyToRelease > 0 ? 'text-green-600 dark:text-green-400' : ''"
            hint="earned their way out"
          />
          <StatTile label="Still failing" :value="data.debt.stillFailing" hint="no passing streak" />
          <StatTile label="Oldest" :value="formatAge(data.debt.oldestAgeMs)" size="sm" />
        </StatTileGrid>

        <EmptyState
          v-if="!data || data.entries.length === 0"
          icon="i-lucide-shield-check"
          text="Nothing quarantined. Tests you quarantine appear here with their progress back out."
        />

        <TableScroller v-else>
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-muted">
              <tr>
                <th class="px-3 py-2">Test</th>
                <th class="px-3 py-2">Reason</th>
                <th class="px-3 py-2 whitespace-nowrap">Streak</th>
                <th class="px-3 py-2 whitespace-nowrap">Age</th>
                <th class="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in data.entries" :key="entry.id" class="border-t border-default">
                <td class="px-3 py-2 min-w-0">
                  <NuxtLink :to="`/test-cases/${entry.testCaseId}`" class="text-primary hover:underline font-medium">
                    {{ entry.title }}
                  </NuxtLink>
                  <SharedTestMetaBadges
                    :tags="entry.tags"
                    :meta="{ owner: entry.owner ?? undefined }"
                    :max-tags="3"
                    class="ml-1"
                  />
                  <div class="text-xs text-muted">
                    <OpenInIdeLink :file-path="entry.filePath" :project-key="projectId" :project-name="projectName" />
                  </div>
                </td>
                <td class="px-3 py-2 text-muted">{{ entry.reason || '—' }}</td>
                <td class="px-3 py-2 whitespace-nowrap">
                  <UBadge v-if="entry.releaseProposed" color="success" variant="soft" size="xs">
                    {{ entry.consecutivePasses }} green — ready
                  </UBadge>
                  <span v-else-if="entry.runsSinceQuarantine === 0" class="text-xs text-muted">not run yet</span>
                  <span v-else class="text-xs">
                    {{ entry.consecutivePasses }} / {{ data.releaseAfterConsecutivePasses }}
                  </span>
                </td>
                <td class="px-3 py-2 whitespace-nowrap text-muted">{{ formatAge(entry.ageMs) }}</td>
                <td class="px-3 py-2 text-right">
                  <UButton
                    size="xs"
                    :color="entry.releaseProposed ? 'primary' : 'neutral'"
                    variant="soft"
                    :loading="busy === entry.testCaseId"
                    @click="release(entry.testCaseId)"
                  >
                    Release
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </TableScroller>
      </template>
    </SectionCard>

    <SectionCard
      v-if="data && data.candidates.length > 0"
      title="Worth quarantining"
      icon="i-lucide-lightbulb"
      :count="data.candidates.length"
    >
      <template #subtitle>
        Ranked by the CI minutes their flakiness wastes, not by how often they flake — a test that flakes constantly but
        finishes instantly costs nothing.
      </template>

      <TableScroller>
        <table class="w-full text-sm">
          <tbody>
            <tr v-for="candidate in data.candidates" :key="candidate.testCaseId" class="border-t border-default">
              <td class="px-3 py-2 min-w-0">
                <NuxtLink :to="`/test-cases/${candidate.testCaseId}`" class="text-primary hover:underline font-medium">
                  {{ candidate.title }}
                </NuxtLink>
                <div class="text-xs text-muted">{{ candidate.rationale }}</div>
              </td>
              <td class="px-3 py-2 text-right whitespace-nowrap">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  :loading="busy === candidate.testCaseId"
                  @click="quarantine(candidate.testCaseId, candidate.rationale)"
                >
                  Quarantine
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </TableScroller>
    </SectionCard>
  </div>
</template>
