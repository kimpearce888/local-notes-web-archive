/**
 * In-app editor documentation (PRD §4.4 closing requirement): the toolbar
 * controls and the exact supported document schema, stated honestly —
 * including what the editor deliberately does NOT support.
 */

export const EDITOR_DOCUMENTATION = `
<h3>Toolbar</h3>
<ul>
  <li><strong>History:</strong> Undo/redo (Ctrl+Z / Ctrl+Y).</li>
  <li><strong>Text:</strong> bold (Ctrl+B), italic (Ctrl+I), underline (Ctrl+U), strikethrough, inline code, superscript, subscript, clear formatting.</li>
  <li><strong>Font:</strong> font size (12–32&nbsp;px), text colour, highlight colour.</li>
  <li><strong>Blocks:</strong> headings 1–6, paragraph, blockquote, code block with language label, horizontal rule.</li>
  <li><strong>Lists:</strong> ordered, bullet and task lists; indent/outdent where structurally valid.</li>
  <li><strong>Alignment:</strong> left, centre, right, justify.</li>
  <li><strong>Tables:</strong> insert 2×2 with header row, add/delete rows and columns, toggle header cells.</li>
  <li><strong>Media:</strong> links (https, http, mailto only), images with alt text.</li>
  <li><strong>Tools:</strong> find &amp; replace (Ctrl+F), sanitised HTML source view, Markdown import/export.</li>
</ul>
<h3>Document schema</h3>
<p>Nodes: paragraph, heading (levels 1–6), blockquote, bullet/ordered/task lists, list and task items, code block, horizontal rule, table (row/cell/header), image, hard break.</p>
<p>Marks: bold, italic, underline, strikethrough, code, link, text style (size, colour, background), highlight, subscript, superscript, alignment.</p>
<h3>Honest limits</h3>
<ul>
  <li>Markdown export maps underline, sub/superscript and highlight to inline HTML because Markdown has no constructs for them.</li>
  <li>Pasted rich text is parsed against exactly this schema; anything outside it is dropped, never guessed.</li>
  <li>The HTML source view is sanitised: scripts, event handlers, styles and non-approved link protocols are removed on apply.</li>
  <li>No paid extension, external editor service or remote asset is used.</li>
</ul>
`;
