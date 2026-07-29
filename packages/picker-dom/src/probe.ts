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

      // Mirrors core's `approximateAccessibleName` — inlined because this
      // function is serialized into the page by the reporter and cannot
      // reference imports. Keep the two in step.
      const nameOf = (n: any): string | null => {
        const al = n.getAttribute('aria-label');
        if (al) return al;
        const txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt;
        return n.getAttribute('title') || n.getAttribute('placeholder') || null;
      };
      const targetName = nameOf(el);
      const targetText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const textNeedle = targetText ? targetText.toLowerCase() : null;

      const normText = (n: any): string => (n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      /**
       * How many elements `getByText(targetText)` would match inside `root`.
       * Playwright's default text match is a case-insensitive substring over
       * normalized whitespace and resolves to the *smallest* element containing
       * the text, so an ancestor that only matches through a descendant is not
       * a separate match. Returns -1 when the subtree is too large to scan,
       * leaving the count unknown rather than reporting a wrong one.
       */
      const countTextOwners = (root: any, cap: number): number => {
        if (!textNeedle) return -1;
        const els = root.querySelectorAll('*');
        if (els.length > cap) return -1;
        let total = 0;
        for (let i = 0; i < els.length; i++) {
          const n = els[i];
          if (normText(n).indexOf(textNeedle) === -1) continue;
          let deeper = false;
          const kids = n.children;
          for (let j = 0; j < kids.length; j++) {
            if (normText(kids[j]).indexOf(textNeedle) !== -1) {
              deeper = true;
              break;
            }
          }
          if (!deeper) total++;
        }
        return total;
      };

      // A truncated scan would produce wrong counts/indexes — skip instead.
      const nodes = doc.querySelectorAll(roleSources);
      const nodesUsable = nodes.length <= 4000;
      const rolesUsable = !!targetRole && nodesUsable;

      if (rolesUsable) {
        let roleCountAll = 0;
        let index = -1;
        let levelCount = 0;
        // How many elements a `getByRole(role, { name })` would actually
        // match. Without it, an ambiguous locator scores exactly as well as a
        // unique one and wins on base score alone.
        let roleNameCount = 0;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (roleOf(n) !== targetRole) continue;
          if (n === el) index = roleCountAll;
          roleCountAll++;
          if (targetLevel != null && levelOf(n) === targetLevel) levelCount++;
          if (targetName != null && nameOf(n) === targetName) roleNameCount++;
        }
        if (targetName != null) selectorCounts.roleName = roleNameCount;
        if (index !== -1) {
          rolePosition = {
            role: targetRole,
            count: roleCountAll,
            index,
            ...(targetLevel != null ? { levelCount } : {}),
          };
        }
      }

      if (textNeedle) {
        const textCount = countTextOwners(doc.body || doc.documentElement, 4000);
        if (textCount >= 0) selectorCounts.text = textCount;
      }

      // The anchor walk runs for role-less leaves too: a `<span class="price">`
      // has no role to scope, but scoping its text to a parent is the only way
      // to tell one repeated card from another.
      if (rolesUsable || textNeedle) {
        // `li` and `tr` are almost never document-unique, so they are useless
        // as bare role anchors — but they are the repeated container a
        // `filter({ hasText })` chain exists to single out.
        const CONTAINER_TAGS = ['form', 'nav', 'main', 'article', 'section', 'dialog', 'table', 'li', 'tr'];
        // Framework bookkeeping rather than anything an author chose:
        // Vue's scoped-style markers (`data-v-4f2a1b`), React's legacy
        // `data-reactid`, Svelte/Angular/Ember instance ids.
        const NOISY_DATA_ATTR = /^data-(v-[0-9a-f]+|reactid|react-checksum|svelte-\w+|ng-\w+|ember\w*)$/i;
        /** The first `data-*` on a node that looks author-chosen and carries a usable value. `data-testid` is excluded — it has its own, higher-scoring path. */
        const stableDataAttr = (n: any): { name: string; value: string } | null => {
          const attrs = n.attributes;
          if (!attrs) return null;
          for (let i = 0; i < attrs.length; i++) {
            const name = attrs[i].name;
            if (!name || name.slice(0, 5) !== 'data-' || name === 'data-testid') continue;
            if (NOISY_DATA_ATTR.test(name)) continue;
            const value = attrs[i].value;
            // A valueless marker (`data-open`) identifies nothing; an
            // over-long one is almost always serialized state.
            if (!value || value.length > 120) continue;
            return { name, value };
          }
          return null;
        };
        const docRoleCount = (role: string): number => {
          let c = 0;
          for (let i = 0; i < nodes.length; i++) if (roleOf(nodes[i]) === role) c++;
          return c;
        };
        const rawText = (n: any): string => (n.textContent || '').replace(/\s+/g, ' ').trim();
        /**
         * A short piece of text inside `anc` that tells it apart from its
         * same-role siblings — what a human means by "the Keyboard row". A
         * heading is the clearest signal; failing that, the first short
         * text-bearing leaf. The target's own text is never used: filtering a
         * container by the very text we are trying to disambiguate is circular
         * and singles out nothing.
         */
        const discriminatingText = (anc: any): string | null => {
          const heading = anc.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
          if (heading) {
            const t = rawText(heading);
            if (t && t.length <= 60 && t !== targetText) return t;
          }
          const els = anc.querySelectorAll('*');
          if (els.length > 200) return null;
          for (let i = 0; i < els.length; i++) {
            const n = els[i];
            if (n === el || n.children.length > 0) continue;
            const t = rawText(n);
            if (!t || t.length > 60 || t === targetText) continue;
            return t;
          }
          return null;
        };
        /** How many elements of `role` contain `text` — i.e. what `getByRole(role).filter({ hasText: text })` would resolve to. */
        const filterMatchCount = (role: string, text: string): number => {
          const needle = text.toLowerCase();
          let c = 0;
          for (let i = 0; i < nodes.length; i++) {
            if (roleOf(nodes[i]) !== role) continue;
            if (normText(nodes[i]).indexOf(needle) !== -1) c++;
          }
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
          const dataAttr = stableDataAttr(node);
          if (testId || id || anchorRole || ariaLabel || dataAttr) {
            let scopedRoleCount = -1;
            if (rolesUsable) {
              const scoped = node.querySelectorAll(roleSources);
              // Truncated — unusable, so leave it at -1 and drop the field.
              if (scoped.length <= 2000) {
                scopedRoleCount = 0;
                for (let i = 0; i < scoped.length; i++) {
                  const n = scoped[i];
                  if (roleOf(n) !== targetRole) continue;
                  if (targetLevel != null && levelOf(n) !== targetLevel) continue;
                  scopedRoleCount++;
                }
              }
            }
            const scopedTextCount = countTextOwners(node, 2000);
            // A repeated container — a card, a row — has no unique hook of its
            // own, but the text it holds still names it.
            // Isolated: a hiccup finding the discriminator must cost this one
            // optional field, not every anchor collected so far.
            let filterText: string | null = null;
            try {
              if (anchorRole && nodesUsable) filterText = discriminatingText(node);
            } catch {
              filterText = null;
            }
            ancestors.push({
              tag,
              depth,
              testId: testId || null,
              id: id || null,
              role: explicitRole || null,
              ariaLabel: ariaLabel || null,
              ...(scopedRoleCount >= 0 ? { scopedRoleCount } : {}),
              ...(scopedTextCount >= 0 ? { scopedTextCount } : {}),
              ...(testId ? { testIdCount: count(`[data-testid=${JSON.stringify(testId)}]`) } : {}),
              ...(id ? { idCount: count(`#${cssEsc(id)}`) } : {}),
              ...(anchorRole && nodesUsable ? { roleCount: docRoleCount(anchorRole) } : {}),
              ...(filterText
                ? { filterText, filterRoleCount: filterMatchCount(anchorRole as string, filterText) }
                : {}),
              ...(dataAttr
                ? { dataAttr, dataAttrCount: count(`[${dataAttr.name}=${JSON.stringify(dataAttr.value)}]`) }
                : {}),
            });
          }
          node = node.parentElement;
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
