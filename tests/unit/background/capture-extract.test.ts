// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractReadableTextInPage, MAX_TEXT_CHARS } from '../../../src/background/capture/extract-core';

/**
 * T-024 extraction core (FR-CAP-09): the self-contained function that
 * chrome.scripting injects into the temporary capture tab. These tests run
 * it directly against jsdom fixture documents — possible precisely because
 * the function is ordinary self-contained code.
 */

function loadFixture(html: string): void {
  document.documentElement.innerHTML = html;
}

describe('visible readable text extraction', () => {
  it('collects visible text and skips script/style/noscript/template content', () => {
    loadFixture(`
      <head><title>Readable Page</title></head>
      <body>
        <h1>Article headline</h1>
        <p>The first   paragraph with   collapsed whitespace.</p>
        <p>The second paragraph.</p>
        <script>var hidden = 'script code';</script>
        <style>.p { color: red; }</style>
        <noscript>noscript fallback</noscript>
        <template><span>template content</span></template>
        <svg><text>svg label</text></svg>
      </body>
    `);
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    expect(result.text).toContain('Article headline');
    expect(result.text).toContain('The first paragraph with collapsed whitespace.');
    expect(result.text).toContain('The second paragraph.');
    expect(result.text).not.toContain('script code');
    expect(result.text).not.toContain('color: red');
    expect(result.text).not.toContain('noscript fallback');
    expect(result.text).not.toContain('template content');
    expect(result.text).not.toContain('svg label');
  });

  it('skips hidden elements (hidden attribute, display:none, visibility:hidden, aria-hidden)', () => {
    loadFixture(`
      <body>
        <p>Visible intro.</p>
        <p hidden>Attribute-hidden paragraph.</p>
        <p style="display: none">Display-none paragraph.</p>
        <p style="visibility: hidden">Visibility-hidden paragraph.</p>
        <div aria-hidden="true">Screen-reader hidden region.</div>
        <p>Visible close.</p>
      </body>
    `);
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    expect(result.text).toContain('Visible intro.');
    expect(result.text).toContain('Visible close.');
    expect(result.text).not.toContain('Attribute-hidden');
    expect(result.text).not.toContain('Display-none');
    expect(result.text).not.toContain('Visibility-hidden');
    expect(result.text).not.toContain('Screen-reader hidden');
  });

  it('keeps block structure as line breaks and collapses inline runs', () => {
    loadFixture(`
      <body>
        <h2>Section</h2>
        <p>Inline <b>bold</b> and <i>italic</i> runs stay on one line.</p>
        <ul><li>Alpha</li><li>Beta</li></ul>
      </body>
    `);
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    expect(result.text).toContain('Inline bold and italic runs stay on one line.');
    const lines = result.text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines).toContain('Section');
    expect(lines).toContain('Alpha');
    expect(lines).toContain('Beta');
    expect(lines.some((l) => l.includes('one line') && l.includes('Inline'))).toBe(true);
  });

  it('extracts the document title', () => {
    loadFixture('<head><title>Freshly hydrated title</title></head><body><p>body</p></body>');
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    expect(result.title).toBe('Freshly hydrated title');
  });
});

describe('canonical URL extraction', () => {
  it('records an absolute http(s) canonical link', () => {
    loadFixture(`
      <head>
        <link rel="canonical" href="https://example.com/canonical-article">
      </head>
      <body><p>x</p></body>
    `);
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    expect(result.canonicalUrl).toBe('https://example.com/canonical-article');
  });

  it('ignores relative or non-http canonical references', () => {
    loadFixture(`
      <head>
        <link rel="canonical" href="/relative-canonical">
        <link rel="alternate" href="https://example.com/alternate">
      </head>
      <body><p>x</p></body>
    `);
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    expect(result.canonicalUrl).toBeNull();
  });
});

describe('detectable capture warnings (FR-CAP-07 kinds)', () => {
  it('warns about embedded frames', () => {
    loadFixture(`
      <body>
        <p>Main text.</p>
        <iframe src="https://example.com/embed"></iframe>
      </body>
    `);
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    const warning = result.warnings.find((w) => w.kind === 'unsupported-frame');
    expect(warning).toBeDefined();
    expect(warning!.detail).toContain('frames');
  });

  it('warns about lazily loaded resources with a count', () => {
    loadFixture(`
      <body>
        <p>Text.</p>
        <img src="a.png" loading="lazy">
        <img src="b.png" loading="lazy">
        <img src="c.png" data-src="d.png">
        <img src="eager.png">
      </body>
    `);
    const result = extractReadableTextInPage(MAX_TEXT_CHARS);
    const warning = result.warnings.find((w) => w.kind === 'lazy-content');
    expect(warning).toBeDefined();
    expect(warning!.detail).toMatch(/3 lazily loaded/);
  });

  it('truncates oversized text with an oversized warning', () => {
    const paragraph = 'word '.repeat(60).trim();
    loadFixture(`<body>${`<p>${paragraph}</p>`.repeat(20)}</body>`);
    const result = extractReadableTextInPage(200);
    expect(result.text.length).toBeLessThanOrEqual(200);
    const warning = result.warnings.find((w) => w.kind === 'oversized');
    expect(warning).toBeDefined();
    expect(warning!.detail).toContain('truncated');
  });
});
