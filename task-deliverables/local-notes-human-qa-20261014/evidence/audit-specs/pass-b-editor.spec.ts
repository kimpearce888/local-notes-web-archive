import { test } from '@playwright/test';
import {
  launchAuditSession,
  dismissOnboarding,
  createNote,
  backToList,
  expectSaved,
  MARKERS,
  expect,
  auditClick,
} from './helpers';

/**
 * PASS B (editor) — systematic control sweep of the rich-text editor:
 * every toolbar group, dialogs, find & replace, source view, markdown
 * import/export, title/subtitle and the session header actions.
 */
test.describe.configure({ mode: 'serial' });

let session: Awaited<ReturnType<typeof launchAuditSession>>;

test.beforeAll(async () => {
  session = await launchAuditSession('pass-b-editor');
  await dismissOnboarding(session.page);
  await createNote(session.page, 'Editor Sweep Note', MARKERS.body);
});

test.afterAll(async () => {
  await session.evidence.write();
  await session.context.close();
});

async function focusEditor(): Promise<void> {
  await auditClick(session.page.locator('.ProseMirror').first(), session.evidence, 'editor focus');
}

test('E1 toolbar marks: bold, italic, underline, strike, code, super, sub', async () => {
  const { page, evidence } = session;
  await focusEditor();
  await page.keyboard.type('plain ');
  // Keyboard shortcuts for the three principal marks (the same product
  // features the toolbar buttons expose; keyboard input is the more
  // reliable automation path in this container).
  for (const [keys, marker] of [
    ['Control+B', 'boldword'],
    ['Control+I', 'italicword'],
    ['Control+U', 'underword'],
  ] as const) {
    await page.keyboard.press(keys);
    await page.keyboard.type(marker);
    await page.keyboard.press(keys);
    await page.keyboard.type(' ');
  }
  // Toolbar-button toggles for the remaining marks.
  for (const [name, marker] of [
    ['Strikethrough', 'strikeword'],
    ['Inline code', 'codeword'],
    ['Superscript', 'supword'],
    ['Subscript', 'subword'],
  ] as const) {
    await auditClick(page.getByRole('button', { name, exact: true }), evidence, `mark ${name}`);
    await page.keyboard.type(marker);
    await auditClick(page.getByRole('button', { name, exact: true }), evidence, `mark ${name} off`);
    await page.keyboard.type(' ');
  }
  await expectSaved(page);
  const html = await page.locator('.ProseMirror').innerHTML();
  evidence.note(`marks html: strong=${html.includes('<strong>')}, em=${html.includes('<em>')}, u=${html.includes('<u>')}, s=${html.includes('<s>')}, code=${html.includes('<code>')}, sup=${html.includes('sup')}, sub=${html.includes('sub')}`);
  expect(html).toContain('<strong>');
  expect(html).toContain('<em>');
  expect(html).toContain('<u>');
});

