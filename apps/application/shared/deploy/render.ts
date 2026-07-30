import {
  commentBlock,
  DATA_MOUNT,
  DEFAULT_DISK_GB,
  DEFAULT_IMAGE,
  DEFAULT_NAME,
  HEALTH_PATH,
  qualifyImage,
  quoteYamlValue,
  type EmitOptions,
  type EnvEntry,
} from '#shared/env-format-base';

/**
 * Render Blueprint (`render.yaml`). Render reads it from the repository root,
 * which is what makes its Deploy button a genuine one-click: nothing to
 * configure by hand. A persistent disk requires a paid instance type, so the
 * plan is deliberately not `free` — a free web service loses every trace and
 * the SQLite database on each redeploy.
 */
export function emitRenderBlueprint(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const name = opts.name ?? DEFAULT_NAME;
  const lines = [
    'services:',
    '  - type: web',
    `    name: ${name}`,
    '    runtime: image',
    '    image:',
    `      url: ${qualifyImage(opts.image ?? DEFAULT_IMAGE)}`,
    '    plan: starter',
    `    region: ${opts.region ?? 'oregon'}`,
    // Button-deployed blueprints should not redeploy on every push to this repository.
    '    autoDeploy: false',
    `    healthCheckPath: ${HEALTH_PATH}`,
    '    disk:',
    `      name: ${name}-data`,
    `      mountPath: ${DATA_MOUNT}`,
    `      sizeGB: ${opts.diskGB ?? DEFAULT_DISK_GB}`,
  ];
  const envLines: string[] = [];
  for (const entry of entries) {
    // Render exposes a service's host but not a scheme-qualified URL, and the
    // app already infers its origin from the request host.
    if (entry.platformValue === 'url') {
      envLines.push(`      # Set ${entry.name} to the service's public URL once Render has assigned it.`);
      continue;
    }
    if (entry.comment) envLines.push(`      # ${entry.comment}`);
    envLines.push(`      - key: ${entry.name}`);
    envLines.push(
      entry.platformValue === 'generate'
        ? '        generateValue: true'
        : `        value: ${quoteYamlValue(entry.value)}`,
    );
  }
  if (envLines.length) lines.push('    envVars:', ...envLines);
  return commentBlock(opts.header) + lines.join('\n') + '\n';
}
