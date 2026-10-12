import type { EntityId, Link, LinkCaptureState } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { dedupKey, originOf, parseUrl } from '../util/urls';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Links repository (FR-CAP-01..08): URLs detected in notes with normalized
 * deduplication keys, origin bookkeeping, capture lifecycle state and
 * snapshot association.
 */

export class InvalidUrlError extends Error {
  constructor(readonly url: string) {
    super(`"${url}" is not a valid absolute URL`);
    this.name = 'InvalidUrlError';
  }
}

export class LinkNotFoundError extends Error {
  constructor(readonly linkId: EntityId) {
    super(`link ${linkId} was not found`);
    this.name = 'LinkNotFoundError';
  }
}

/**
 * Normalise records written before captureState existed (T-020): a link
 * with a snapshot was captured; anything else was merely detected.
 */
function normalizeLink(link: Link): Link {
  if (link.captureState) return link;
  return { ...link, captureState: link.snapshotId ? 'captured' : 'detected' };
}

export interface CreateLinkResult {
  readonly link: Link;
  /** False when an equivalent link already existed and was returned instead. */
  readonly created: boolean;
}

/**
 * Create (or return the existing) link on a note. URLs are stored as-entered;
 * dedup is per note + normalized key so double-pasting does not duplicate.
 * Only http(s) URLs may become link records — links feed the capture
 * pipeline, so browser-internal and script-capable schemes are rejected
 * (security rule: approved link protocols only; mailto stays an editor
 * concern, never a capture target).
 */
export async function createLink(
  ctx: RepoContext,
  noteId: EntityId,
  url: string,
  anchorText = '',
  captureState: LinkCaptureState = 'detected',
): Promise<CreateLinkResult> {
  const parts = parseUrl(url);
  if (!parts || (parts.scheme !== 'http' && parts.scheme !== 'https')) {
    throw new InvalidUrlError(url);
  }
  const key = dedupKey(url);
  if (!key) throw new InvalidUrlError(url);
  const origin = originOf(url);
  if (!origin) throw new InvalidUrlError(url);
  const existing = await findLinkByDedup(ctx, noteId, key);
  if (existing) return { link: existing, created: false };
  const link: Link = {
    id: newId(),
    noteId,
    originalUrl: url,
    dedupKey: key,
    anchorText,
    origin,
    createdAt: nowUtc(),
    snapshotId: null,
    captureState,
  };
  await ctx.transaction([Store.Links], 'readwrite', (stores) => {
    stores[Store.Links]?.put(link);
  });
  return { link, created: true };
}

export async function findLinkByDedup(
  ctx: RepoContext,
  noteId: EntityId,
  key: string,
): Promise<Link | null> {
  const hits = await ctx.getByIndex<Link>(Store.Links, 'note_dedup', [noteId, key]);
  const link = hits[0] ?? null;
  return link ? normalizeLink(link) : null;
}

export async function getLink(ctx: RepoContext, id: EntityId): Promise<Link | null> {
  const link = await ctx.get<Link>(Store.Links, id);
  return link ? normalizeLink(link) : null;
}

export async function listNoteLinks(ctx: RepoContext, noteId: EntityId): Promise<Link[]> {
  const links = await ctx.getByIndex<Link>(Store.Links, 'noteId', noteId);
  return links.map(normalizeLink).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** Links with the same dedup key across all notes (duplicate-capture policy). */
export async function findLinksByUrl(ctx: RepoContext, url: string): Promise<Link[]> {
  const key = dedupKey(url);
  if (!key) return [];
  const links = await ctx.getByIndex<Link>(Store.Links, 'dedupKey', key);
  return links.map(normalizeLink);
}

export async function setLinkSnapshot(
  ctx: RepoContext,
  linkId: EntityId,
  snapshotId: EntityId | null,
): Promise<void> {
  await ctx.transaction([Store.Links], 'readwrite', (stores) => {
    const store = stores[Store.Links];
    if (!store) throw new Error('links store unavailable');
    const req = store.get(linkId);
    req.onsuccess = () => {
      const link = req.result as Link | undefined;
      if (link) {
        // A snapshot association IS the captured state (capture pipeline
        // clears it on retry by removing the snapshot reference first).
        store.put({
          ...normalizeLink(link),
          snapshotId,
          captureState: snapshotId ? 'captured' : 'detected',
        });
      }
    };
  });
}

/**
 * Explicit capture-lifecycle transition (FR-CAP-01/03). `captured` and
 * `detected` are derived from snapshotId in setLinkSnapshot — allowed here
 * covers queue/retry/cancel/permission/progress transitions.
 */
export async function setLinkCaptureState(
  ctx: RepoContext,
  linkId: EntityId,
  captureState: LinkCaptureState,
): Promise<Link> {
  const existing = await getLink(ctx, linkId);
  if (!existing) throw new LinkNotFoundError(linkId);
  const updated: Link = { ...existing, captureState };
  await ctx.transaction([Store.Links], 'readwrite', (stores) => {
    stores[Store.Links]?.put(updated);
  });
  return updated;
}

export async function updateLinkAnchor(
  ctx: RepoContext,
  linkId: EntityId,
  anchorText: string,
): Promise<void> {
  await ctx.transaction([Store.Links], 'readwrite', (stores) => {
    const store = stores[Store.Links];
    if (!store) throw new Error('links store unavailable');
    const req = store.get(linkId);
    req.onsuccess = () => {
      const link = req.result as Link | undefined;
      if (link) store.put({ ...link, anchorText });
    };
  });
}

/** Delete a link (its snapshots survive as standalone archives). */
export async function deleteLink(ctx: RepoContext, linkId: EntityId): Promise<void> {
  await ctx.transaction([Store.Links], 'readwrite', (stores) => {
    stores[Store.Links]?.delete(linkId);
  });
}

/** Normalize for display: absolute URL with origin lowercased. */
export function canonicalDisplayUrl(url: string): string {
  return parseUrl(url)?.href ?? url;
}
