import type { ProbeArg, ProbedAttrs } from './types.js';

/**
 * Runs inside the browser via `evaluate()` (live picker) or as part of a
 * concatenated `<script>` (snapshot picker) — probes an element for its
 * attributes, geometry, label association, and selector-uniqueness counts,
 * plus (when `arg.includeStructural`) its position among same-role elements
 * and anchor-worthy ancestors, which power name-free and ancestor-scoped
 * locator alternatives.
 *
 * Must stay a fully self-contained function (no references to this module's
 * closure): both hosts re-serialize it via `Function.prototype.toString()`.
 * `el` is browser-context (no DOM lib in this package), hence `any`.
 */
export function probeElementAttrs(el: any, arg: ProbeArg): ProbedAttrs {
  const { keep, tagRoles, inputRoles, roleSources, includeStructural, includeLabelText } = arg;
  const attrMap: Record<string, string | null> = {};
  for (const key of keep) {
    const v = el.getAttribute(key) ?? el[key];
    attrMap[key] = typeof v === 'string' ? v.slice(0, 200) : v ? String(v).slice(0, 200) : null;
  }
  const r = el.getBoundingClientRect();

  // Uniqueness probe: how many elements each candidate selector matches. A
  // count > 1 marks the alternative as ambiguous (strict-mode violation) so
  // generateAlternatives drops it.
  const selectorCounts: ProbedAttrs['selectorCounts'] = {};
  try {
    const doc = el.ownerDocument;
    const cssEsc = (s: string): string => doc.defaultView.CSS.escape(s);
    const count = (sel: string): number | undefined => {
      try {
        return doc.querySelectorAll(sel).length;
      } catch {
        return undefined;
      }
    };
    if (attrMap['data-testid']) {
      selectorCounts.testId = count(`[data-testid=${JSON.stringify(attrMap['data-testid'])}]`);
    }
    if (attrMap['id']) selectorCounts.id = count(`#${cssEsc(attrMap['id'])}`);
    if (attrMap['name']) selectorCounts.name = count(`[name=${JSON.stringify(attrMap['name'])}]`);
    const classList = (attrMap['class'] || '')
      .split(/\s+/)
      .filter((c: string) => c.length > 1)
      .slice(0, 10);
    if (classList.length > 0) {
      const classCounts: Record<string, number> = {};
      for (const cls of classList) {
        const n = count(`.${cssEsc(cls)}`);
        if (n !== undefined) classCounts[cls] = n;
      }
      selectorCounts.classes = classCounts;
    }
  } catch {
    // Uniqueness probing is best-effort — never fail the capture.
  }

  // Structural probe: the element's position among same-role elements plus
  // anchor-worthy ancestors — powers name-free and ancestor-scoped
  // alternatives that survive accessible-name renames. Skipped entirely when
  // the caller has no anchors step to feed (the snapshot picker).
  let rolePosition: ProbedAttrs['rolePosition'] = null;
  const ancestors: NonNullable<ProbedAttrs['ancestors']> = [];
  if (includeStructural && tagRoles && inputRoles && roleSources) {
    try {
      const doc = el.ownerDocument;
      const cssEsc = (s: string): string => doc.defaultView.CSS.escape(s);
      const count = (sel: string): number | undefined => {
        try {
          return doc.querySelectorAll(sel).length;
        } catch {
          return undefined;
        }
      };
      const roleOf = (n: any): string | null => {
        const explicit = n.getAttribute('role');
        if (explicit) return explicit;
        const tag = (n.tagName || '').toLowerCase();
        if (tag === 'input') return inputRoles[(n.getAttribute('type') || 'text').toLowerCase()] ?? 'textbox';
        if (tag === 'select') return n.getAttribute('multiple') != null ? 'listbox' : 'combobox';
        if (tag === 'a') return n.getAttribute('href') != null ? 'link' : null;
        return tagRoles[tag] ?? null;
      };
      const levelOf = (n: any): number | null => {
        const m = /^h([1-6])$/.exec((n.tagName || '').toLowerCase());
        if (m) return Number(m[1]);
        const al = n.getAttribute('aria-level');
        return al && /^\d+$/.test(al) ? Number(al) : null;
      };
      const targetRole = roleOf(el);
      const targetLevel = targetRole === 'heading' ? levelOf(el) : null;

      if (targetRole) {
        const nodes = doc.querySelectorAll(roleSources);
        // A truncated scan would produce wrong counts/indexes — skip instead.
        if (nodes.length <= 4000) {
          let roleCountAll = 0;
          let index = -1;
          let levelCount = 0;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (roleOf(n) !== targetRole) continue;
            if (n === el) index = roleCountAll;
            roleCountAll++;
            if (targetLevel != null && levelOf(n) === targetLevel) levelCount++;
          }
          if (index !== -1) {
            rolePosition = {
              role: targetRole,
              count: roleCountAll,
              index,
              ...(targetLevel != null ? { levelCount } : {}),
            };
          }

          const CONTAINER_TAGS = ['form', 'nav', 'main', 'article', 'section', 'dialog', 'table'];
          const docRoleCount = (role: string): number => {
            let c = 0;
            for (let i = 0; i < nodes.length; i++) if (roleOf(nodes[i]) === role) c++;
            return c;
          };
          let node = el.parentElement;
          let depth = 0;
          while (node && depth < 12 && ancestors.length < 4) {
            depth++;
            const tag = (node.tagName || '').toLowerCase();
            if (tag === 'body' || tag === 'html') break;
            const testId = node.getAttribute('data-testid');
            const id = node.getAttribute('id');
            const explicitRole = node.getAttribute('role');
            const ariaLabel = node.getAttribute('aria-label');
            const anchorRole = explicitRole || (CONTAINER_TAGS.includes(tag) ? tagRoles[tag] : null) || null;
            if (testId || id || anchorRole || ariaLabel) {
              const scoped = node.querySelectorAll(roleSources);
              let scopedRoleCount = 0;
              if (scoped.length <= 2000) {
                for (let i = 0; i < scoped.length; i++) {
                  const n = scoped[i];
                  if (roleOf(n) !== targetRole) continue;
                  if (targetLevel != null && levelOf(n) !== targetLevel) continue;
                  scopedRoleCount++;
                }
              } else {
                scopedRoleCount = -1; // truncated — unusable
              }
              ancestors.push({
                tag,
                depth,
                testId: testId || null,
                id: id || null,
                role: explicitRole || null,
                ariaLabel: ariaLabel || null,
                ...(scopedRoleCount >= 0 ? { scopedRoleCount } : {}),
                ...(testId ? { testIdCount: count(`[data-testid=${JSON.stringify(testId)}]`) } : {}),
                ...(id ? { idCount: count(`#${cssEsc(id)}`) } : {}),
                ...(anchorRole ? { roleCount: docRoleCount(anchorRole) } : {}),
              });
            }
            node = node.parentElement;
          }
        }
      }
    } catch {
      // Structural probing is best-effort — never fail the capture.
    }
  }

  const hasLabel = !!(el.labels && el.labels.length > 0);
  const labelText = includeLabelText
    ? hasLabel
      ? (el.labels[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) || null
      : null
    : undefined;

  return {
    tagName: el.tagName?.toLowerCase?.() ?? 'unknown',
    attributes: attrMap,
    // Collapse whitespace so multi-line text can't produce a getByText
    // suggestion with literal newlines in it.
    textContent: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    center: {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    },
    hasLabel,
    ...(includeLabelText ? { labelText } : {}),
    selectorCounts,
    ...(includeStructural ? { rolePosition, ancestors } : {}),
  };
}
