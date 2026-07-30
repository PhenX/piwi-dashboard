/**
 * Shared state for the `/docs` "Try it out" console.
 *
 * The bearer token is entered once and reused across every operation's console,
 * persisted per-browser (like the IDE preferences) so it survives reloads. It is
 * only ever sent to the same-origin API when the user clicks Send — never to a
 * third party.
 */
export function useApiConsole() {
  const token = useLocalStorage('piwi-api-token', '');
  return { token };
}
