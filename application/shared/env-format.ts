/**
 * Pure emitters that turn a list of resolved environment variable values into
 * deployment-ready configuration snippets (.env file, docker run, Docker
 * Compose, Kubernetes, systemd, shell exports).
 *
 * Consumed by the docs-site configuration generator wizard (which imports this
 * module directly through the `#shared` alias wired into the VitePress build),
 * so it MUST stay dependency-free and browser-safe: no imports, no Node APIs.
 * All quoting/escaping rules live here so every surface renders identical,
 * correct output — covered by `tests/unit/env-format.test.ts`.
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
}

export interface EmitOptions {
  /** Docker image reference used by the container formats. */
  image?: string;
  /** Container / Kubernetes resource base name. */
  name?: string;
  /** Comment lines prefixed to the output (each format uses its own comment syntax). */
  header?: readonly string[];
}

const DEFAULT_IMAGE = 'phenx/piwitests-server:latest';
const DEFAULT_NAME = 'piwi';

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

export interface EnvOutputFormat {
  /** Stable identifier (also used as the wizard tab key). */
  id: string;
  /** Human label, sentence case. */
  label: string;
  /** Markdown/Shiki language for syntax highlighting. */
  language: string;
  /** Suggested filename for downloads. */
  filename: string;
  emit(entries: readonly EnvEntry[], opts?: EmitOptions): string;
}

/** Every output format the configuration generator offers, in display order. */
export const ENV_OUTPUT_FORMATS: readonly EnvOutputFormat[] = [
  { id: 'dotenv', label: '.env file', language: 'dotenv', filename: '.env', emit: emitDotenv },
  { id: 'compose', label: 'Docker Compose', language: 'yaml', filename: 'docker-compose.yml', emit: emitDockerCompose },
  {
    id: 'docker-run',
    label: 'docker run (Linux / macOS)',
    language: 'bash',
    filename: 'run-piwi.sh',
    emit: emitDockerRunBash,
  },
  {
    id: 'docker-run-ps',
    label: 'docker run (PowerShell)',
    language: 'powershell',
    filename: 'run-piwi.ps1',
    emit: emitDockerRunPowershell,
  },
  { id: 'kubernetes', label: 'Kubernetes', language: 'yaml', filename: 'piwi-env.yaml', emit: emitKubernetes },
  { id: 'systemd', label: 'systemd', language: 'ini', filename: 'piwi.env', emit: emitSystemd },
  { id: 'shell', label: 'Shell exports (bash)', language: 'bash', filename: 'piwi-env.sh', emit: emitShellExports },
  {
    id: 'powershell',
    label: 'Shell exports (PowerShell)',
    language: 'powershell',
    filename: 'piwi-env.ps1',
    emit: emitPowershellEnv,
  },
];
