import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

function rpc(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

async function mcp(request: any, method: string, params?: Record<string, unknown>) {
  const res = await request.post('/mcp', { data: rpc(method, params) });
  expect(res.ok(), `${method} should succeed`).toBeTruthy();
  return res.json();
}

test.describe.serial('MCP server', () => {
  let projectId: number;
  let runId: number;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.MCP_TEST,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 3,
        passedTests: 1,
        failedTests: 2,
        skippedTests: 0,
        testCases: [
          { title: 'login works', status: 'passed', duration: 1000, location: 'tests/auth.spec.ts:5:1' },
          {
            title: 'checkout fails',
            status: 'failed',
            duration: 2000,
            location: 'tests/checkout.spec.ts:10:1',
            error: 'Expected button to be visible',
            retries: 0,
          },
          {
            title: 'payment fails',
            status: 'failed',
            duration: 2000,
            location: 'tests/payment.spec.ts:15:1',
            error: 'Expected button to be visible',
            retries: 1,
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    projectId = data.projectId;
    runId = data.testRunId;
  });

  test('initialize — returns server info and capabilities', async ({ request }) => {
    const body = await mcp(request, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    });
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('piwi-dashboard');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  test('ping — returns empty result', async ({ request }) => {
    const body = await mcp(request, 'ping');
    expect(body.result).toEqual({});
  });

  test('tools/list — returns all tools', async ({ request }) => {
    const body = await mcp(request, 'tools/list');
    const tools: { name: string }[] = body.result.tools;
    expect(tools.length).toBe(38);
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_projects');
    expect(names).toContain('get_run');
    expect(names).toContain('get_cluster_context');
    expect(names).toContain('search_test_cases');
    expect(names).toContain('get_test_run_case');
    expect(names).toContain('list_recent_activity');
    expect(names).toContain('get_repo_commits');
    expect(names).toContain('get_repo_diff');
    // New tools
    expect(names).toContain('get_run_insights');
    expect(names).toContain('get_spec_health');
    expect(names).toContain('get_network_requests');
    expect(names).toContain('get_locator_healing');
    expect(names).toContain('search');
    expect(names).toContain('explain_failure');
    expect(names).toContain('set_cluster_status');
    expect(names).toContain('list_open_clusters');
    // Every tool has a description and inputSchema
    for (const t of tools) {
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('inputSchema');
    }
  });

  test('tools/call list_projects — returns project list with stats', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'list_projects', arguments: {} });
    const text = body.result.content[0].text;
    const projects = JSON.parse(text);
    expect(Array.isArray(projects)).toBe(true);
    const project = projects.find((p: any) => p.name === PROJECT.MCP_TEST);
    expect(project).toBeDefined();
    expect(project.id).toBe(projectId);
    expect(project.totalRuns).toBeGreaterThan(0);
  });

  test('tools/call get_project — returns project with runs', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'get_project', arguments: { id: projectId } });
    const data = JSON.parse(body.result.content[0].text);
    expect(data.id).toBe(projectId);
    expect(data.name).toBe(PROJECT.MCP_TEST);
    expect(Array.isArray(data.runs)).toBe(true);
    expect(data.runs.length).toBeGreaterThan(0);
  });

  test('tools/call list_runs — filters by projectId', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'list_runs', arguments: { projectId } });
    const result = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].status).toBe('failed');
  });

  test('tools/call get_run — returns summary and failed cases', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'get_run', arguments: { id: runId } });
    const run = JSON.parse(body.result.content[0].text);
    expect(run.id).toBe(runId);
    expect(run.status).toBe('failed');
    expect(run.failed).toBe(2);
    expect(run.passed).toBe(1);
    // Default filter is "failed" — should include the 2 failed cases
    expect(run.cases.length).toBe(2);
    expect(run.cases[0]).toHaveProperty('title');
    expect(run.cases[0]).toHaveProperty('status');
    // Null values should be omitted from compact output
    expect(run.cases[0].error).not.toBeNull();
  });

  test('tools/call get_run with status_filter=all — returns all cases', async ({ request }) => {
    const body = await mcp(request, 'tools/call', {
      name: 'get_run',
      arguments: { id: runId, status_filter: 'all' },
    });
    const run = JSON.parse(body.result.content[0].text);
    expect(run.total).toBe(3);
    expect(run.cases.length).toBe(3);
  });

  test('tools/call get_run — paginates cases with pageSize', async ({ request }) => {
    const body = await mcp(request, 'tools/call', {
      name: 'get_run',
      arguments: { id: runId, status_filter: 'all', pageSize: 2 },
    });
    const run = JSON.parse(body.result.content[0].text);
    expect(run.cases.length).toBe(2);
    expect(run.nextCursor).toBeTruthy();
    const page2 = await mcp(request, 'tools/call', {
      name: 'get_run',
      arguments: { id: runId, status_filter: 'all', pageSize: 2, cursor: run.nextCursor },
    });
    const run2 = JSON.parse(page2.result.content[0].text);
    expect(run2.cases.length).toBe(1);
    // Pages are disjoint
    const ids1 = run.cases.map((c: any) => c.executionId);
    const ids2 = run2.cases.map((c: any) => c.executionId);
    expect(ids1.some((x: number) => ids2.includes(x))).toBe(false);
  });

  test('tools/call list_failed_cases — returns failed cases for project', async ({ request }) => {
    const body = await mcp(request, 'tools/call', {
      name: 'list_failed_cases',
      arguments: { projectId, runId },
    });
    const result = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBe(2);
    expect(result.items[0]).toHaveProperty('title');
    expect(result.items[0]).toHaveProperty('error');
  });

  test('tools/call list_clusters — returns cluster list', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'list_clusters', arguments: { projectId } });
    const result = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(result.items)).toBe(true);
    // Two similar errors should be grouped into at least one cluster
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toHaveProperty('id');
    expect(result.items[0]).toHaveProperty('status');
  });

  test('tools/call list_failed_cases — cursor paginates without error (regression)', async ({ request }) => {
    const p1 = JSON.parse(
      (await mcp(request, 'tools/call', { name: 'list_failed_cases', arguments: { projectId, runId, pageSize: 1 } }))
        .result.content[0].text,
    );
    expect(p1.items.length).toBe(1);
    expect(p1.nextCursor).toBeTruthy();
    expect(String(p1.nextCursor)).not.toBe('undefined');
    const p2res = await mcp(request, 'tools/call', {
      name: 'list_failed_cases',
      arguments: { projectId, runId, pageSize: 1, cursor: p1.nextCursor },
    });
    // The bug made this a JSON-RPC error (Number("undefined") → NaN SQL query).
    expect(p2res.error).toBeUndefined();
    const p2 = JSON.parse(p2res.result.content[0].text);
    expect(p2.items.length).toBe(1);
    expect(p2.items[0].executionId).not.toBe(p1.items[0].executionId);
  });

  test('tools/call list_flaky_tests — stat fields are populated (regression)', async ({ request }) => {
    const result = JSON.parse(
      (await mcp(request, 'tools/call', { name: 'list_flaky_tests', arguments: { projectId } })).result.content[0].text,
    );
    expect(Array.isArray(result.items)).toBe(true);
    // The bug stripped every stat via dropNulls; when present, flakyScore is a number.
    for (const item of result.items) {
      expect(typeof item.flakyScore).toBe('number');
      expect(typeof item.runCount).toBe('number');
    }
  });

  test('tools/call get_test_case_context — returns evidence sections (regression)', async ({ request }) => {
    const run = JSON.parse(
      (await mcp(request, 'tools/call', { name: 'get_run', arguments: { id: runId, status_filter: 'failed' } })).result
        .content[0].text,
    );
    const execId = run.cases[0].executionId;
    const ctx = JSON.parse(
      (await mcp(request, 'tools/call', { name: 'get_test_case_context', arguments: { id: execId } })).result.content[0]
        .text,
    );
    // Previously execution scope produced an empty coverage stub with 0 sections.
    const hasEvidence = (ctx.sections?.length ?? 0) > 0 || !!ctx.rawExecution;
    expect(hasEvidence).toBe(true);
  });

  test('tools/call get_run_insights — returns baseline comparison shape', async ({ request }) => {
    const insights = JSON.parse(
      (await mcp(request, 'tools/call', { name: 'get_run_insights', arguments: { id: runId } })).result.content[0].text,
    );
    expect(insights.runId).toBe(runId);
    expect(typeof insights.passRate).toBe('number');
    expect(typeof insights.hasBaseline).toBe('boolean');
    // Empty arrays are stripped by dropNulls; when present, it's an array.
    if (insights.newRegressions !== undefined) expect(Array.isArray(insights.newRegressions)).toBe(true);
  });

  test('tools/call search — global search returns grouped results', async ({ request }) => {
    const res = JSON.parse(
      (await mcp(request, 'tools/call', { name: 'search', arguments: { q: 'checkout' } })).result.content[0].text,
    );
    expect(res).toHaveProperty('projects');
    expect(res).toHaveProperty('runs');
    expect(res).toHaveProperty('cases');
  });

  test('tools/call set_cluster_status — triages a cluster', async ({ request }) => {
    const clusters = JSON.parse(
      (await mcp(request, 'tools/call', { name: 'list_clusters', arguments: { projectId } })).result.content[0].text,
    );
    const clusterId = clusters.items[0].id;
    const res = JSON.parse(
      (
        await mcp(request, 'tools/call', {
          name: 'set_cluster_status',
          arguments: { id: clusterId, status: 'resolved', triageNote: 'fixed by test' },
        })
      ).result.content[0].text,
    );
    expect(res.ok).toBe(true);
    expect(res.status).toBe('resolved');
  });

  test('tools/call with unknown tool — returns method error', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'nonexistent_tool', arguments: {} });
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32602);
  });

  test('unknown method — returns method not found error', async ({ request }) => {
    const body = await mcp(request, 'unknown/method');
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
  });

  test('batch requests — handles array of JSON-RPC messages', async ({ request }) => {
    const res = await request.post('/mcp', {
      data: [rpc('ping', {}, 1), rpc('tools/list', {}, 2)],
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    const ping = body.find((r: any) => r.id === 1);
    const list = body.find((r: any) => r.id === 2);
    expect(ping.result).toEqual({});
    expect(list.result.tools.length).toBe(38);
  });
});
