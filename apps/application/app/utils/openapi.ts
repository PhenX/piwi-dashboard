/**
 * Minimal OpenAPI 3.x types + helpers for the in-app API reference (`/docs`).
 *
 * The dashboard renders its own auto-generated spec (`/_openapi.json`) with a
 * small self-contained Vue renderer instead of loading a third-party CDN
 * bundle, so `/docs` works offline / air-gapped and makes no outbound calls
 * (honoring the "zero telemetry, no phone-home" promise). Only the subset of
 * OpenAPI the generated spec actually uses is modeled here.
 */

export interface JsonSchema {
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
  default?: unknown;
  example?: unknown;
  $ref?: string;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface OpenApiMediaType {
  schema?: JsonSchema;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

/** A single security requirement: scheme name → required scopes. */
export type SecurityRequirement = Record<string, string[]>;

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: SecurityRequirement[];
  /** Roles allowed to call the endpoint (custom extension emitted by the routes). */
  'x-required-roles'?: string[];
}

export interface OpenApiPathItem {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
  trace?: OpenApiOperation;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiSpec {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: OpenApiServer[];
  paths?: Record<string, OpenApiPathItem>;
  security?: SecurityRequirement[];
  tags?: { name: string; description?: string }[];
  components?: {
    schemas?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, { type?: string; scheme?: string; description?: string }>;
  };
}

/** HTTP methods that carry an operation on a path item, in display order. */
export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

/** Method → Nuxt UI badge color, matching common API-reference conventions. */
export function methodBadgeColor(method: string): BadgeColor {
  switch (method.toLowerCase()) {
    case 'get':
      return 'success';
    case 'post':
      return 'info';
    case 'put':
    case 'patch':
      return 'warning';
    case 'delete':
      return 'error';
    default:
      return 'neutral';
  }
}

/** A single operation flattened out of the spec for list rendering. */
export interface FlatOperation {
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
  /** Path-level + operation-level parameters, merged. */
  parameters: OpenApiParameter[];
  tag: string;
  anchor: string;
}

/** A URL-safe anchor id for an operation, e.g. `op-get-api-projects-id`. */
export function operationAnchor(method: string, path: string): string {
  return `op-${method}-${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Group flattened operations by their first tag (falling back to "Other"). */
export interface OperationGroup {
  tag: string;
  operations: FlatOperation[];
}

export function groupOperationsByTag(spec: OpenApiSpec | null | undefined): OperationGroup[] {
  const groups = new Map<string, FlatOperation[]>();

  for (const [path, item] of Object.entries(spec?.paths ?? {})) {
    if (!item) continue;
    const pathParams = item.parameters ?? [];
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const tag = operation.tags?.[0] ?? 'Other';
      const flat: FlatOperation = {
        path,
        method,
        operation,
        parameters: [...pathParams, ...(operation.parameters ?? [])],
        tag,
        anchor: operationAnchor(method, path),
      };
      const bucket = groups.get(tag);
      if (bucket) bucket.push(flat);
      else groups.set(tag, [flat]);
    }
  }

  return [...groups.entries()]
    .map(([tag, operations]) => ({ tag, operations }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Whether an operation requires authentication. `security: []` on the operation
 * means explicitly public; an absent field inherits the spec-level default.
 */
export function operationRequiresAuth(operation: OpenApiOperation, spec: OpenApiSpec | null | undefined): boolean {
  if (Array.isArray(operation.security)) return operation.security.length > 0;
  return Array.isArray(spec?.security) && spec.security.length > 0;
}

/** Whether an operation is explicitly marked public (`security: []`). */
export function operationIsPublic(operation: OpenApiOperation): boolean {
  return Array.isArray(operation.security) && operation.security.length === 0;
}

/** Resolve a local `#/components/schemas/Name` reference against the spec. */
export function resolveSchema(
  schema: JsonSchema | undefined,
  spec: OpenApiSpec | null | undefined,
): JsonSchema | undefined {
  if (!schema?.$ref) return schema;
  const match = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref);
  if (!match?.[1]) return schema;
  return spec?.components?.schemas?.[match[1]] ?? schema;
}

const ALL_ROLES = ['administrator', 'reporter', 'user'];

function capitalize(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export interface RoleRequirement {
  /** The raw roles that may call the endpoint. */
  roles: string[];
  /** Full readable requirement, e.g. "Administrator or Reporter" / "Any signed-in user". */
  label: string;
  /** Compact chip label, e.g. "Admin" / "Admin / Reporter". */
  shortLabel: string;
  /** True when a plain user cannot call it (admin/reporter-only) — worth flagging. */
  elevated: boolean;
}

/**
 * The role requirement for an operation, read from its `x-required-roles`
 * extension. Returns null for public or token-authenticated routes (which carry
 * no role restriction) — the caller shows its own public/auth indicator instead.
 */
export function routeRoleRequirement(operation: OpenApiOperation): RoleRequirement | null {
  const roles = operation['x-required-roles'];
  if (!roles || roles.length === 0) return null;
  const isAny = ALL_ROLES.every((role) => roles.includes(role));
  return {
    roles,
    label: isAny ? 'Any signed-in user' : roles.map(capitalize).join(' or '),
    shortLabel: isAny ? 'Any user' : roles.map((r) => (r === 'administrator' ? 'Admin' : capitalize(r))).join(' / '),
    elevated: !isAny && !roles.includes('user'),
  };
}

/** Render a schema's type as a short human string (e.g. `string`, `array<object>`). */
export function schemaTypeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'any';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? 'object';
  const base = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
  if (base === 'array') {
    const items = schema.items;
    const itemType = items ? schemaTypeLabel(items) : 'any';
    return `array<${itemType}>`;
  }
  if (!base && schema.properties) return 'object';
  if (!base && (schema.oneOf || schema.anyOf || schema.allOf)) return 'object';
  return base ?? 'any';
}
