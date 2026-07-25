/**
 * Drives the blob-report import on the client.
 *
 * The browser owns the batching: one archive per request, uploaded in sequence,
 * so a year of history never becomes one enormous body the server has to buffer.
 * Everything that can be judged without spending an upload is judged first —
 * the size limit is fetched before any file is read, and archives already in the
 * project are recognised from their digest — so the failure modes the user
 * actually hits are reported before the bytes move, not after.
 */

import type {
  ImportCheckResponse,
  ImportCheckResult,
  ImportCheckStatus,
  ImportRunResponse,
} from '#shared/import.types';

export type ImportFileState =
  | 'hashing'
  | 'checking'
  /** Cleared the pre-flight; waiting for the user to start the import. */
  | 'ready'
  | 'uploading'
  | 'imported'
  | 'duplicate'
  | 'too-large'
  | 'invalid'
  | 'failed';

export interface ImportFileEntry {
  id: number;
  file: File;
  name: string;
  size: number;
  state: ImportFileState;
  /** Why this file is not `ready`, or what went wrong during upload. */
  message?: string;
  /** Fraction 0–1 of the current phase, while `hashing` or `uploading`. */
  progress: number;
  hash?: string;
  result?: ImportRunResponse;
}

/** Aggregate progress across a running import, for the batch counter. */
export interface ImportBatchProgress {
  /** Archives already resolved this run — imported, duplicate or failed. */
  done: number;
  /** Archives this run set out to upload. */
  total: number;
}

/** States that still consume an upload when the user starts the import. */
const UPLOADABLE: ImportFileState[] = ['ready', 'failed'];

/** Map a pre-flight verdict onto the entry state it produces. */
const STATE_BY_VERDICT: Record<ImportCheckStatus, ImportFileState> = {
  ok: 'ready',
  duplicate: 'duplicate',
  'too-large': 'too-large',
  invalid: 'invalid',
};

