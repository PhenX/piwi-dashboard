import { getDatabase } from '../database';
import { getStorage } from '../storage';
import { deleteProjectData } from '#shared/handlers/projects';
import { testCaseCache } from './test-case-cache';

/**
 * Permanently delete a project and all its associated data.
 *
 * Deletes storage first (entire project-{id}/ directory), then clears DB rows
 * in FK order via `deleteProjectData`. Server-only: touches the real
 * filesystem/S3 storage adapter, so it must not be imported by shared/demo
 * code (demo calls `deleteProjectData` directly against its in-browser DB).
 */
export async function deleteProject(projectId: number): Promise<void> {
  const db = await getDatabase();
  const storage = getStorage();

  // Delete all project files in one shot — covers reports, blobs, trace-resources
  await storage.deleteDirectory(`project-${projectId}`);

  await deleteProjectData(db, projectId);

  testCaseCache.invalidate(projectId);
}
