import { z } from 'zod';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { createTestFunction } from '#shared/handlers/test-functions';
import { Role } from '#shared/types';
import {
  testFunctionNameSchema,
  testFunctionKindSchema,
  paramSchema,
  patternStepSchema,
  paramSourceSchema,
} from '../../../utils/test-function-schemas';

defineRouteMeta({
  openAPI: {
    tags: ['Test functions'],
    summary: 'Add a test function to a project’s catalog',
    description:
      'Registers a page-object method or helper — its name, module, parameters, and the DOM pattern it drives — so recorded browser-extension sessions can match against it. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const createTestFunctionSchema = z.object({
  name: testFunctionNameSchema,
  kind: testFunctionKindSchema,
  module: z.string().min(1, 'Module is required').max(240),
  receiver: z.string().max(120).nullish(),
  importName: z.string().max(120).nullish(),
  params: z.array(paramSchema).max(10),
  returnsPage: z.boolean().optional(),
  urlPattern: z.string().max(240).nullish(),
  steps: z.array(patternStepSchema).min(1, 'At least one pattern step is required').max(30),
  paramSources: z.array(paramSourceSchema).max(10).optional(),
  source: z.enum(['manual', 'scanned', 'recorded', 'ai-extracted']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id, [Role.ADMINISTRATOR, Role.REPORTER]);

  const body = await readBody(event);
  const validation = createTestFunctionSchema.safeParse(body);
  if (!validation.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  const db = await getDatabase();
  try {
    return await createTestFunction(db, id, validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create test function';
    const isUniqueViolation = message.toLowerCase().includes('unique');
    throw createError({
      statusCode: isUniqueViolation ? 409 : 400,
      message: isUniqueViolation ? 'A function with this name already exists in this module' : message,
    });
  }
});
