import {
  installPickerOverlay,
  showAnchorPicker,
  probeElementAttrs,
  generateAnchoredAlternatives,
  mergeCandidates,
  type PickedAnchorInfo,
  type ProbedAttrs,
} from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  resolveAriaRole,
  headingLevel,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
} from '@piwitests/core/locator-generation';
import { renderResultsPanel } from './results-panel.js';

const ROLE_SOURCES = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');

const PROBE_ARG = {
  keep: [...CAPTURED_ATTRIBUTES],
  tagRoles: TAG_TO_ROLE,
  inputRoles: INPUT_TYPE_TO_ROLE,
  roleSources: ROLE_SOURCES,
  includeStructural: true,
  includeLabelText: false,
};

const PICK_GLOBALS = [
  '__piwiPickState',
  '__piwiPickedElement',
  '__piwiAnchorState',
  '__piwiPickAnchors',
  '__piwiPickChainCount',
] as const;

function clearPickGlobals(): void {
  for (const key of PICK_GLOBALS) delete (globalThis as any)[key];
}

/** Poll for a global the picker overlay sets, mirroring the reporter's `page.waitForFunction` from inside the browser itself. */
function waitForGlobal<T>(key: string): Promise<T> {
  return new Promise((resolve) => {
    const check = () => {
      const value = (globalThis as any)[key];
      if (value !== undefined) {
        resolve(value as T);
        return;
      }
      setTimeout(check, 120);
    };
    check();
  });
}

/**
 * Runs the full guided pick flow: element pick (snap + tree-walk), optional
 * anchor scoping, ranked alternatives, then the results panel. A single
 * injection of this module runs this once — re-injecting (a second "Pick
 * element" trigger) is guarded against re-entering while one is already
 * active on the page.
 */
async function runPick(): Promise<void> {
  const g = globalThis as any;
  if (g.__piwiPicking) return;
  g.__piwiPicking = true;
  try {
    clearPickGlobals();
    installPickerOverlay({ transport: 'global', failing: null });
    const state = await waitForGlobal<string>('__piwiPickState');
    if (state !== 'picked') return;

    const el = g.__piwiPickedElement;
    const attrs: ProbedAttrs = probeElementAttrs(el, PROBE_ARG);
    const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
    const role = resolveAriaRole({ ...attrs, accessibleName });
    const level = headingLevel({ ...attrs, accessibleName }, role);

    let anchors: PickedAnchorInfo[] = [];
    let chainLeafCount: number | undefined;
    if (role) {
      showAnchorPicker({
        tagRoles: TAG_TO_ROLE,
        inputRoles: INPUT_TYPE_TO_ROLE,
        roleSources: ROLE_SOURCES,
        leafRole: role,
        leafLevel: level,
        leafTestId: attrs.attributes['data-testid'] ?? null,
      });
      const anchorState = await waitForGlobal<string>('__piwiAnchorState');
      if (anchorState === 'done') {
        anchors = g.__piwiPickAnchors ?? [];
        chainLeafCount = g.__piwiPickChainCount;
      }
    }

    const ranked = mergeCandidates(
      generateAlternatives({ ...attrs, accessibleName }),
      generateAnchoredAlternatives({ role, level }, anchors, chainLeafCount),
    );
    if (ranked.length === 0) return;

    await renderResultsPanel(ranked);
  } finally {
    clearPickGlobals();
    g.__piwiPicking = false;
  }
}

void runPick();
