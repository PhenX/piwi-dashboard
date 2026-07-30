import { describe, it, expect } from 'vitest';
import { buildSetupPiwiMessages, isKnownPrompt } from '../../server/utils/mcp/prompts';
import { MCP_PROMPT_DEFS } from '#shared/mcp-prompts';

describe('isKnownPrompt', () => {
  it('recognizes every declared prompt and rejects others', () => {
    for (const def of MCP_PROMPT_DEFS) expect(isKnownPrompt(def.name)).toBe(true);
    expect(isKnownPrompt('setup_piwi')).toBe(true);
    expect(isKnownPrompt('nonexistent')).toBe(false);
  });
});

describe('buildSetupPiwiMessages', () => {
  const base = { baseUrl: 'https://piwi.example.com', authEnabled: false, existingProjects: [] as string[] };

  it('returns a single user message and a description naming the dashboard', () => {
    const result = buildSetupPiwiMessages(base);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.type).toBe('text');
    expect(result.description).toContain('https://piwi.example.com');
  });

  it('bakes the dashboard URL into the init command', () => {
    const text = buildSetupPiwiMessages(base).messages[0].content.text;
    expect(text).toContain(
      'npx @piwitests/reporter init --server-url https://piwi.example.com --project <project-name>',
    );
    expect(text).toContain('Authentication: not required');
  });

  it('uses a supplied project name in place of the placeholder', () => {
    const text = buildSetupPiwiMessages({ ...base, projectName: 'checkout' }).messages[0].content.text;
    expect(text).toContain('--project checkout');
    expect(text).not.toContain('<project-name>');
    expect(text).toContain('project "checkout"');
  });

  it('spells out the API-key steps when authentication is required', () => {
    const text = buildSetupPiwiMessages({ ...base, authEnabled: true }).messages[0].content.text;
    expect(text).toContain('Authentication: required');
    expect(text).toContain('requires authentication');
    expect(text).toContain('PIWI_API_KEY');
    expect(text).toContain('pd_');
  });

  it('lists existing projects so the agent can reuse a name', () => {
    const text = buildSetupPiwiMessages({ ...base, existingProjects: ['checkout', 'marketing'] }).messages[0].content
      .text;
    expect(text).toContain('Projects that already exist: checkout, marketing');
    expect(text).toContain('reuse that exact name');
  });

  it('says so when the dashboard has no projects yet', () => {
    const text = buildSetupPiwiMessages(base).messages[0].content.text;
    expect(text).toContain('Projects that already exist: none yet');
    expect(text).toContain('first project');
  });

  it('truncates a very long project list and reports the total', () => {
    const many = Array.from({ length: 25 }, (_, i) => `proj-${i}`);
    const text = buildSetupPiwiMessages({ ...base, existingProjects: many }).messages[0].content.text;
    expect(text).toContain('(25 total)');
  });

  it('always closes with the verification step', () => {
    const text = buildSetupPiwiMessages(base).messages[0].content.text;
    expect(text).toContain('npx playwright test');
    expect(text).toContain('PIWI_OUTPUT_FILE=piwi-run.json');
  });
});
