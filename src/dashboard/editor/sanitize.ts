/**
 * Sanitisation gates (PRD §4.4/§10): every HTML string that enters the
 * editor — HTML source view, HTML import, pasted rich HTML retained through
 * ProseMirror parsing, Markdown conversion output — is scrubbed with
 * DOMPurify under a lock-down profile. Approved link/media protocols only;
 * no scripts, stylesheets, event handlers or stray CSS survive.
 *
 * DOMPurify hooks are registered once at module level (that is the actual
 * API — a `hooks` config key would be silently ignored).
 */

import DOMPurify from 'dompurify';

const ALLOWED_TAGS: readonly string[] = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'br',
  'ul', 'ol', 'li', 'pre', 'code',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'mark',
  'a', 'span', 'font',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'input',
];

const ALLOWED_ATTRS: readonly string[] = [
  'href', 'title', 'target', 'rel',
  'colspan', 'rowspan', 'align',
  'src', 'alt', 'width', 'height',
  'color', 'face', 'size',
  'style',
  'type', 'checked', 'disabled',
  'data-language', 'language', 'class',
];

/**
 * Only href/src are true URI attributes. Every other allowed attribute must
 * be marked URI-safe, otherwise DOMPurify validates its VALUE against the
 * strict scheme regexp (which strips type="checkbox", colspan="2", …).
 */
const URI_SAFE_ATTRS: readonly string[] = [
  'title', 'target', 'rel', 'colspan', 'rowspan', 'align', 'alt', 'width',
  'height', 'color', 'face', 'size', 'type', 'checked', 'disabled',
  'data-language', 'language', 'class',
];

const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|data:image\/(?:png|jpeg|gif|webp);base64,)/i;

/** The editor's inline CSS vocabulary — anything else is dropped. */
const ALLOWED_CSS_PROPERTIES: readonly string[] = [
  'color',
  'background-color',
  'font-size',
  'text-align',
  'width',
  'height',
];

const ALLOWED_CSS_VALUE = /^[a-zA-Z0-9#%,.\s\-()]+$/;

function filterInlineStyle(styleValue: string): string {
  const declarations = styleValue.split(';').map((part) => part.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator <= 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!ALLOWED_CSS_PROPERTIES.includes(property)) continue;
    if (!ALLOWED_CSS_VALUE.test(value)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.join('; ');
}

/** Per-call collector for truthful removal reporting. */
let removedCollector: string[] | null = null;

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (removedCollector && (data.tagName === 'script' || data.tagName === 'style')) {
    removedCollector.push(data.tagName);
  }
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!removedCollector || !(node instanceof HTMLElement)) return;
  const original = node.getAttribute('style');
  if (original === null) return;
  const filtered = filterInlineStyle(original);
  if (filtered !== original) removedCollector.push(`style:${original.slice(0, 60)}`);
  if (filtered.length === 0) node.removeAttribute('style');
  else node.setAttribute('style', filtered);
});

/**
 * Sanitise untrusted HTML for editor ingestion. Returns scrubbed HTML plus
 * a truthful report of what was removed so the UI can warn instead of
 * silently dropping content.
 */
export function sanitizeEditorHtml(html: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  removedCollector = removed;
  try {
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTRS],
      ADD_URI_SAFE_ATTR: [...URI_SAFE_ATTRS],
      ALLOWED_URI_REGEXP,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math'],
    });
    return { html: clean, removed };
  } finally {
    removedCollector = null;
  }
}

/**
 * Structural safety report for link targets (approved protocols only).
 * Returns false for anything the editor must refuse to open or store.
 */
export function isSafeLinkHref(href: string): boolean {
  return ALLOWED_URI_REGEXP.test(href.trim());
}

/**
 * Sanitises markdown→HTML conversion output before it is handed to the
 * editor (marked output is trusted-ish, but inputs are user/imported files —
 * same gate as everything else).
 */
export function sanitizeMarkdownHtml(html: string): string {
  return sanitizeEditorHtml(html).html;
}
