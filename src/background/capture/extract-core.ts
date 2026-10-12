/**
 * Page text extraction core (FR-CAP-09) — the function injected into the
 * temporary capture tab through `chrome.scripting.executeScript({ func })`.
 *
 * SELF-CONTAINMENT CONTRACT: Chrome serializes exactly this function's
 * source (`func.toString()`) and evaluates it in the page's ISOLATED world.
 * It must therefore not reference ANY binding outside its own scope — no
 * imports, no module constants, no outer identifiers. Everything it needs
 * either lives inside the function or arrives via structured-clone `args`.
 * The unit tests exercise it directly against jsdom fixture documents,
 * which is only possible because the function is ordinary top-level code.
 *
 * What it extracts (best-effort, honest about limits):
 * - visible readable text (hidden/script/style/noscript/template and
 *   non-visual elements skipped, whitespace collapsed, block structure
 *   kept as line breaks), truncated at `maxChars` with a warning;
 * - the document title;
 * - the canonical URL (`link[rel=canonical]`) when it is an absolute
 *   http(s) reference;
 * - warnings for embedded frames and lazy-loaded resources where the page
 *   makes them detectable (FR-CAP-07 warning kinds).
 */

/**
 * Result of the in-page extraction. Kept deliberately plain (structured
 * clone of plain data only) — the background re-validates every field
 * because page content is untrusted input.
 */
export interface PageExtraction {
  readonly text: string;
  readonly title: string;
  readonly canonicalUrl: string | null;
  readonly warnings: ReadonlyArray<{ readonly kind: string; readonly detail: string }>;
}

/** Extraction budget for one page (characters of visible text). */
export const MAX_TEXT_CHARS = 500_000;

export function extractReadableTextInPage(maxChars: number): PageExtraction {
  const warnings: Array<{ kind: string; detail: string }> = [];

  const doc: Document = document;
  const title: string = (doc.title ?? '').trim().slice(0, 500);

  let canonicalUrl: string | null = null;
  const canonical = doc.querySelector('link[rel="canonical" i]');
  if (canonical !== null) {
    const href = canonical.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) canonicalUrl = href.slice(0, 2000);
  }

  if (doc.querySelector('iframe, frame') !== null) {
    warnings.push({
      kind: 'unsupported-frame',
      detail: 'the page embeds frames; their inner content is not part of the extracted text',
    });
  }

  const lazyNodes = doc.querySelectorAll(
    'img[loading="lazy" i], img[data-src], iframe[loading="lazy" i]',
  );
  if (lazyNodes.length > 0) {
    warnings.push({
      kind: 'lazy-content',
      detail: `${lazyNodes.length} lazily loaded resource(s) may not have finished loading at capture time`,
    });
  }

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS',
    'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'MAP',
  ]);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
    'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
    'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);

  const isVisible = (element: Element): boolean => {
    if (element.getAttribute('aria-hidden') === 'true') return false;
    // Duck-typed `hidden` check: only HTML elements carry the property, and
    // no environment globals are needed (the function must stay
    // self-contained and reference nothing beyond document/window).
    if ((element as Partial<HTMLElement>).hidden === true) return false;
    const view: Window | null = typeof window === 'undefined' ? null : window;
    if (view === null) return true;
    try {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch {
      // Computed style unavailable — treat the element as visible rather
      // than silently dropping content.
    }
    return true;
  };

  const parts: string[] = [];
  let collected = 0;
  let truncated = false;

  const walk = (node: Node): void => {
    if (truncated) return;
    if (node.nodeType === 3) {
      const raw = node.nodeValue ?? '';
      if (raw.trim().length === 0) return;
      const collapsed = raw.replace(/\s+/g, ' ');
      parts.push(collapsed);
      collected += collapsed.length;
      if (collected > maxChars) truncated = true;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (SKIP_TAGS.has(element.tagName.toUpperCase())) return;
    if (!isVisible(element)) return;
    const children = element.childNodes;
    for (let i = 0; i < children.length; i += 1) walk(children[i]!);
    if (BLOCK_TAGS.has(element.tagName.toUpperCase())) parts.push('\n');
  };

  const root = doc.body ?? doc.documentElement;
  if (root !== null) walk(root);

  let text = parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (truncated) {
    text = text.slice(0, Math.max(maxChars, 0));
    warnings.push({
      kind: 'oversized',
      detail: `the visible text exceeded the ${maxChars}-character extraction budget and was truncated`,
    });
  }

  return { text, title, canonicalUrl, warnings };
}
