/**
 * Pure emitters that turn a list of resolved environment variable values into
 * deployment-ready configuration snippets (.env file, docker run, Docker
 * Compose, Kubernetes, systemd, shell exports, hosting-platform manifests).
 *
 * Consumed by the docs-site configuration generator wizard (which imports this
 * module directly through the `#shared` alias wired into the VitePress build)
 * and by `scripts/generate-deploy-manifests.mjs`, so it MUST stay
 * dependency-free and browser-safe: no imports, no Node APIs. All
 * quoting/escaping rules live here so every surface renders identical, correct
 * output — covered by `tests/unit/env-format.test.ts`.
 */

export interface EnvEntry {
  /** Environment variable name (`A–Z`, `0–9`, `_`). */
  name: string;
  /** The exact string value the process should receive. */
  value: string;
  /** Secret values land in the Kubernetes `Secret` instead of the `ConfigMap`. */
  secret?: boolean;
  /** Optional one-line comment rendered above the entry where the format allows it. */
  comment?: string;
  /**
   * Lets a hosting platform supply the value instead of committing a literal:
   * `generate` asks it for a fresh random secret, `url` for the service's own
   * public URL. Only the hosting-platform emitters read this — every other
   * format needs a literal and falls back to `value`.
   */
  platformValue?: 'generate' | 'url';
}

export interface EmitOptions {
  /** Docker image reference used by the container formats. */
  image?: string;
  /** Container / Kubernetes resource base name. */
  name?: string;
  /** Comment lines prefixed to the output (each format uses its own comment syntax). */
  header?: readonly string[];
  /** Port the container listens on. */
  port?: number;
  /** Persistent-disk size in GB, where the platform wants one declared. */
  diskGB?: number;
  /** Platform region slug, in that platform's own vocabulary. */
  region?: string;
}

const DEFAULT_IMAGE = 'phenx/piwitests-server:latest';
const DEFAULT_NAME = 'piwi';

/** Where the container's persistent data (SQLite DB + report/trace storage) must be mounted. */
const DATA_MOUNT = '/app/.data';

/** Endpoint every platform health check polls — it verifies database connectivity. */
const HEALTH_PATH = '/api/health';

/** Port the container listens on unless `PORT` says otherwise. */
const DEFAULT_PORT = 3000;

/** Default persistent-disk size: traces and HTML reports dominate the budget. */
const DEFAULT_DISK_GB = 10;

/** Characters safe to leave unquoted in a dotenv value. */
const DOTENV_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quote a value for a `.env` file (also used for the systemd EnvironmentFile).
 * Values containing `$` prefer single quotes so dotenv/compose interpolation
 * can never rewrite them; everything else uses double quotes with `\`, `"` and
 * newline escapes. Simple values stay unquoted.
 */
export function quoteDotenvValue(value: string): string {
  if (value === '') return '';
  if (DOTENV_SAFE.test(value)) return value;
  if (value.includes('$') && !value.includes("'") && !value.includes('\n')) return `'${value}'`;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** Quote a value for POSIX shells: single quotes, embedded `'` as `'\''`. */
export function quoteShellValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote a value for PowerShell: single quotes, embedded `'` doubled. */
export function quotePowershellValue(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`;
}

/**
 * Quote a value for YAML. Always quoted so `true`, `587` or `0.92` stay
 * strings; double-quoted style when escapes are needed, single-quoted
 * otherwise.
 */
export function quoteYamlValue(value: string): string {
  if (/[\n\t]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t').replace(/\n/g, '\\n')}"`;
  }
  return `'${value.replace(/'/g, `''`)}'`;
}

/** Quote a value for TOML: always a basic string, with the escapes TOML requires. */
export function quoteTomlValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}

/**
 * Fully qualify an image reference the way Docker resolves it (`piwi/app` →
 * `docker.io/piwi/app`), which the platforms that pull by URL require. A first
 * segment carrying a dot, a port or `localhost` is already a registry host.
 */
function qualifyImage(image: string): string {
  const first = image.split('/')[0] ?? '';
  const hasRegistry = image.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost');
  return hasRegistry ? image : `docker.io/${image}`;
}

