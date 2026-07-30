/** Replace every character outside `[A-Za-z0-9._-]` with an underscore, so an
 * uploaded name is safe to use as a storage path segment. */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Reduce a (possibly hostile) name to a single safe path segment, or `null`
 * when nothing usable remains. The result contains only `[A-Za-z0-9._-]` and is
 * never `.` or `..`, so appending it to a storage prefix can never escape it. */
export function safeStorageSegment(name: string): string | null {
  const safe = sanitizeFilename(name);
  return safe && safe !== '.' && safe !== '..' ? safe : null;
}
