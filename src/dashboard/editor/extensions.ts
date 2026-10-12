/**
 * Editor extension bundle — the EXACT PRD §4.4 feature matrix, no more, no
 * less: paragraphs, headings 1–6, bold/italic/underline/strikethrough/inline
 * code, sub/superscript, font size + text color + highlight, the four text
 * alignments, ordered/unordered/task lists with structurally valid
 * indent/outdent, blockquotes, horizontal rules, code blocks with language
 * labels, links, tables, images, placeholder text, character count and
 * reliable undo/redo. Everything else is intentionally absent.
 */

import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontSize, BackgroundColor } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import { CharacterCount } from '@tiptap/extension-character-count';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Link } from '@tiptap/extension-link';
import { common, createLowlight } from 'lowlight';
import type { Extensions } from '@tiptap/core';

export const lowlight = createLowlight(common);

/**
 * Font size choices (px). Bounded on purpose: notes are documents, not
 * posters; the list keeps the toolbar small and content predictable.
 */
export const FONT_SIZES: readonly number[] = [12, 14, 16, 18, 20, 24, 32];

/** Highlight colours exposed in the toolbar (PRD §4.4). */
export const HIGHLIGHT_COLORS: readonly string[] = [
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#fecaca',
  '#e9d5ff',
];

export const TEXT_COLORS: readonly string[] = [
  '#1c2333',
  '#2e4fa3',
  '#a4262c',
  '#1c6b3c',
  '#8a5300',
  '#55607a',
];

export const PLACEHOLDER_TEXT = 'Start writing… use the toolbar above, or paste anything.';

export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      // Replaced by CodeBlockLowlight for language labels (§4.4).
      codeBlock: false,
      // Link is configured explicitly below (safe external opening only).
      link: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    // Code blocks with a language label (lowlight, common languages).
    CodeBlockLowlight.configure({ lowlight }),
    // Links: never open from inside the editor (clicks route through the
    // panel's safe-open callback); autolink recognizes plain URLs.
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
    }),
    // Inline style family.
    TextStyle,
    Color,
    FontSize,
    BackgroundColor,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    // The four alignments across all block nodes.
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    // Lists.
    TaskList,
    TaskItem.configure({ nested: true }),
    // Tables.
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    // Media.
    Image.configure({ inline: false, allowBase64: true }),
    // Chrome.
    Placeholder.configure({ placeholder: PLACEHOLDER_TEXT }),
    CharacterCount,
  ];
}

/** Canonical node types present in the schema (§4.4 documentation). */
export const SCHEMA_NODES: readonly string[] = [
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'hardBreak',
  'text',
];

/** Canonical mark types present in the schema (§4.4 documentation). */
export const SCHEMA_MARKS: readonly string[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'textStyle', // carries fontSize, color and backgroundColor attributes
  'highlight',
  'subscript',
  'superscript',
  // textAlign is a paragraph/heading node attribute, not a mark.
];