/** Uppercase alphanumeric form of a name, for platforms that key magic variables off it. */
function magicIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function commentBlock(header: readonly string[] | undefined): string {
  if (!header?.length) return '';
  return header.map((line) => `# ${line}`).join('\n') + '\n\n';
}

/** `.env` file (application/.env, `docker compose --env-file`, …). */
export function emitDotenv(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.comment) lines.push(`# ${entry.comment}`);
    lines.push(`${entry.name}=${quoteDotenvValue(entry.value)}`);
  }
  return commentBlock(opts.header) + lines.join('\n') + '\n';
}

/** `export NAME='value'` lines for bash/zsh. */
export function emitShellExports(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const lines = entries.map((entry) => `export ${entry.name}=${quoteShellValue(entry.value)}`);
  return commentBlock(opts.header) + lines.join('\n') + '\n';
}

/** `$env:NAME = 'value'` lines for PowerShell. */
export function emitPowershellEnv(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const lines = entries.map((entry) => `$env:${entry.name} = ${quotePowershellValue(entry.value)}`);
  return commentBlock(opts.header) + lines.join('\n') + '\n';
}

/** Multi-line `docker run` command for Linux/macOS shells. */
export function emitDockerRunBash(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const image = opts.image ?? DEFAULT_IMAGE;
  const name = opts.name ?? DEFAULT_NAME;
  const lines = [
    `docker run -d --name ${name} \\`,
    `  -p 3000:3000 \\`,
    `  -v "$(pwd)/.data:/app/.data" \\`,
    ...entries.map((entry) => `  -e ${entry.name}=${quoteShellValue(entry.value)} \\`),
    `  ${image}`,
  ];
  return commentBlock(opts.header) + lines.join('\n') + '\n';
}

/** Multi-line `docker run` command for Windows PowerShell. */
export function emitDockerRunPowershell(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const image = opts.image ?? DEFAULT_IMAGE;
  const name = opts.name ?? DEFAULT_NAME;
  const lines = [
    'docker run -d --name ' + name + ' `',
    '  -p 3000:3000 `',
    '  -v "${PWD}/.data:/app/.data" `',
    ...entries.map((entry) => `  -e ${entry.name}=${quotePowershellValue(entry.value)} \``),
    `  ${image}`,
  ];
  return commentBlock(opts.header) + lines.join('\n') + '\n';
}

/** Minimal Docker Compose service with the variables inlined. */
export function emitDockerCompose(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const image = opts.image ?? DEFAULT_IMAGE;
  const name = opts.name ?? DEFAULT_NAME;
  const env = entries.length
    ? entries.map((entry) => `      ${entry.name}: ${quoteYamlValue(entry.value)}`).join('\n')
    : '      {}';
  return (
    commentBlock(opts.header) +
    `services:
  ${name}:
    image: ${image}
    ports:
      - '3000:3000'
    volumes:
      - ./.data:/app/.data
    environment:
${env}
    restart: unless-stopped
`
  );
}

/**
 * Kubernetes ConfigMap (plain values) + Secret (values flagged `secret`),
 * wired into a container via `envFrom`.
 */
export function emitKubernetes(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const name = opts.name ?? DEFAULT_NAME;
  const plain = entries.filter((entry) => !entry.secret);
  const secret = entries.filter((entry) => entry.secret);
  const parts: string[] = [];
  const data = (list: readonly EnvEntry[]) =>
    list.length ? list.map((entry) => `  ${entry.name}: ${quoteYamlValue(entry.value)}`).join('\n') : '  {}';
  parts.push(`apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-config
data:
${data(plain)}`);
  if (secret.length) {
    parts.push(`apiVersion: v1
kind: Secret
metadata:
  name: ${name}-secrets
type: Opaque
stringData:
${data(secret)}`);
  }
  const envFrom = [`        - configMapRef:`, `            name: ${name}-config`];
  if (secret.length) envFrom.push(`        - secretRef:`, `            name: ${name}-secrets`);
  parts.push(`# Reference from your Deployment's container spec:
#
#     spec:
#       containers:
#         - name: ${name}
#           envFrom:
${envFrom.map((line) => `#     ${line.slice(4)}`).join('\n')}`);
  return commentBlock(opts.header) + parts.join('\n---\n') + '\n';
}

/** EnvironmentFile for a systemd unit, with usage instructions inline. */
export function emitSystemd(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.comment) lines.push(`# ${entry.comment}`);
    lines.push(`${entry.name}=${quoteDotenvValue(entry.value)}`);
  }
  return (
    commentBlock(opts.header) +
    `# Save as /etc/piwi/piwi.env and reference it from the unit:
#
#   [Service]
#   EnvironmentFile=/etc/piwi/piwi.env
#
${lines.join('\n')}
`
  );
}

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

