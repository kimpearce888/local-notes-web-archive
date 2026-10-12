import type { SearchField } from '../types';

/**
 * Query syntax parser (FR-SEARCH-04):
 *   "exact phrase"        phrase matching
 *   -term / -"phrase"     exclusion
 *   tag:work              tag filter (multiple allowed)
 *   category:projects     category filter (multiple allowed)
 *   before:2026-01-01     created/modified before a date (RFC3339 date or full)
 *   after:2026-06-01      created/modified after a date
 *   has:link|snapshot|reminder|attachment
 *   is:pinned|favorite|archived|trashed|overdue
 *   in:title|body|snapshot  field scope for subsequent bare terms
 * Invalid syntax produces an inline explanation — never a silent behavior
 * change.
 */

export type HasFlag = 'link' | 'snapshot' | 'reminder' | 'attachment';
export type IsFlag = 'pinned' | 'favorite' | 'archived' | 'trashed' | 'overdue';
export type ScopeField = 'title' | 'body' | 'snapshot';

export interface QueryTerm {
  readonly text: string;
  readonly phrase: boolean;
  readonly exclude: boolean;
  readonly scope: readonly ScopeField[] | null;
}

export interface ParsedQuery {
  readonly terms: readonly QueryTerm[];
  readonly tagNames: readonly string[];
  readonly categoryNames: readonly string[];
  readonly before: string | null;
  readonly after: string | null;
  readonly has: readonly HasFlag[];
  readonly is: readonly IsFlag[];
  readonly errors: readonly string[];
}

const HAS_VALUES = new Set(['link', 'snapshot', 'reminder', 'attachment']);
const IS_VALUES = new Set(['pinned', 'favorite', 'archived', 'trashed', 'overdue']);
const SCOPE_VALUES = new Set(['title', 'body', 'snapshot']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z)?)?$/;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value.endsWith('Z') ? value : `${value}Z`);
  return !Number.isNaN(date.getTime());
}

/** Tokenize respecting quotes; each token retains its raw text. */
function tokenize(input: string): Array<{ raw: string; start: number }> {
  const tokens: Array<{ raw: string; start: number }> = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i] ?? '')) i += 1;
    if (i >= input.length) break;
    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) {
        // Unterminated quote: treat the remainder as a phrase token so the
        // parser reports the same semantics as a closed phrase.
        tokens.push({ raw: `${input.slice(i)}"`, start: i });
        break;
      }
      tokens.push({ raw: input.slice(i, end + 1), start: i });
      i = end + 1;
    } else {
      let end = i;
      while (end < input.length && !/\s/.test(input[end] ?? '')) end += 1;
      tokens.push({ raw: input.slice(i, end), start: i });
      i = end;
    }
  }
  return tokens;
}

export function parseQuery(input: string): ParsedQuery {
  const terms: QueryTerm[] = [];
  const tagNames: string[] = [];
  const categoryNames: string[] = [];
  const has: HasFlag[] = [];
  const is: IsFlag[] = [];
  const errors: string[] = [];
  let before: string | null = null;
  let after: string | null = null;
  let defaultScope: readonly ScopeField[] | null = null;

  for (const token of tokenize(input)) {
    const raw = token.raw;
    const lower = raw.toLocaleLowerCase('en-US');

    // Exclusion marker.
    let body = raw;
    let exclude = false;
    if (body.startsWith('-') && body.length > 1) {
      exclude = true;
      body = body.slice(1);
    }

    if (lower === '-"') continue;

    // Key:value operators.
    const colon = body.indexOf(':');
    if (colon > 0 && !body.startsWith('"')) {
      const key = body.slice(0, colon).toLocaleLowerCase('en-US');
      const value = body.slice(colon + 1);
      if (value !== '') {
        let handled = true;
        switch (key) {
          case 'tag':
            if (exclude) errors.push(`tag:${value} cannot be excluded with "-"`);
            else tagNames.push(value);
            break;
          case 'category':
            if (exclude) errors.push(`category:${value} cannot be excluded with "-"`);
            else categoryNames.push(value);
            break;
          case 'before':
            if (exclude) errors.push('before: cannot be excluded');
            else if (!isValidDate(value)) errors.push(`before:${value} is not a valid date (use YYYY-MM-DD)`);
            else before = value;
            break;
          case 'after':
            if (exclude) errors.push('after: cannot be excluded');
            else if (!isValidDate(value)) errors.push(`after:${value} is not a valid date (use YYYY-MM-DD)`);
            else after = value;
            break;
          case 'has': {
            if (exclude) {
              errors.push(`has:${value} cannot be excluded`);
            } else if (HAS_VALUES.has(value)) {
              has.push(value as HasFlag);
            } else {
              errors.push(`has:${value} is unknown (expected link, snapshot, reminder or attachment)`);
            }
            break;
          }
          case 'is': {
            if (exclude) {
              errors.push(`is:${value} cannot be excluded`);
            } else if (IS_VALUES.has(value)) {
              is.push(value as IsFlag);
            } else {
              errors.push(`is:${value} is unknown (expected pinned, favorite, archived, trashed or overdue)`);
            }
            break;
          }
          case 'in': {
            if (exclude) {
              errors.push(`in:${value} cannot be excluded`);
            } else if (SCOPE_VALUES.has(value)) {
              defaultScope = [value as ScopeField];
            } else {
              errors.push(`in:${value} is unknown (expected title, body or snapshot)`);
            }
            break;
          }
          default:
            handled = false;
        }
        if (handled) continue;
      } else {
        errors.push(`"${body}" has an empty value after "${raw.slice(0, colon + 1)}"`);
        continue;
      }
    }

    // Quoted phrase or bare term.
    if (body.startsWith('"') && body.endsWith('"') && body.length >= 2) {
      const phraseText = body.slice(1, -1);
      if (phraseText !== '') {
        terms.push({ text: phraseText, phrase: true, exclude, scope: defaultScope });
      }
      continue;
    }
    if (body !== '') {
      terms.push({ text: body, phrase: false, exclude, scope: defaultScope });
    }
  }

  // An impossible window: the before-boundary earlier than the after-boundary.
  if (before && after && before < after) {
    errors.push('before: date is earlier than after: date (empty date range)');
  }

  return { terms, tagNames, categoryNames, before, after, has, is, errors };
}

/** Map a scope field to MiniSearch document fields. */
export function scopeToFields(scope: readonly ScopeField[] | null): SearchField[] | null {
  if (scope === null) return null;
  const fields: SearchField[] = [];
  for (const entry of scope) {
    if (entry === 'title') fields.push('title', 'subtitle');
    if (entry === 'body') fields.push('body', 'tags', 'categories', 'attachments');
    if (entry === 'snapshot') fields.push('snapshots', 'links');
  }
  return fields.length > 0 ? fields : null;
}
