import { describe, test, expect, vi, afterEach } from 'vitest';
import { computed, ref } from 'vue';
import { Role } from '../../shared/types';
import type { AuthState } from '../../types/api';

/**
 * Covers `canSeeAdmin` — the rule deciding whether admin-only surfaces (Settings'
 * Analysis section, the Setup page and its link) are shown.
 *
 * It is tested here at its definition rather than only through consumers,
 * because `use-settings-nav.test.ts` stubs `useAuth` wholesale: without this
 * file, that stub would be asserting a hand-written copy of the rule, and the
 * real implementation could drift from it undetected.
 *
 * The rest of `useAuth` (login, logout, fetchUser, the demo switcher) is
 * exercised by the E2E suite — only setup-time state is stubbed here.
 */
function loadUseAuth(opts: { authEnabled?: boolean; role?: Role | null }) {
  const state = ref<AuthState>({
    authenticated: opts.role != null,
    user: opts.role == null ? null : { id: 1, username: 'u', role: opts.role, name: 'U' },
  });

  vi.stubGlobal('computed', computed);
  vi.stubGlobal('useState', (_key: string, init: () => AuthState) => {
    if (!state.value) state.value = init();
    return state;
  });
  vi.stubGlobal('useRuntimeConfig', () => ({
    public: { authEnabled: opts.authEnabled ?? false, demoMode: false },
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Fresh import per case, so the stubs above are in place when the module loads. */
async function canSeeAdmin(opts: { authEnabled?: boolean; role?: Role | null }): Promise<boolean> {
  loadUseAuth(opts);
  const { useAuth } = await import('../../app/composables/useAuth');
  return useAuth().canSeeAdmin.value;
}

describe('useAuth().canSeeAdmin', () => {
  test('is true for everyone when authentication is disabled', async () => {
    // No users exist at all in this mode, so nobody holds the administrator
    // role. Gating on `isAdmin` alone would hide Storage, Tags, AI and Setup
    // from every visitor on a default self-hosted install — and in the desktop
    // build, which runs single-user with auth off and needs Setup for its own
    // reporter token and MCP configuration.
    expect(await canSeeAdmin({ authEnabled: false, role: null })).toBe(true);
  });

  test('is true for an administrator when authentication is enabled', async () => {
    expect(await canSeeAdmin({ authEnabled: true, role: Role.ADMINISTRATOR })).toBe(true);
  });

  test('is false for a non-administrator when authentication is enabled', async () => {
    expect(await canSeeAdmin({ authEnabled: true, role: Role.REPORTER })).toBe(false);
  });

  test('is false for an unauthenticated visitor when authentication is enabled', async () => {
    expect(await canSeeAdmin({ authEnabled: true, role: null })).toBe(false);
  });

  test('differs from isAdmin exactly in the auth-disabled case', async () => {
    loadUseAuth({ authEnabled: false, role: null });
    const { useAuth } = await import('../../app/composables/useAuth');
    const auth = useAuth();

    expect(auth.isAdmin.value).toBe(false);
    expect(auth.canSeeAdmin.value).toBe(true);
  });
});
