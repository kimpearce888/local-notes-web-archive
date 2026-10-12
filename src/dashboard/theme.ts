/**
 * Theme engine (PRD §4.1, FR-SET-01): light / dark / system preference
 * applied via a `data-theme` attribute on the document element. The system
 * mode tracks the OS preference live. Persistence is owned by the settings
 * store (T-015 wires it); this module only resolves and applies.
 */

export type ThemePreference = 'light' | 'dark' | 'system';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeManager {
  /** Currently applied preference (never 'auto' — always concrete). */
  readonly preference: () => ThemePreference;
  /** The concrete theme the preference currently resolves to. */
  readonly resolved: () => 'light' | 'dark';
  setPreference(preference: ThemePreference): void;
  /** Subscribes to concrete-theme changes; returns an unsubscribe fn. */
  onChange(listener: (resolved: 'light' | 'dark') => void): () => void;
  dispose(): void;
}

function applyPreference(root: HTMLElement, preference: ThemePreference): void {
  // The stylesheet keys dark styling off [data-theme='dark'] and the
  // system-dark media query under [data-theme='system'].
  root.setAttribute('data-theme', preference);
}

export function createThemeManager(
  root: HTMLElement,
  initial: ThemePreference = 'system',
  matchMedia: (query: string) => MediaQueryList = (query) => window.matchMedia(query),
): ThemeManager {
  let preference: ThemePreference = initial;
  const listeners = new Set<(resolved: 'light' | 'dark') => void>();
  applyPreference(root, preference);

  const media = matchMedia(DARK_MEDIA_QUERY);
  const onMediaChange = (): void => {
    if (preference === 'system') notify();
  };
  media.addEventListener?.('change', onMediaChange);

  function resolved(): 'light' | 'dark' {
    if (preference === 'system') return media.matches ? 'dark' : 'light';
    return preference;
  }

  function notify(): void {
    const current = resolved();
    for (const listener of listeners) listener(current);
  }

  return {
    preference: () => preference,
    resolved,
    setPreference(next: ThemePreference): void {
      const before = resolved();
      preference = next;
      applyPreference(root, preference);
      const after = resolved();
      if (before !== after || next !== 'system') notify();
    },
    onChange(listener: (resolved: 'light' | 'dark') => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      media.removeEventListener?.('change', onMediaChange);
      listeners.clear();
    },
  };
}