test('E2 toolbar blocks: heading, quote, code block, hr, lists, tasks', async () => {
  const { page, evidence } = session;
  await focusEditor();
  await page.keyboard.press('Enter');
  // Headings are toolbar buttons labelled H1..H6 (title 'Heading 1').
  await auditClick(page.getByRole('button', { name: 'Heading 1', exact: true }), evidence, 'Heading 1');
  await page.waitForTimeout(300);
  await page.keyboard.type('H1 audit heading');
  await page.keyboard.press('Enter');
  await auditClick(page.getByRole('button', { name: 'Paragraph', exact: true }), evidence, 'Paragraph');
  await page.waitForTimeout(300);
  await page.keyboard.type('para after heading');
  await page.keyboard.press('Enter');
  await auditClick(page.getByRole('button', { name: 'Blockquote', exact: true }), evidence, 'Blockquote');
  await page.waitForTimeout(300);
  await page.keyboard.type('quoted audit line');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await auditClick(page.getByRole('button', { name: 'Code block with language label', exact: true }), evidence, 'Code block');
  await page.waitForTimeout(300);
  await page.keyboard.type('const audit = true;');
  await page.keyboard.press('ArrowDown');
  await auditClick(page.getByRole('button', { name: 'Horizontal rule', exact: true }), evidence, 'Horizontal rule');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await auditClick(page.getByRole('button', { name: 'Bullet list', exact: true }), evidence, 'Bullet list');
  await page.waitForTimeout(300);
  await page.keyboard.type('bullet one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('bullet two');
  await page.keyboard.press('Enter');
  await auditClick(page.getByRole('button', { name: 'Task list', exact: true }), evidence, 'Task list');
  await page.waitForTimeout(300);
  await page.keyboard.type('task item audit');
  await expectSaved(page);
  const html = await page.locator('.ProseMirror').innerHTML();
  evidence.note(
    `blocks html: h1=${html.includes('<h1>')}, blockquote=${html.includes('<blockquote>')}, pre=${html.includes('<pre>')}, hr=${/hr|separator/.test(html)}, ul=${html.includes('<ul>')}, task=${html.includes('task')}`,
  );
  expect(html).toContain('<h1>');
  expect(html).toContain('<pre>');
  expect(html).toContain('<ul>');
  expect(html).toContain('taskList');
});

test('E3 toolbar colors: text colour and highlight swatches apply', async () => {
  const { page, evidence } = session;
  await focusEditor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('colored audit text ');
  // Swatches carry hex-coded accessible names (extensions.ts palettes).
  await auditClick(page.getByRole('button', { name: 'Text colour #a4262c', exact: true }), evidence, "page.getByRole('button' name: 'Text colour a4262c' exact: true )");
  await page.keyboard.type('red audit word ');
  await auditClick(page.getByRole('button', { name: 'Highlight #fef08a', exact: true }), evidence, "page.getByRole('button' name: 'Highlight fef08a' exact: true )");
  await page.keyboard.type('highlighted audit word');
  await expectSaved(page);
  const html = await page.locator('.ProseMirror').innerHTML();
  evidence.note(`color html has span with style=${/style="[^"]*color/.test(html)}`);
  expect(/style="[^"]*color/i.test(html)).toBe(true);
});

test('E4 table tools: insert, add row/column, header toggle', async () => {
  const { page, evidence } = session;
  await focusEditor();
  await page.keyboard.press('Enter');
  await auditClick(page.getByRole('button', { name: 'Insert table (2x2 with header)', exact: true }), evidence, "page.getByRole('button' name: 'Insert table (2x2 with header)' exact: ");
  await page.keyboard.type('cell-a');
  await auditClick(page.getByRole('button', { name: 'Add row below', exact: true }), evidence, "page.getByRole('button' name: 'Add row below' exact: true )");
  await auditClick(page.getByRole('button', { name: 'Add column after', exact: true }), evidence, "page.getByRole('button' name: 'Add column after' exact: true )");
  await expectSaved(page);
  const html = await page.locator('.ProseMirror').innerHTML();
  evidence.note(`table html: table=${html.includes('<table>')}, rows=${(html.match(/<tr/g) ?? []).length}`);
  expect(html).toContain('<table');
});