export function useBlobReportImport(projectName: Ref<string | undefined>) {
  const entries = ref<ImportFileEntry[]>([]);
  const maxBytes = ref<number | null>(null);
  const limitError = ref<string | null>(null);
  const importing = ref(false);
  /**
   * Digests need `crypto.subtle`, which browsers withhold from pages served
   * over plain HTTP. Without it the pre-flight cannot recognise an archive the
   * project already has; the server still refuses the duplicate after upload,
   * so the import stays correct, only less efficient.
   */
  const canHash = computed(() => typeof globalThis.crypto?.subtle?.digest === 'function');

  let nextId = 1;

  const readyCount = computed(() => entries.value.filter((e) => UPLOADABLE.includes(e.state)).length);
  const importedCount = computed(() => entries.value.filter((e) => e.state === 'imported').length);
  const busy = computed(() => entries.value.some((e) => e.state === 'hashing' || e.state === 'checking'));

  /**
   * Aggregate progress for the batch counter. A long import is a sequence of
   * per-row states; without a running total the page gives no sense of how much
   * of the batch is left.
   */
  const batch = ref<ImportBatchProgress>({ done: 0, total: 0 });

  /**
   * Fetch the server's size limit before any file is read, so an oversized
   * archive is rejected without hashing or uploading it. Doubles as an early
   * permission check: a user who may not import learns it now.
   */
  async function loadLimit(): Promise<void> {
    if (!projectName.value) return;
    try {
      const response = await $fetch<ImportCheckResponse>('/api/test-runs/import/check', {
        method: 'POST',
        body: { projectName: projectName.value, files: [] },
      });
      maxBytes.value = response.maxBytes;
      limitError.value = null;
    } catch (error) {
      limitError.value = errorMessage(error, 'Could not reach the server to read its upload limit.');
    }
  }

  async function addFiles(selected: File[]): Promise<void> {
    const staged: ImportFileEntry[] = selected.map((file) => ({
      id: nextId++,
      file,
      name: file.name,
      size: file.size,
      state: 'hashing',
      progress: 0,
    }));
    entries.value = [...entries.value, ...staged];

    // Work through the reactive proxies the ref just created, not the plain
    // objects staged above — mutating those would update the data without
    // telling the view about it, freezing every row on its initial state.
    const added = entries.value.slice(-staged.length);

    // Anything already over the limit is settled here — never read, never sent.
    const withinLimit: ImportFileEntry[] = [];
    for (const entry of added) {
      if (maxBytes.value != null && entry.size > maxBytes.value) {
        entry.state = 'too-large';
        entry.message = `${formatBytes(entry.size)} exceeds this server's ${formatBytes(maxBytes.value)} limit.`;
      } else if (entry.size === 0) {
        entry.state = 'invalid';
        entry.message = 'The file is empty.';
      } else if (!entry.name.toLowerCase().endsWith('.zip')) {
        entry.state = 'invalid';
        entry.message = 'Expected a .zip blob report (blob-report/report-*.zip).';
      } else {
        withinLimit.push(entry);
      }
    }

    if (withinLimit.length === 0) return;

    if (!canHash.value) {
      // No digest, so no duplicate pre-check — the server decides after upload.
      for (const entry of withinLimit) entry.state = 'ready';
      return;
    }

    // Sequential: hashing needs the whole file in memory, and several large
    // archives at once is the one way this page can exhaust a tab.
    for (const entry of withinLimit) {
      try {
        entry.progress = 0;
        entry.hash = await sha256(entry.file, (p) => {
          entry.progress = p;
        });
        entry.state = 'checking';
      } catch (error) {
        entry.state = 'failed';
        entry.message = errorMessage(error, 'Could not read the file.');
      } finally {
        entry.progress = 0;
      }
    }

    await runPreflight(withinLimit.filter((e) => e.state === 'checking'));
  }

  /** Ask the server which of these archives are worth uploading. */
  async function runPreflight(pending: ImportFileEntry[]): Promise<void> {
    if (pending.length === 0 || !projectName.value) return;

    try {
      const response = await $fetch<ImportCheckResponse>('/api/test-runs/import/check', {
        method: 'POST',
        body: {
          projectName: projectName.value,
          files: pending.map((e) => ({ name: e.name, size: e.size, hash: e.hash })),
        },
      });

      maxBytes.value = response.maxBytes;
      response.results.forEach((result: ImportCheckResult, index: number) => {
        const entry = pending[index];
        if (!entry) return;
        entry.state = STATE_BY_VERDICT[result.status] ?? 'ready';
        entry.message = result.message;
        if (result.testRunId) entry.result = { testRunId: result.testRunId } as ImportRunResponse;
      });
    } catch (error) {
      // A pre-flight failure must not block the import — the server re-checks
      // everything anyway, so fall through and let the upload decide.
      const message = errorMessage(error, 'Pre-flight check failed.');
      for (const entry of pending) {
        entry.state = 'ready';
        entry.message = `${message} Importing will still verify it.`;
      }
    }
  }

  /** Upload every archive that cleared the pre-flight, one at a time. */
  async function startImport(): Promise<void> {
    if (importing.value || !projectName.value) return;
    importing.value = true;

    const queued = entries.value.filter((e) => UPLOADABLE.includes(e.state));
    batch.value = { done: 0, total: queued.length };

    // Traces carry no run of their own, so the batch itself is the run: every
    // trace uploaded under one group joins a single run. Derived from the file
    // digests rather than generated, so re-importing the same selection reuses
    // that run instead of building a second copy of it. Blob reports ignore it.
    const group = await groupKeyFor(queued);

    try {
      for (const entry of queued) {
        entry.state = 'uploading';
        entry.message = undefined;
        entry.progress = 0;

        try {
          const result = await uploadArchive(projectName.value, entry, group, (p) => {
            entry.progress = p;
          });
          entry.result = result;
          entry.state = result.status === 'duplicate' ? 'duplicate' : 'imported';
          entry.message = result.status === 'duplicate' ? 'Already imported into this project.' : undefined;
        } catch (error) {
          entry.state = 'failed';
          entry.message = errorMessage(error, 'The import failed.');
        } finally {
          entry.progress = 0;
          batch.value = { ...batch.value, done: batch.value.done + 1 };
        }
      }
    } finally {
      importing.value = false;
    }
  }

  function remove(id: number): void {
    entries.value = entries.value.filter((e) => e.id !== id);
  }

  function clearFinished(): void {
    entries.value = entries.value.filter((e) => !['imported', 'duplicate'].includes(e.state));
  }

  return {
    entries,
    maxBytes,
    limitError,
    importing,
    canHash,
    readyCount,
    importedCount,
    busy,
    batch,
    loadLimit,
    addFiles,
    startImport,
    remove,
    clearFinished,
  };
}

