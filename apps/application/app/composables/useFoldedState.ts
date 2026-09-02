/**
 * SSR-safe folded/expanded boolean persisted in a cookie so the state survives
 * navigation and reloads. Reads the cookie on both server (request headers) and
 * client (document.cookie); only overrides `defaultFolded` when the cookie is
 * present.
 */
export function useFoldedState(cookieKey: string, defaultFolded = false) {
  const folded = ref(defaultFolded);

  if (import.meta.server) {
    try {
      const headers = useRequestHeaders(['cookie']);
      const cookieStr = headers.cookie || '';
      const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${cookieKey}=([^;]*)`));
      if (match) {
        folded.value = match[1] === 'true';
      }
    } catch {
      // headers not available
    }
  } else {
    try {
      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${cookieKey}=([^;]*)`));
      if (match) {
        folded.value = match[1] === 'true';
      }
    } catch {
      // document not available
    }
  }

  function persist() {
    if (import.meta.client) {
      document.cookie = `${cookieKey}=${folded.value}; path=/; max-age=31536000; sameSite=lax`;
    }
  }

  function toggle() {
    folded.value = !folded.value;
    persist();
  }

  function setFolded(value: boolean) {
    folded.value = value;
    persist();
  }

  return { folded, toggle, setFolded };
}
