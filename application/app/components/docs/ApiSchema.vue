<script setup lang="ts">
import type { JsonSchema, OpenApiSpec } from '~/utils/openapi';

const props = withDefaults(
  defineProps<{
    schema: JsonSchema;
    spec?: OpenApiSpec | null;
    depth?: number;
  }>(),
  { spec: null, depth: 0 },
);

const resolved = computed(() => resolveSchema(props.schema, props.spec) ?? props.schema);

interface PropertyRow {
  name: string;
  required: boolean;
  schema: JsonSchema;
}

const properties = computed<PropertyRow[]>(() => {
  const object = resolved.value.type === 'array' ? resolveSchema(resolved.value.items, props.spec) : resolved.value;
  const entries = object?.properties;
  if (!entries) return [];
  const required = new Set(object?.required ?? []);
  return Object.entries(entries).map(([name, schema]) => ({
    name,
    required: required.has(name),
    schema: resolveSchema(schema, props.spec) ?? schema,
  }));
});

// Guard against pathological / self-referential schemas.
const canRecurse = computed(() => (props.depth ?? 0) < 6);

function childHasShape(schema: JsonSchema): boolean {
  const inner = schema.type === 'array' ? resolveSchema(schema.items, props.spec) : schema;
  return Boolean(inner?.properties && Object.keys(inner.properties).length > 0);
}

function enumValues(schema: JsonSchema): string {
  return (schema.enum ?? []).map((value) => JSON.stringify(value)).join(', ');
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="prop in properties" :key="prop.name" class="text-sm">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <code class="font-mono text-primary">{{ prop.name }}</code>
        <span class="text-xs text-muted font-mono">{{ schemaTypeLabel(prop.schema) }}</span>
        <span v-if="prop.schema.format" class="text-xs text-dimmed font-mono">({{ prop.schema.format }})</span>
        <span v-if="prop.required" class="text-xs font-medium text-error">required</span>
      </div>
      <p v-if="prop.schema.description" class="text-muted mt-0.5">{{ prop.schema.description }}</p>
      <p v-if="prop.schema.enum?.length" class="text-xs text-dimmed mt-0.5">
        Allowed values: <span class="font-mono">{{ enumValues(prop.schema) }}</span>
      </p>
      <ApiSchema
        v-if="canRecurse && childHasShape(prop.schema)"
        :schema="prop.schema"
        :spec="spec"
        :depth="(depth ?? 0) + 1"
        class="mt-1.5 border-l border-default pl-3"
      />
    </div>
  </div>
</template>