/**
 * A stable identity for one batch: the digest of its files' digests, order
 * independent. Returns null when the files were never hashed (no `crypto.subtle`
 * on an insecure origin), in which case each trace imports as its own run.
 */
async function groupKeyFor(entries: ImportFileEntry[]): Promise<string | null> {
  const hashes = entries.map((entry) => entry.hash).filter((hash): hash is string => Boolean(hash));
  if (hashes.length === 0) return null;

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...hashes].sort().join('')));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hex SHA-256 of a file's bytes, matching what the server computes on receipt.
 *
 * The file is streamed into one pre-allocated buffer rather than handed to
 * `File.arrayBuffer()`: reading a large archive is the slow half of this step,
 * so streaming is what makes progress reportable, and filling a buffer we sized
 * up front avoids holding the file twice at the moment of the copy.
 *
 * `crypto.subtle` has no incremental API, so the digest itself is one opaque
 * call at the end — fast next to the read (~165 MB/s measured), and reported as
 * the last slice of progress.
 */
async function sha256(file: File, onProgress: (fraction: number) => void): Promise<string> {
  const bytes = new Uint8Array(file.size);
  const reader = file.stream().getReader();
  let offset = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, offset);
    offset += value.length;
    // Hold back the last sliver for the digest, so the bar does not sit at 100%
    // through a step that has not started.
    onProgress(file.size ? (offset / file.size) * 0.9 : 0.9);
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  onProgress(1);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * POST one archive with upload progress. `$fetch` cannot report progress, and
 * these bodies are large enough that a silent multi-minute wait reads as a hang.
 */
function uploadArchive(
  projectName: string,
  entry: ImportFileEntry,
  group: string | null,
  onProgress: (fraction: number) => void,
): Promise<ImportRunResponse> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('projectName', projectName);
    if (group) body.append('importGroup', group);
    body.append('archive', entry.file, entry.name);

    const request = new XMLHttpRequest();
    request.open('POST', '/api/test-runs/import');
    request.responseType = 'json';

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });

    request.addEventListener('load', () => {
      const payload = request.response as Record<string, unknown> | null;
      if (request.status >= 200 && request.status < 300) {
        resolve(payload as unknown as ImportRunResponse);
        return;
      }
      const detail = typeof payload?.message === 'string' ? payload.message : null;
      reject(new Error(detail ?? httpFallbackMessage(request.status)));
    });

    request.addEventListener('error', () => reject(new Error('The connection dropped during the upload.')));
    request.addEventListener('abort', () => reject(new Error('The upload was cancelled.')));
    request.addEventListener('timeout', () => reject(new Error('The upload timed out.')));

    request.send(body);
  });
}

/** Wording for statuses a proxy can produce without a JSON body of its own. */
function httpFallbackMessage(status: number): string {
  if (status === 413) return 'The server (or a proxy in front of it) rejected the archive as too large.';
  if (status === 401 || status === 403) return 'You do not have permission to import into this project.';
  if (status === 0) return 'The connection dropped during the upload.';
  if (status >= 500) return `The server failed while importing (HTTP ${status}).`;
  return `The import was rejected (HTTP ${status}).`;
}

function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: string } })?.data;
  if (typeof data?.message === 'string' && data.message) return data.message;
  const message = (error as Error)?.message;
  return message || fallback;
}
