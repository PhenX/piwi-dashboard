/** Replace every character outside `[A-Za-z0-9._-]` with an underscore, so an
 * uploaded name is safe to use as a storage path segment. */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}
