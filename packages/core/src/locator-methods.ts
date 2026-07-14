/**
 * The Playwright locator-builder methods whose innermost call identifies the
 * resolved element. The single source of truth shared by the reporter's capture
 * proxy (`LOCATOR_METHODS`) and the server's leaf-selector extraction
 * (`LEAF_SELECTOR_METHODS` in `error-fingerprint.ts`).
 *
 * `frameLocator` is intentionally excluded — the capture proxy does not wrap
 * frame locators.
 */
export const LOCATOR_BUILDER_METHODS: readonly string[] = [
  'getByRole',
  'getByTestId',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'locator',
];
