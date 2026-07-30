import { describe, test, expect } from 'vitest';
import { createTestFunctionSchema, aiExtractedFunctionSchema } from '../../shared/test-function-schemas';

/**
 * `name`, `receiver` and `importName` are interpolated into generated
 * TypeScript unquoted, so the boundary that accepts them is the boundary that
 * decides whether a recorded flow exports as a call or as arbitrary code. These
 * cases are the shapes that used to get through.
 */
const baseEntry = {
  name: 'addToCart',
  kind: 'page-object-method' as const,
  module: './pages/CartPage',
  receiver: 'cartPage',
  importName: 'CartPage',
  params: [],
  steps: [{ action: 'click' as const, target: { testId: 'add-to-cart' } }],
};

describe('createTestFunctionSchema', () => {
  test('accepts a well-formed page-object-method entry', () => {
    expect(createTestFunctionSchema.safeParse(baseEntry).success).toBe(true);
  });

  test('a helper with no receiver or importName is fine', () => {
    const helper = { ...baseEntry, kind: 'helper' as const, receiver: null, importName: null };
    expect(createTestFunctionSchema.safeParse(helper).success).toBe(true);
  });

  test('rejects a receiver that closes the call and appends statements', () => {
    const injected = { ...baseEntry, receiver: `cartPage); await page.goto('https://evil.test'); (0` };
    const result = createTestFunctionSchema.safeParse(injected);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('valid JS identifier');
  });

  test('rejects an importName that escapes the import statement', () => {
    const injected = { ...baseEntry, importName: `CartPage } from 'node:child_process'; import { execSync` };
    expect(createTestFunctionSchema.safeParse(injected).success).toBe(false);
  });

  test('rejects a module specifier carrying a quote or a line break', () => {
    expect(createTestFunctionSchema.safeParse({ ...baseEntry, module: `./x'; evil()` }).success).toBe(false);
    expect(createTestFunctionSchema.safeParse({ ...baseEntry, module: './x\nevil()' }).success).toBe(false);
  });

  test('an ordinary scoped or relative module specifier still passes', () => {
    expect(createTestFunctionSchema.safeParse({ ...baseEntry, module: '@fixtures/cart' }).success).toBe(true);
    expect(createTestFunctionSchema.safeParse({ ...baseEntry, module: '../../pages/CartPage' }).success).toBe(true);
  });
});

describe('aiExtractedFunctionSchema', () => {
  test('holds a model response to the same identifier rule', () => {
    const { module: _module, ...noModule } = baseEntry;
    expect(aiExtractedFunctionSchema.safeParse(noModule).success).toBe(true);
    expect(aiExtractedFunctionSchema.safeParse({ ...noModule, receiver: 'a; evil()' }).success).toBe(false);
    expect(aiExtractedFunctionSchema.safeParse({ ...noModule, importName: 'A-B' }).success).toBe(false);
  });
});