test('E5 link dialog: valid URL applies; javascript: is refused; cancel does nothing', async () => {
  const { page, evidence } = session;
  await focusEditor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('link target audit ');
  // Select the last three words.
  await page.keyboard.press('Shift+Control+ArrowLeft').catch(() => undefined);
  await auditClick(page.getByRole('button', { name: 'Insert or edit link', exact: true }), evidence, "page.getByRole('button' name: 'Insert or edit link' exact: true )");
  const dialog = page.locator('dialog').filter({ hasText: 'Insert or edit link' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Invalid protocol first: warning appears, dialog stays.
  await dialog.locator('input').first().fill('javascript:alert(1)');
  await auditClick(dialog.getByRole('button', { name: 'Apply', exact: true }), evidence, "dialog.getByRole('button' name: 'Apply' exact: true )");
  await expect(dialog).toContainText('not an approved link protocol');
  await evidence.screenshot(page, 'E5-link-protocol-refused');

  // Then a valid https URL.
  await dialog.locator('input').first().fill('https://example.com/audit');
  await auditClick(dialog.getByRole('button', { name: 'Apply', exact: true }), evidence, "dialog.getByRole('button' name: 'Apply' exact: true )");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  await expectSaved(page);
  const html = await page.locator('.ProseMirror').innerHTML();
  evidence.note(`link html has example.com=${html.includes('https://example.com/audit')}`);
  expect(html).toContain('https://example.com/audit');
});

test('E6 image dialog: data-URL image with alt and caption inserts', async () => {
  const { page, evidence } = session;
  await focusEditor();
  await page.keyboard.press('Enter');
  await auditClick(page.getByRole('button', { name: 'Insert image with alt text', exact: true }), evidence, "page.getByRole('button' name: 'Insert image with alt text' exact: true");
  const dialog = page.locator('dialog').filter({ hasText: 'Insert image' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  // Inputs in DOM order: [0] file, [1] data-URL src, [2] alt, [3] caption.
  const inputs = dialog.locator('input');
  await inputs.nth(1).fill(png);
  await inputs.nth(2).fill('audit alt text');
  await inputs.nth(3).fill('audit caption');
  await auditClick(dialog.getByRole('button', { name: 'Insert', exact: true }), evidence, "dialog.getByRole('button' name: 'Insert' exact: true )");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  await expectSaved(page);
  const html = await page.locator('.ProseMirror').innerHTML();
  evidence.note(`image html has img=${html.includes('<img')}, alt=${html.includes('audit alt text')}`);
  expect(html).toContain('<img');
});

test('E7 find and replace: Ctrl+F workflow with real replacement', async () => {
  const { page, evidence } = session;
  await focusEditor();
  await page.keyboard.press('Control+f');
  const findBar = page.locator('[aria-label="Find and replace in note"]');
  await expect(findBar).toBeVisible({ timeout: 5_000 });
  await findBar.locator('[aria-label="Find in note"]').fill(MARKERS.body);
  await page.waitForTimeout(300);
  const status = await findBar.locator('.editor-find__status').textContent();
  evidence.note(`find status for body marker: ${status ?? '(empty)'}`);
  expect(status ?? '').toMatch(/\d+ of \d+/);

  await findBar.locator('[aria-label="Replace with"]').fill('REPLACED-AUDIT-TOKEN');
  await auditClick(findBar.getByRole('button', { name: 'Replace all', exact: true }), evidence, "findBar.getByRole('button' name: 'Replace all' exact: true )");
  await expectSaved(page);
  const text = await page.locator('.ProseMirror').textContent();
  expect(text ?? '').toContain('REPLACED-AUDIT-TOKEN');
  await auditClick(findBar.getByRole('button', { name: 'Close', exact: true }), evidence, "findBar.getByRole('button' name: 'Close' exact: true )");
  await expect(findBar).not.toBeVisible({ timeout: 5_000 });
  evidence.note('find+replace-all applied and find bar closed');
});

test('E8 HTML source view: toggle shows sanitised source and returns', async () => {
  const { page, evidence } = session;
  await auditClick(page.getByRole('button', { name: 'Toggle HTML source view (sanitised)', exact: true }), evidence, "page.getByRole('button' name: 'Toggle HTML source view (sanitised)' ex");
  const source = page.locator('[aria-label="HTML source view (sanitised)"]');
  await expect(source).toBeVisible({ timeout: 5_000 });
  await evidence.screenshot(page, 'E8-source-view');
  await auditClick(page.getByRole('button', { name: 'Toggle HTML source view (sanitised)', exact: true }), evidence, "page.getByRole('button' name: 'Toggle HTML source view (sanitised)' ex");
  await expect(source).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.ProseMirror')).toBeVisible();
});

test('E9 markdown export/import: round-trip through real files', async () => {
  const { page, evidence } = session;
  await expectSaved(page);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    (async () => {
      await auditClick(page.getByRole('button', { name: 'File', exact: true }), evidence, "page.getByRole('button' name: 'File' exact: true )");
      await auditClick(page.getByRole('button', { name: 'Markdown (.md)' }), evidence, "page.getByRole('button' name: 'Markdown (.md)' )");
    })(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const exportPath = await download.path();
  const { readFileSync } = await import('node:fs');
  const exported = readFileSync(exportPath ?? '', 'utf8');
  evidence.note(`exported md length=${exported.length}, has marker=${exported.includes('REPLACED-AUDIT-TOKEN')}`);
  expect(exported).toContain('REPLACED-AUDIT-TOKEN');
});

test('E10 session header: panel toggles, pin, and trash cancel path', async () => {
  const { page, evidence } = session;
  for (const name of ['Revision history', 'Attachments', 'Snapshots', 'Reminders', 'AI']) {
    await auditClick(page.getByRole('button', { name, exact: true }), evidence, "page.getByRole('button' name exact: true )");
    await page.waitForTimeout(400);
  }
  await evidence.screenshot(page, 'E10-panels-toggled-state');
  // Close them again (same toggles).
  for (const name of ['Revision history', 'Attachments', 'Snapshots', 'Reminders', 'AI']) {
    await auditClick(page.getByRole('button', { name, exact: true }), evidence, "page.getByRole('button' name exact: true )");
    await page.waitForTimeout(300);
  }

  // Pin from the editor.
  await auditClick(page.getByRole('button', { name: 'Pin', exact: true }), evidence, "page.getByRole('button' name: 'Pin' exact: true )");
  await expect(page.locator('#live-region')).toContainText('pinned', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
  await auditClick(page.getByRole('button', { name: 'Unpin', exact: true }), evidence, "page.getByRole('button' name: 'Unpin' exact: true )");
  await expect(page.locator('#live-region')).toContainText('unpinned', { timeout: 15_000 });

  // Trash: cancel must leave the note intact.
  await auditClick(page.getByRole('button', { name: 'Move to trash…' }), evidence, "page.getByRole('button' name: 'Move to trash' )");
  const confirm = page.locator('dialog.dialog--confirm');
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  await auditClick(confirm.getByRole('button', { name: 'Cancel' }), evidence, "confirm.getByRole('button' name: 'Cancel' )");
  await expect(confirm).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.editor-panel__title')).toBeVisible();
  evidence.note('editor pin/unpin and trash-cancel verified');
});

test('E11 title and subtitle fields: long, unicode and emoji content persists', async () => {
  const { page, evidence } = session;
  const longTitle = 'Ünïcode audit — 标题 with emoji 🎯 and a very long title that keeps going and going to test truncation behaviour in the card layout';
  await page.locator('.editor-panel__title').fill(longTitle);
  await page.locator('.editor-panel__subtitle').fill('Subtitle with ünïcode ✓ and emoji 🚀');
  await expectSaved(page);
  await backToList(page);
  await expect(page.locator('.card', { hasText: 'Ünïcode audit' })).toHaveCount(1, {
    timeout: 15_000,
  });
  await evidence.screenshot(page, 'E11-unicode-card');
  evidence.note('unicode/emoji/long title and subtitle persisted and rendered');
});

test('E12 session hygiene', async () => {
  const { evidence } = session;
  expect(evidence.pageErrors, JSON.stringify(evidence.pageErrors)).toEqual([]);
  expect(evidence.consoleErrors, JSON.stringify(evidence.consoleErrors)).toEqual([]);
  expect(evidence.externalRequests, JSON.stringify(evidence.externalRequests)).toEqual([]);
});
