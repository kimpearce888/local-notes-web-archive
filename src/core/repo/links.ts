import type { EntityId, Link } from '../types';
import { newId } from '../util/ids';
import { nowUtc } from '../util/time';
import { dedupKey, originOf, parseUrl } from '../util/urls';
import { Store } from '../db/schema';
import type { RepoContext } from './context';

/**
 * Links repository (FR-CAP-01..08): URLs detected in notes with normalized
 * deduplication keys, origin bookkeeping and snapshot association.
 */

export class InvalidUrlError extends Error {
  constructor(readonly url: string) {
    super(`"${url}" is not a valid absolute URL`);
    this.name = 'InvalidUrlError';
  }
}

export interface CreateLinkResult {
  readonly link: Link;
  /** False when an equivalent link already existed and was returned instead. */
  readonly created: boolean;
}

/**
 * Create (or return the existing) link on a note. URLs are stored as-entered;
 * dedup is per note + normalized key so double-pasting does not duplicate.
 */
export async function createLink(
  ctx: RepoContext,
  noteId: EntityId,
  url: string,
  anchorText = '',
): Promise<CreateLinkResult> {
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
  return hits[0] ?? null;
}

export async function getLink(ctx: RepoContext, id: EntityId): Promise<Link | null> {
  return ctx.get<Link>(Store.Links, id);
}

export async function listNoteLinks(ctx: RepoContext, noteId: EntityId): Promise<Link[]> {
  const links = await ctx.getByIndex<Link>(Store.Links, 'noteId', noteId);
  return links.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** Links with the same dedup key across all notes (duplicate-capture policy). */
export async function findLinksByUrl(ctx: RepoContext, url: string): Promise<Link[]> {
  const key = dedupKey(url);
  if (!key) return [];
  const links = await ctx.getByIndex<Link>(Store.Links, 'dedupKey', key);
  return links;
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
      if (link) store.put({ ...link, snapshotId });
    };
  });
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