/**
 * Fly Launch config (`fly.toml`), driven by `fly launch`. Secrets never belong
 * in this file — it is committed — so they are emitted as the `fly secrets set`
 * command to run once instead. Autoscaling stays off: the notification and
 * retention sweeps run in-process, so a suspended machine stops doing work it
 * is supposed to do on a schedule.
 */
export function emitFlyToml(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const name = opts.name ?? DEFAULT_NAME;
  const port = opts.port ?? DEFAULT_PORT;
  const lines = [
    `app = ${quoteTomlValue(name)}`,
    `primary_region = ${quoteTomlValue(opts.region ?? 'cdg')}`,
    '',
    '[build]',
    `  image = ${quoteTomlValue(opts.image ?? DEFAULT_IMAGE)}`,
  ];
  const envLines: string[] = [];
  const secretLines: string[] = [];
  for (const entry of entries) {
    if (entry.platformValue === 'generate' || entry.secret) {
      secretLines.push(
        `${entry.name}=${entry.platformValue === 'generate' ? '$(openssl rand -hex 32)' : quoteShellValue(entry.value)}`,
      );
      continue;
    }
    if (entry.comment) envLines.push(`  # ${entry.comment}`);
    if (entry.platformValue === 'url') {
      // `fly launch` rewrites `app` when the name is taken, but not this value.
      envLines.push(`  # Update this if \`fly launch\` picked a different app name.`);
      envLines.push(`  ${entry.name} = ${quoteTomlValue(`https://${name}.fly.dev`)}`);
      continue;
    }
    envLines.push(`  ${entry.name} = ${quoteTomlValue(entry.value)}`);
  }
  if (envLines.length) lines.push('', '[env]', ...envLines);
  lines.push(
    '',
    '[mounts]',
    `  source = ${quoteTomlValue(`${name}_data`.replace(/-/g, '_'))}`,
    `  destination = ${quoteTomlValue(DATA_MOUNT)}`,
    `  initial_size = ${quoteTomlValue(`${opts.diskGB ?? DEFAULT_DISK_GB}gb`)}`,
    '',
    '[http_service]',
    `  internal_port = ${port}`,
    '  force_https = true',
    '  # One always-on machine: SQLite, the SSE bus and the cron sweeps are all in-process.',
    '  auto_stop_machines = false',
    '  auto_start_machines = false',
    '  min_machines_running = 1',
    '',
    '  [[http_service.checks]]',
    '    interval = "30s"',
    '    timeout = "5s"',
    '    grace_period = "20s"',
    '    method = "GET"',
    `    path = ${quoteTomlValue(HEALTH_PATH)}`,
    '',
    '[[vm]]',
    '  size = "shared-cpu-1x"',
    '  memory = "1gb"',
  );
  if (secretLines.length) {
    lines.push(
      '',
      '# Secrets are never committed to fly.toml. Set them once, after `fly launch --no-deploy`:',
      '#',
      `#   fly secrets set ${secretLines.join(' \\\n#     ')}`,
    );
  }
  return commentBlock(opts.header) + lines.join('\n') + '\n';
}

/**
 * The Railway template specification, as Markdown. Railway publishes templates
 * from its dashboard rather than from a file in the repository, so this is the
 * source of truth for what to enter there — generated from the same registry as
 * every other format so the variable list cannot drift.
 */
export function emitRailwayTemplate(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const railwayValue = (entry: EnvEntry): string => {
    if (entry.platformValue === 'generate') return '`${{ secret(64) }}`';
    if (entry.platformValue === 'url') return '`https://${{ RAILWAY_PUBLIC_DOMAIN }}`';
    return `\`${entry.value}\``;
  };
  const lines = [
    '# Railway template',
    '',
    'Railway publishes templates from its dashboard (**Workspace settings → Templates → New Template**),',
    'not from a file in a repository. Create one service with the settings below, publish it, and the',
    'resulting `https://railway.com/new/template/<code>` URL is what the Deploy on Railway button links to.',
    '',
    '## Service',
    '',
    '| Setting | Value |',
    '|---|---|',
    `| Source | Docker image \`${opts.image ?? DEFAULT_IMAGE}\` |`,
    `| Volume mount path | \`${DATA_MOUNT}\` |`,
    `| Health check path | \`${HEALTH_PATH}\` |`,
    `| Replicas | 1 — the SSE bus and the notification/retention cron all run in-process |`,
  ];
  if (entries.length) {
    lines.push(
      '',
      '## Variables',
      '',
      '| Variable | Value |',
      '|---|---|',
      ...entries.map((entry) => `| \`${entry.name}\` | ${railwayValue(entry)} |`),
    );
  }
  return (
    (opts.header?.length ? opts.header.map((line) => `> ${line}`).join('\n') + '\n\n' : '') + lines.join('\n') + '\n'
  );
}

/**
 * The Deploy-to-Koyeb button URL. Koyeb needs no file in the repository — the
 * whole service definition travels in the query string — but its volumes cannot
 * be attached this way, so the caveat is emitted with the URL rather than left
 * for the reader to discover after losing a week of runs.
 */
export function emitKoyebDeployUrl(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const name = opts.name ?? DEFAULT_NAME;
  const port = opts.port ?? DEFAULT_PORT;
  const params = [
    'type=docker',
    `image=${qualifyImage(opts.image ?? DEFAULT_IMAGE)}`,
    `name=${name}`,
    'instance_type=small',
    `regions=${opts.region ?? 'fra'}`,
    `ports=${port};http;/`,
  ];
  const deferred: string[] = [];
  for (const entry of entries) {
    if (entry.platformValue) {
      deferred.push(entry.name);
      continue;
    }
    params.push(`env[${entry.name}]=${encodeURIComponent(entry.value)}`);
  }
  const notes = [
    '',
    '# Koyeb volumes cannot be attached from this URL, and without one the database and every',
    '# stored trace are lost on redeploy. Attach one before the instance holds anything you want',
    `# to keep (volumes are region-scoped, and only standard instances can mount them):`,
    '#',
    `#   koyeb volumes create ${name}-data --region ${opts.region ?? 'fra'} --size 10`,
    `#   koyeb service update ${name}/${name} --volumes ${name}-data:${DATA_MOUNT}`,
    '#',
    `# The button URL carries no health check either — Koyeb defaults to a TCP probe on the`,
    `# port. Switch it to HTTP GET ${HEALTH_PATH}, which also verifies database connectivity:`,
    '#',
    `#   koyeb service update ${name}/${name} --checks ${port}:http:${HEALTH_PATH}`,
  ];
  if (deferred.length) {
    notes.push(
      '#',
      `# Set in the Koyeb console after the first deploy: ${deferred.join(', ')}.`,
      '# Generate each secret with: openssl rand -hex 32',
    );
  }
  return commentBlock(opts.header) + `https://app.koyeb.com/deploy?${params.join('&')}\n` + notes.join('\n') + '\n';
}

/**
 * A Compose stack for the self-hostable PaaS layer — Coolify and Dokploy both
 * consume one. Uses Coolify's magic variables so the domain and the secrets are
 * generated by the platform rather than pasted in by hand.
 */
export function emitCoolifyCompose(entries: readonly EnvEntry[], opts: EmitOptions = {}): string {
  const name = opts.name ?? DEFAULT_NAME;
  const port = opts.port ?? DEFAULT_PORT;
  const fqdnVar = `SERVICE_FQDN_${magicIdentifier(name)}_${port}`;
  const env: string[] = [`      - ${fqdnVar}`];
  for (const entry of entries) {
    if (entry.comment) env.push(`      # ${entry.comment}`);
    if (entry.platformValue === 'generate') {
      env.push(`      - ${entry.name}=\${SERVICE_PASSWORD_64_${magicIdentifier(entry.name)}}`);
    } else if (entry.platformValue === 'url') {
      env.push(`      - ${entry.name}=\${${fqdnVar}}`);
    } else {
      env.push(`      - ${entry.name}=${entry.value}`);
    }
  }
  return (
    commentBlock(opts.header) +
    `services:
  ${name}:
    image: ${opts.image ?? DEFAULT_IMAGE}
    environment:
${env.join('\n')}
    volumes:
      - ${name}-data:${DATA_MOUNT}
    healthcheck:
      test: ['CMD', 'wget', '-qO', '/dev/null', 'http://127.0.0.1:${port}${HEALTH_PATH}']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    restart: unless-stopped

volumes:
  ${name}-data:
`
  );
}

/** Tab groups the configuration generator renders, in display order. */
export const ENV_OUTPUT_GROUPS = ['Files & shells', 'Containers', 'Hosting platforms'] as const;

export type EnvOutputGroup = (typeof ENV_OUTPUT_GROUPS)[number];

export interface EnvOutputFormat {
  /** Stable identifier (also used as the wizard tab key). */
  id: string;
  /** Human label, sentence case. */
  label: string;
  /** Markdown/Shiki language for syntax highlighting. */
  language: string;
  /** Suggested filename for downloads. */
  filename: string;
  /** Row the wizard renders this format's tab in. */
  group: EnvOutputGroup;
  emit(entries: readonly EnvEntry[], opts?: EmitOptions): string;
}

/** Every output format the configuration generator offers, in display order. */
export const ENV_OUTPUT_FORMATS: readonly EnvOutputFormat[] = [
  { id: 'dotenv', label: '.env file', language: 'dotenv', filename: '.env', group: 'Files & shells', emit: emitDotenv },
  {
    id: 'systemd',
    label: 'systemd',
    language: 'ini',
    filename: 'piwi.env',
    group: 'Files & shells',
    emit: emitSystemd,
  },
  {
    id: 'shell',
    label: 'Shell exports (bash)',
    language: 'bash',
    filename: 'piwi-env.sh',
    group: 'Files & shells',
    emit: emitShellExports,
  },
  {
    id: 'powershell',
    label: 'Shell exports (PowerShell)',
    language: 'powershell',
    filename: 'piwi-env.ps1',
    group: 'Files & shells',
    emit: emitPowershellEnv,
  },
  {
    id: 'compose',
    label: 'Docker Compose',
    language: 'yaml',
    filename: 'docker-compose.yml',
    group: 'Containers',
    emit: emitDockerCompose,
  },
  {
    id: 'docker-run',
    label: 'docker run (Linux / macOS)',
    language: 'bash',
    filename: 'run-piwi.sh',
    group: 'Containers',
    emit: emitDockerRunBash,
  },
  {
    id: 'docker-run-ps',
    label: 'docker run (PowerShell)',
    language: 'powershell',
    filename: 'run-piwi.ps1',
    group: 'Containers',
    emit: emitDockerRunPowershell,
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    language: 'yaml',
    filename: 'piwi-env.yaml',
    group: 'Containers',
    emit: emitKubernetes,
  },
  {
    id: 'railway',
    label: 'Railway',
    language: 'markdown',
    filename: 'railway-template.md',
    group: 'Hosting platforms',
    emit: emitRailwayTemplate,
  },
  {
    id: 'render',
    label: 'Render',
    language: 'yaml',
    filename: 'render.yaml',
    group: 'Hosting platforms',
    emit: emitRenderBlueprint,
  },
  { id: 'fly', label: 'Fly.io', language: 'toml', filename: 'fly.toml', group: 'Hosting platforms', emit: emitFlyToml },
  {
    id: 'koyeb',
    label: 'Koyeb',
    language: 'bash',
    filename: 'koyeb-deploy-url.txt',
    group: 'Hosting platforms',
    emit: emitKoyebDeployUrl,
  },
  {
    id: 'coolify',
    label: 'Coolify / Dokploy',
    language: 'yaml',
    filename: 'coolify-compose.yml',
    group: 'Hosting platforms',
    emit: emitCoolifyCompose,
  },
];
