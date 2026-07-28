import { z } from 'zod';
import { requireResolvedProjectAccess, resolveTestFunctionProjectId, requireRouteId } from '../../utils/project-access';
import { updateTestFunction } from '#shared/handlers/test-functions';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Test functions'],
    summary: 'Update a test function',
    description: 'Updates a project’s catalog entry. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const stepActionSchema = z.enum([
  'goto',
  'click',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'press',
  'assertVisible',
]);

const patternTargetSchema = z.object({
  role: z.string().nullish(),
  name: z.string().nullish(),
  testId: z.string().nullish(),
});

const patternStepSchema = z.object({
  action: stepActionSchema,
  target: patternTargetSchema,
});

const paramSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']),
});

const paramSourceSchema = z.object({
  param: z.string().min(1),
  stepIndex: z.number().int().min(0),
  from: z.enum(['text', 'value', 'testId']),
});

const updateTestFunctionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'Must be a valid JS identifier')
    .optional(),
  kind: z.enum(['page-object-method', 'helper', 'fixture']).optional(),
  module: z.string().min(1).max(240).optional(),
  receiver: z.string().max(120).nullish(),
  importName: z.string().max(120).nullish(),
  params: z.array(paramSchema).max(10).optional(),
  returnsPage: z.boolean().optional(),
  urlPattern: z.string().max(240).nullish(),
  steps: z.array(patternStepSchema).min(1).max(30).optional(),
  paramSources: z.array(paramSourceSchema).max(10).optional(),
  source: z.enum(['manual', 'scanned', 'recorded']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test function ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestFunctionProjectId, 'Test function', [
    Role.ADMINISTRATOR,
    Role.REPORTER,
  ]);

  const body = await readBody(event);
  const validation = updateTestFunctionSchema.safeParse(body);
  if (!validation.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  try {
    return await updateTestFunction(db, id, validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update test function';
    throw createError({ statusCode: message === 'Test function not found' ? 404 : 400, message });
  }
});
