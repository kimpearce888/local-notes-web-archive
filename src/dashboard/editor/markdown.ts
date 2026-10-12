/**
 * Markdown import/export (PRD §4.4): marked converts imported Markdown to
 * sanitised HTML; turndown converts editor HTML back to Markdown. The
 * round-trip is lossy in structured ways documented in the in-app editor
 * documentation (tables survive as HTML blocks in MD output; text styling
 * maps to bold/italic/code emphasis constructs).
 */

import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { sanitizeMarkdownHtml } from './sanitize';

/** Markdown → sanitised HTML for editor ingestion. */
export function markdownToEditorHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false, gfm: true, breaks: false });
  return sanitizeMarkdownHtml(typeof raw === 'string' ? raw : '');
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
  });
  service.use(gfm);
  // Task list checkboxes.
  service.addRule('taskListItem', {
    filter: (node) =>
      node.nodeName === 'INPUT' &&
      (node as HTMLInputElement).type === 'checkbox' &&
      node.parentElement?.nodeName === 'LI',
    replacement: (_content, node) => ((node as HTMLInputElement).checked ? '[x] ' : '[ ] '),
  });
  // Underline has no Markdown construct — keep semantic <u> HTML.
  service.keep(['u', 'sub', 'sup', 'mark']);
  return service;
}

/** Editor HTML → Markdown. */
export function editorHtmlToMarkdown(html: string): string {
  return createTurndown().turndown(html);
}
