/**
 * Find-in-note with replace (PRD §4.4): case-sensitive and
 * case-insensitive search over the editor's text with position-based
 * navigation (next/previous), replace-one and replace-all. Positions are
 * computed against the plain-text projection so every match is a real
 * user-visible text occurrence. Replacements are applied INSIDE text nodes
 * (QA-D08): the document's structure, marks, tables, code blocks and images
 * are never rebuilt from plain text.
 */

import type { Editor } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';

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
 * Applies replacements to a plain-text projection. Used ONLY per text node
 * by replaceInDocument — never against the whole document, which would
 * flatten structure (the QA-D08 bug: the panel used to rebuild the entire
 * note as one escaped paragraph, silently destroying headings, lists,
 * tables, code blocks, images and link marks).
 */
export function replaceAllInText(text: string, query: string, replacement: string, caseSensitive: boolean): string {
  if (query.length === 0) return text;
  if (caseSensitive) return text.split(query).join(replacement);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'gi'), replacement);
}

/** A single queued text-node replacement (applied in reverse doc order). */
interface TextNodeReplacement {
  /** Document position of the text node's first character. */
  readonly pos: number;
  readonly original: string;
  readonly replacement: string;
  readonly marks: readonly Mark[];
}

function localMatchIndices(text: string, query: string, caseSensitive: boolean): number[] {
  if (query.length === 0) return [];
  if (caseSensitive) {
    const indices: number[] = [];
    let index = text.indexOf(query);
    while (index !== -1) {
      indices.push(index);
      index = text.indexOf(query, index + query.length);
    }
    return indices;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(text.matchAll(new RegExp(escaped, 'gi')), (match) => match.index ?? 0);
}

/**
 * QA-D08 fix: replace occurrences INSIDE text nodes so document structure,
 * marks, tables, code blocks and images are preserved. The find bar's query
 * comes from a single-line input, so no match can span a block separator and
 * per-text-node replacement is exactly equivalent to the plain-text
 * projection's match list, in the same document order.
 *
 * `occurrence` selects the Nth match in document order (0-based) or `'all'`.
 * Returns the number of occurrences replaced (0 when nothing matched).
 */
export function replaceInDocument(
  editor: Editor,
  query: string,
  replacement: string,
  caseSensitive: boolean,
  occurrence: number | 'all',
): number {
  if (query.length === 0 || editor.isDestroyed) return 0;
  const replacements: TextNodeReplacement[] = [];
  let replaced = 0;
  let seen = 0;
  let done = false;
  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (done) return false;
    const text = node.text;
    if (!node.isText || text === null || text === undefined || text.length === 0) return true;
    const indices = localMatchIndices(text, query, caseSensitive);
    if (indices.length === 0) return true;
    if (occurrence === 'all') {
      const next = replaceAllInText(text, query, replacement, caseSensitive);
      if (next !== text) {
        replacements.push({ pos, original: text, replacement: next, marks: node.marks });
      }
      replaced += indices.length;
      return true;
    }
    const target = occurrence - seen;
    if (target >= 0 && target < indices.length) {
      const at = indices[target] as number;
      const next = text.slice(0, at) + replacement + text.slice(at + query.length);
      replacements.push({ pos, original: text, replacement: next, marks: node.marks });
      replaced += 1;
      done = true;
      return false;
    }
    seen += indices.length;
    return true;
  });
  if (replacements.length === 0) return replaced;
  editor
    .chain()
    .command(({ tr, state }) => {
      // Reverse document order keeps earlier positions valid as later spans change.
      for (const item of [...replacements].reverse()) {
        tr.replaceWith(
          item.pos,
          item.pos + item.original.length,
          state.schema.text(item.replacement, item.marks),
        );
      }
      return true;
    })
    .run();
  return replaced;
}
