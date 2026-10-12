import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, type InstalledMock } from './chrome-mock';
import { closeWorkerResources, repo, searchEngine } from '../../../src/background/db';
import {
  handleContextMenuClick,
  registerContextMenus,
  MENU_SAVE_CURRENT_PAGE,
  MENU_SAVE_SELECTION,
} from '../../../src/background/context-menus';
import { plainTextToEditorDoc, linkParagraph } from '../../../src/background/quick-capture';
import { getNote } from '../../../src/core/repo/notes';
import { listNoteLinks } from '../../../src/core/repo/links';
import { DB_NAME } from '../../../src/core/version';

describe('context menu registration (PRD §4.1)', () => {
  let installed: InstalledMock;

  beforeEach(() => {
    installed = installChromeMock();
  });

  afterEach(() => {
    installed.uninstall();
  });

  it('registers the two actions for http/https documents only', () => {
    registerContextMenus();
    expect(installed.removeAllMenusCalls).toBeGreaterThanOrEqual(1);
    expect(installed.createdMenus).toHaveLength(2);
    const page = installed.createdMenus.find((m) => m.id === MENU_SAVE_CURRENT_PAGE);
    const selection = installed.createdMenus.find((m) => m.id === MENU_SAVE_SELECTION);
    expect(page?.contexts).toEqual(['page']);
    expect(page?.documentUrlPatterns).toEqual(['http://*/*', 'https://*/*']);
    expect(selection?.contexts).toEqual(['selection']);
    expect(selection?.documentUrlPatterns).toEqual(['http://*/*', 'https://*/*']);
  });
});

describe('quick capture document builders', () => {
  it('converts plain text lines into schema-valid paragraphs', () => {
    const doc = plainTextToEditorDoc('first line\n\nsecond line\nthird line');
    expect(doc).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'first line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'second line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'third line' }] },
      ],
    });
  });

  it('produces an empty document for blank text', () => {
    expect(plainTextToEditorDoc('   \n  \n')).toEqual({ type: 'doc', content: [] });
  });

  it('builds a link-marked paragraph for the source URL', () => {
    expect(linkParagraph('https://example.org/x', 'Example')).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Example', marks: [{ type: 'link', attrs: { href: 'https://example.org/x' } }] },
      ],
    });
    // Falls back to the URL itself when no anchor text exists.
    expect(linkParagraph('https://example.org/x', '  ')).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'https://example.org/x', marks: [{ type: 'link', attrs: { href: 'https://example.org/x' } }] },
      ],
    });
  });
});

describe('context menu actions (FR §4.1 — explicit invocations only)', () => {
  let installed: InstalledMock;

  beforeEach(() => {
    installed = installChromeMock();
  });

  afterEach(async () => {
    await closeWorkerResources();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    installed.uninstall();
  });

  it('save-selection-as-note creates a note with the selected text and source link', async () => {
    const result = await handleContextMenuClick(
      {
        menuItemId: MENU_SAVE_SELECTION,
        pageUrl: 'https://example.org/article',
        selectionText: 'The needle was found.\nIn a haystack.',
      } as chrome.contextMenus.OnClickData,
      { title: 'An article about needles' } as chrome.tabs.Tab,
    );

    expect(result).not.toBeNull();
    const ctx = await repo();
    const note = await getNote(ctx, result!.noteId as never);
    expect(note?.title).toBe('An article about needles');
    expect(note?.plainText).toBe('The needle was found.\nIn a haystack.');
    expect(note?.editorDoc).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'The needle was found.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'In a haystack.' }] },
      ],
    });
    const links = await listNoteLinks(ctx, result!.noteId as never);
    expect(links).toHaveLength(1);
    expect(links[0]?.originalUrl).toBe('https://example.org/article');

    // Indexed for search (FR-SEARCH-01 body field).
    const search = await (await searchEngine()).execute({ query: 'needle haystack' });
    expect(search.total).toBe(1);
    expect(search.hits[0]?.noteId).toBe(result!.noteId);

    // No tab inspection happened — only the click payload was used.
    const queryCalls = (globalThis as unknown as { chrome: { tabs: { query: { mock: { calls: unknown[][] } } } } })
      .chrome.tabs.query.mock.calls;
    expect(queryCalls).toHaveLength(0);
  });

  it('save-current-page creates a note linking the page URL', async () => {
    const result = await handleContextMenuClick(
      {
        menuItemId: MENU_SAVE_CURRENT_PAGE,
        pageUrl: 'https://example.org/page',
      } as chrome.contextMenus.OnClickData,
      { title: 'The Page' } as chrome.tabs.Tab,
    );

    expect(result).not.toBeNull();
    const ctx = await repo();
    const note = await getNote(ctx, result!.noteId as never);
    expect(note?.title).toBe('The Page');
    expect(note?.plainText).toBe('https://example.org/page');
    expect(note?.editorDoc).toEqual({
      type: 'doc',
      content: [linkParagraph('https://example.org/page', 'The Page')],
    });
    expect(result?.linkId).not.toBeNull();
    const links = await listNoteLinks(ctx, result!.noteId as never);
    expect(links).toHaveLength(1);
    expect(links[0]?.anchorText).toBe('The Page');
  });

  it('titles untitled captures from the selection content', async () => {
    const result = await handleContextMenuClick(
      {
        menuItemId: MENU_SAVE_SELECTION,
        pageUrl: 'https://example.org/',
        selectionText: 'A fairly long selected sentence that should be truncated for the label',
      } as chrome.contextMenus.OnClickData,
      { title: '' } as chrome.tabs.Tab,
    );
    const note = await getNote(await repo(), result!.noteId as never);
    expect(note?.title.startsWith('A fairly long selected sentence')).toBe(true);
    expect((note?.title ?? '').length).toBeLessThanOrEqual(61); // 60 + ellipsis
  });

  it('rejects an empty selection truthfully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      handleContextMenuClick(
        {
          menuItemId: MENU_SAVE_SELECTION,
          pageUrl: 'https://example.org/',
          selectionText: '   ',
        } as chrome.contextMenus.OnClickData,
        { title: 'P' } as chrome.tabs.Tab,
      ),
    ).rejects.toThrow(/selectionText is empty/);
    consoleError.mockRestore();
  });

  it('returns null for unrelated menu ids', async () => {
    const result = await handleContextMenuClick(
      {
        menuItemId: 'some-other-extension-menu',
        pageUrl: 'https://example.org/',
      } as chrome.contextMenus.OnClickData,
    );
    expect(result).toBeNull();
  });
});
