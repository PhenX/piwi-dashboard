import { describe, it, expect } from 'vitest';
import {
  extendPiwiAi,
  missMessage,
  parseAiMode,
  piwiAiFixtures,
  readPositiveInt,
  recordIntents,
  type AiIntent,
} from '../src/internal/ai/ai-fixtures.js';
import type { LocatorEntry, RunEntry } from '../src/internal/ai/artifact.js';

describe('parseAiMode', () => {
  it('recognizes resolve and heal', () => {
    expect(parseAiMode('resolve')).toBe('resolve');
    expect(parseAiMode('heal')).toBe('heal');
  });
  it('defaults everything else to the read-only replay mode', () => {
    expect(parseAiMode(undefined)).toBe('replay');
    expect(parseAiMode('')).toBe('replay');
    expect(parseAiMode('yes')).toBe('replay');
  });
});

describe('missMessage', () => {
  it('names the entry file and gives the exact resolve command', () => {
    const message = missMessage('log in as {email}', 'checkout › pays by card', 'tests/__piwi__/x.json');
    expect(message).toContain('no committed entry for "log in as {email}"');
    expect(message).toContain('tests/__piwi__/x.json');
    expect(message).toContain('piwi ai resolve --grep "checkout › pays by card"');
  });
});

describe('readPositiveInt', () => {
  it('parses non-negative integers from configurable-cap env values', () => {
    expect(readPositiveInt('20')).toBe(20);
    expect(readPositiveInt('0')).toBe(0);
    expect(readPositiveInt('12.9')).toBe(12);
  });
  it('returns undefined (fall back to default) for unset or invalid values', () => {
    expect(readPositiveInt(undefined)).toBeUndefined();
    expect(readPositiveInt('')).toBeUndefined();
    expect(readPositiveInt('-5')).toBeUndefined();
    expect(readPositiveInt('abc')).toBeUndefined();
  });
});

describe('exports', () => {
  it('exposes the fixtures object and the extend helper', () => {
    expect(typeof extendPiwiAi).toBe('function');
    expect(piwiAiFixtures).toHaveProperty('page');
  });
});

describe('recordIntents', () => {
  const locatorEntry: LocatorEntry = {
    version: 1,
    kind: 'locator',
    template: 'the email address field',
    locator: { method: 'getByRole', args: ['textbox', { name: 'Email' }] },
  };
  const runEntry: RunEntry = {
    version: 1,
    kind: 'run',
    template: 'sign in as {email}',
    steps: [
      {
        locator: { method: 'getByRole', args: ['textbox', { name: 'Email' }] },
        action: 'fill',
        value: '{{email}}',
      },
      { locator: { method: 'getByRole', args: ['button', { name: 'Sign in' }] }, action: 'click' },
    ],
    postcondition: { assert: 'visible', locator: { method: 'getByRole', args: ['heading', { name: 'Welcome' }] } },
  };

  it('maps a locator entry to one playwright-style intent', () => {
    const intents = new Map<string, AiIntent>();
    recordIntents(intents, locatorEntry);
    expect([...intents.values()]).toEqual([
      { template: 'the email address field', locator: "getByRole('textbox', { name: 'Email' })", kind: 'locator' },
    ]);
  });

  it('maps every step and the postcondition of a run entry to the flow template', () => {
    const intents = new Map<string, AiIntent>();
    recordIntents(intents, runEntry);
    const locators = [...intents.values()].map((i) => i.locator);
    expect(locators).toEqual([
      "getByRole('textbox', { name: 'Email' })",
      "getByRole('button', { name: 'Sign in' })",
      "getByRole('heading', { name: 'Welcome' })",
    ]);
    expect([...intents.values()].every((i) => i.template === 'sign in as {email}' && i.kind === 'run')).toBe(true);
  });

  it('dedupes a repeated template+locator pair across replays', () => {
    const intents = new Map<string, AiIntent>();
    recordIntents(intents, locatorEntry);
    recordIntents(intents, locatorEntry);
    expect(intents.size).toBe(1);
  });

  it('keeps a shared locator once per template (locator prompt vs flow step)', () => {
    const intents = new Map<string, AiIntent>();
    recordIntents(intents, locatorEntry);
    recordIntents(intents, runEntry);
    // The Email textbox appears under both templates — both intents survive.
    const emailIntents = [...intents.values()].filter((i) => i.locator.includes('Email'));
    expect(emailIntents).toHaveLength(2);
  });
});
