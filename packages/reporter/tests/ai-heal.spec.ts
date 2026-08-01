import { describe, it, expect } from 'vitest';
import { healLocatorEntry } from '../src/internal/ai/heal.js';
import type { LocatorEntry } from '../src/internal/ai/artifact.js';

function entry(name: string): LocatorEntry {
  return {
    version: 1,
    kind: 'locator',
    template: 'the save button',
    locator: { method: 'getByRole', args: ['button', { name }] },
    fingerprint: { role: 'button', name },
  };
}

describe('healLocatorEntry', () => {
  it('repairs a renamed element without an LLM, refreshing locator and fingerprint', () => {
    const healed = healLocatorEntry(entry('Save'), '- button "Save changes"');
    expect(healed).not.toBeNull();
    expect(healed?.locator).toEqual({ method: 'getByRole', args: ['button', { name: 'Save changes' }] });
    expect(healed?.fingerprint).toMatchObject({ role: 'button', name: 'Save changes' });
  });

  it('returns null when the element is still present under its recorded name', () => {
    expect(healLocatorEntry(entry('Save'), '- button "Save"')).toBeNull();
  });

  it('returns null when no confident rename match exists (genuine regression)', () => {
    // A different role entirely — nothing to rename-match against.
    expect(healLocatorEntry(entry('Save'), '- link "Documentation"\n- textbox "Search"')).toBeNull();
  });

  it('returns null without a fingerprint or snapshot', () => {
    expect(healLocatorEntry({ ...entry('Save'), fingerprint: undefined }, '- button "X"')).toBeNull();
    expect(healLocatorEntry(entry('Save'), null)).toBeNull();
  });
});
