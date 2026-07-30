import { createSharedComposable } from '@vueuse/core';

const _useDashboard = () => {
  const router = useRouter();

  // "Go to" chords, mirroring the sidebar nav. `defineShortcuts` ignores these
  // while an input/textarea/contenteditable is focused, so they never fire mid-typing.
  defineShortcuts({
    'g-h': () => router.push('/'),
    'g-p': () => router.push('/projects'),
    'g-a': () => router.push('/analytics'),
    'g-s': () => router.push('/settings'),
  });

  return {};
};

export const useDashboard = createSharedComposable(_useDashboard);
