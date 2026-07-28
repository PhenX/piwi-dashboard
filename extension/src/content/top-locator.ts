import { probeElementAttrs, type ProbeArg } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
} from '@piwitests/core/locator-generation';

export interface TopLocatorInfo {
  /** The single top-ranked locator, or null when generateAlternatives found no candidate at all. */
  locator: string | null;
  accessibleName: string | null;
}

/**
 * The probe -> generateAlternatives pipeline collapsed to just the winning
 * candidate, for features that need exactly one locator for an
 * already-picked element rather than the full ranked menu `pick.ts`'s
 * results panel shows (`assertion-suggest.ts`, `session-panel.ts`).
 */
export function deriveTopLocator(el: Element): TopLocatorInfo {
  const roleSources = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');
  const probeArg: ProbeArg = {
    keep: [...CAPTURED_ATTRIBUTES],
    tagRoles: TAG_TO_ROLE,
    inputRoles: INPUT_TYPE_TO_ROLE,
    roleSources,
    includeStructural: true,
    includeLabelText: false,
  };
  const attrs = probeElementAttrs(el, probeArg);
  const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
  const ranked = generateAlternatives({ ...attrs, accessibleName });
  return { locator: ranked.length > 0 ? ranked[0]!.locator : null, accessibleName };
}
