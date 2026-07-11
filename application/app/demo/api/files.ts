/**
 * Client-side file serving for demo mode.
 *
 * Serves the demo's committed binary assets (screenshots, trace archives,
 * videos under public/demo/) by fetching the built static assets and
 * returning them as binary data through the service worker.
 */

import { getDemoDbBaseUrl } from '../db.client';

/** Path prefixes (relative to public/) that demo mode is allowed to serve. */
const ALLOWED_PREFIXES = ['demo/screenshots/', 'demo/traces/', 'demo/videos/'];

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  zip: 'application/zip',
  webm: 'video/webm',
  mp4: 'video/mp4',
};

/**
 * Serve a demo file. For allowed paths under public/demo/, fetches the actual
 * file from the build output (resolved against the demo base URL, so it works
 * when the demo is deployed under a sub-path like /demo/) and returns it as
 * binary data.
 */
export async function apiGetDemoFile(apiPath: string): Promise<unknown> {
  const filePath = apiPath.replace(/^\/api\/files\//, '');

  if (!ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return { available: false, message: 'File not available in demo mode' };
  }

  try {
    const base = getDemoDbBaseUrl().replace(/\/$/, '');
    const response = await fetch(`${base}/${filePath}`);
    if (!response.ok) {
      return { available: false, message: 'File not found' };
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Convert to base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }

    const ext = filePath.toLowerCase().split('.').pop() || '';
    return {
      _binary: true,
      data: btoa(binary),
      contentType: CONTENT_TYPES[ext] || blob.type || 'application/octet-stream',
    };
  } catch {
    return { available: false, message: 'Failed to load file' };
  }
}
