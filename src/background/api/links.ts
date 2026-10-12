/**
 * Links API (FR-CAP-01): URL records attached to notes with normalized
 * dedup keys. The capture queue (T-022) processes links for snapshots;
 * this surface manages the records themselves.
 */

import type { MessageRouter } from '../router';
import { repo } from '../db';
import { createLink, deleteLink, findLinksByUrl, listNoteLinks, updateLinkAnchor } from '../../core/repo/links';
import { asId, asObject, asOptionalString, asString } from './validate';

export function registerLinkApi(router: MessageRouter): void {
  router.register('links/create', async (payload) => {
    const p = asObject(payload, 'links/create');
    const result = await createLink(
      await repo(),
      asId(p['noteId'], 'noteId'),
      asString(p['url'], 'url', { maxLength: 8192 }),
      asOptionalString(p['anchorText'], 'anchorText', { maxLength: 2000, allowEmpty: true }) ?? '',
    );
    return result;
  });

  router.register('links/list-for-note', async (payload) => {
    const p = asObject(payload, 'links/list-for-note');
    const links = await listNoteLinks(await repo(), asId(p['noteId'], 'noteId'));
    return { links };
  });

  router.register('links/find-by-url', async (payload) => {
    const p = asObject(payload, 'links/find-by-url');
    const links = await findLinksByUrl(await repo(), asString(p['url'], 'url', { maxLength: 8192 }));
    return { links };
  });

  router.register('links/update-anchor', async (payload) => {
    const p = asObject(payload, 'links/update-anchor');
    await updateLinkAnchor(
      await repo(),
      asId(p['linkId'], 'linkId'),
      asString(p['anchorText'], 'anchorText', { maxLength: 2000, allowEmpty: true }),
    );
    return { updated: true };
  });

  router.register('links/delete', async (payload) => {
    const p = asObject(payload, 'links/delete');
    await deleteLink(await repo(), asId(p['linkId'], 'linkId'));
    return { deleted: true };
  });
}
