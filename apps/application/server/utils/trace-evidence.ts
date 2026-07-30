/**
 * Node-only glue for the trace-derived evidence views (full call stack, full
 * network trace, body previews): storage access, ZIP inflation and the
 * resource reader over the deduplicated pool. The pure parsing/building lives
 * in the node-free `trace-insights.ts` (shared with the browser demo). No
 * re-exports: Nitro auto-imports every server/utils export.
 */
import { and, eq } from 'drizzle-orm';
import { files } from '../database/schema';
import { getStorage } from '../storage';
import { parseZip, type ZipEntry } from './trace-zip';
import { parseTraceTexts, traceFileRank, type ParsedTraceData } from './trace-events';
import {
  buildTraceBodyPreview,
  buildTraceCallStack,
  buildTraceNetwork,
  matchNetworkBodySha1,
  parseNetworkTexts,
  parseStacksTexts,
  type TraceResourceReader,
  type TraceResourceSnapshot,
  type TraceStacksIndex,
} from './trace-insights';
import type { DbClient } from '../database';
import type { TraceBodyResponse, TraceCallStackResponse, TraceNetworkResponse } from '../../types/api';

/** Path of the execution's stored (slim) trace blob, or null when no trace was uploaded. */
export async function resolveCaseTraceBlobPath(db: DbClient, testRunsCaseId: number): Promise<string | null> {
  const traceFiles = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, testRunsCaseId), eq(files.type, 'trace')))
    .limit(1);
  return traceFiles[0]?.path || null;
}

interface TraceBundle {
  parsed: ParsedTraceData | null;
  stacks: TraceStacksIndex | null;
  network: TraceResourceSnapshot[];
  readResource: TraceResourceReader;
}

/**
 * Load a stored trace and split its streams once. Handles both layouts: the
 * slim blob (events only; `resources/*` live in the project pool listed by the
 * sibling manifest) and a legacy/fallback full ZIP (resources inline).
 */
async function loadTraceBundle(blobPath: string): Promise<TraceBundle | null> {
  const storage = getStorage();
  let entries: ZipEntry[];
  try {
    entries = await parseZip(await storage.readFile(blobPath));
  } catch {
    return null;
  }

  const byRank = (a: ZipEntry, b: ZipEntry) => traceFileRank(a.name) - traceFileRank(b.name);
  const traceTexts = entries
    .filter((e) => e.name.endsWith('.trace'))
    .sort(byRank)
    .map((e) => e.data.toString('utf8'));
  const stacksTexts = entries.filter((e) => e.name.endsWith('.stacks')).map((e) => e.data.toString('utf8'));
  const networkTexts = entries.filter((e) => e.name.endsWith('.network')).map((e) => e.data.toString('utf8'));

  const parsed = traceTexts.length > 0 ? parseTraceTexts(traceTexts) : null;
  const stacks = stacksTexts.length > 0 ? parseStacksTexts(stacksTexts) : null;
  const network = networkTexts.length > 0 ? parseNetworkTexts(networkTexts) : [];

  // Resource pool lookup: the blob's manifest lists every `resources/` name the
  // original ZIP carried; a legacy full ZIP keeps them inline instead.
  const inZip = new Map(
    entries.filter((e) => e.name.startsWith('resources/')).map((e) => [e.name.slice('resources/'.length), e.data]),
  );
  const projectPrefix = blobPath.match(/^(project-\d+)\//)?.[1] ?? null;
  let manifestNames: string[] | null = null;
  if (blobPath.endsWith('.zip') && projectPrefix) {
    try {
      const manifestRaw = await storage.readFile(blobPath.replace(/\.zip$/, '.manifest.json'));
      const manifest = JSON.parse(manifestRaw.toString('utf8')) as { resources?: unknown };
      if (Array.isArray(manifest.resources)) manifestNames = manifest.resources.map((r) => String(r));
    } catch {
      // No manifest — a raw/legacy trace; pool lookups are skipped.
    }
  }

  const readResource: TraceResourceReader = async (name) => {
    for (const candidate of resourceNameCandidates(name, inZip.keys())) {
      const data = inZip.get(candidate);
      if (data) return data;
    }
    if (!projectPrefix) return null;
    const poolCandidates = manifestNames
      ? resourceNameCandidates(name, manifestNames)
      : // Without a manifest only exact-shaped probes are possible.
        resourceNameCandidates(name, []);
    for (const candidate of poolCandidates) {
      try {
        return await storage.readFile(`${projectPrefix}/trace-resources/${candidate}`);
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };

  return { parsed, stacks, network, readResource };
}

/**
 * Resolve the stored spellings a resource may have: exact, and — because
 * `_sha1` refs sometimes include the file extension and sometimes don't —
 * the bare-hash / extension-bearing variants from a known-names listing.
 */
function resourceNameCandidates(requested: string, knownNames: Iterable<string>): string[] {
  const candidates = [requested];
  const bare = requested.split('.')[0]!;
  if (bare !== requested) candidates.push(bare);
  for (const known of knownNames) {
    if (known !== requested && known.split('.')[0] === bare) candidates.push(known);
  }
  return [...new Set(candidates)];
}

/** Full call stack of the failing action, with embedded source when the trace carries it. */
export async function getTraceCallStackFromBlob(
  blobPath: string,
  knownTestFilePath: string | null,
): Promise<TraceCallStackResponse> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle || !bundle.parsed) return { status: 'no-trace' };
  return buildTraceCallStack(bundle.parsed, bundle.stacks, bundle.readResource, { knownTestFilePath });
}

/** Full network activity from the trace's HAR-like stream. */
export async function getTraceNetworkFromBlob(blobPath: string): Promise<TraceNetworkResponse> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle) return { status: 'no-trace' };
  return buildTraceNetwork(bundle.parsed, bundle.network);
}

/** One body resource referenced by the trace's network stream, classified for preview. */
export async function getTraceNetworkBodyFromBlob(blobPath: string, requestedSha1: string): Promise<TraceBodyResponse> {
  const bundle = await loadTraceBundle(blobPath);
  if (!bundle) return { status: 'not-found' };
  const match = matchNetworkBodySha1(bundle.network, requestedSha1);
  if (!match) return { status: 'not-found' };
  const bytes = await bundle.readResource(match.name);
  if (!bytes) return { status: 'not-found' };
  return buildTraceBodyPreview(bytes, match.mimeType);
}
