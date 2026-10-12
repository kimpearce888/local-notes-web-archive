/**
 * Find-in-note with replace (PRD §4.4): case-sensitive and
 * case-insensitive search over the editor's text with position-based
 * navigation (next/previous), replace-one and replace-all. Positions are
 * computed against the plain-text projection so every match is a real
 * user-visible text occurrence.
 */

export interface FindMatch {
  /** Index into the plain-text projection. */
  readonly from: number;
  readonly to: number;
}

export function findMatches(
  text: string,
  query: string,
  options: { caseSensitive: boolean } = { caseSensitive: false },
): FindMatch[] {
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const haystack = options.caseSensitive ? text : text.toLowerCase();
  if (needle.length === 0) return [];
  const matches: FindMatch[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    matches.push({ from: index, to: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return matches;
}

export interface FindState {
  readonly matches: readonly FindMatch[];
  readonly activeIndex: number;
}

export function nextMatch(state: FindState): FindState {
  if (state.matches.length === 0) return { matches: [], activeIndex: -1 };
  return { ...state, activeIndex: (state.activeIndex + 1) % state.matches.length };
}

export function previousMatch(state: FindState): FindState {
  if (state.matches.length === 0) return { matches: [], activeIndex: -1 };
  return {
    ...state,
    activeIndex: (state.activeIndex - 1 + state.matches.length) % state.matches.length,
  };
}

/**
 * Applies replacements to a plain-text projection. The editor layer maps
 * these offsets back into the document; replaceAll is the whole-string
 * operation used for correctness.
 */
export function replaceAllInText(text: string, query: string, replacement: string, caseSensitive: boolean): string {
  if (query.length === 0) return text;
  if (caseSensitive) return text.split(query).join(replacement);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'gi'), replacement);
}
