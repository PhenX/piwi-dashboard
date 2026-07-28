/**
 * Catalog of MCP **prompts** this server exposes — the slash-command-style
 * entries an MCP client offers the user (Claude Code, Cursor, Copilot, …).
 *
 * Only the catalog (name, description, arguments) lives here, shared so the
 * server route and the in-app MCP setup page can render the same list — the
 * same split `mcp-tools.ts` uses for tools. The message text is built
 * server-side in `server/utils/mcp/prompts.ts`, where it can be filled in with
 * this dashboard's real URL, whether authentication is required, and the
 * projects that already exist.
 */

export interface McpPromptArg {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpPromptDef {
  name: string;
  description: string;
  // `readonly` so the catalog can be declared `as const` (needed to derive the
  // `McpPromptName` union) while still satisfying this type.
  arguments?: readonly McpPromptArg[];
}

export const MCP_PROMPT_DEFS = [
  {
    name: 'setup_piwi',
    description:
      "Set up the current Playwright project to report to this Piwi Dashboard: install the reporter, wrap the config, add the capture fixtures, and verify a run lands. Server-aware — fills in this dashboard's URL, whether authentication is required, and the projects that already exist.",
    arguments: [
      {
        name: 'projectName',
        description: 'Name to report runs under. Omit to reuse an existing project or derive one from the repository.',
        required: false,
      },
    ],
  },
] as const satisfies readonly McpPromptDef[];

export type McpPromptName = (typeof MCP_PROMPT_DEFS)[number]['name'];
