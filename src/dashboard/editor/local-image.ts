/**
 * LocalImage (T-019, PRD §4.4 "image insertion … local binary storage, alt
 * text, caption and resize controls"): the stock Tiptap image node extended
 * with `width` (percent) and `caption` attributes plus a vanilla node view
 * that renders a figure with an editable caption and resize controls.
 *
 * Durable storage model: binaries live in the extension's blob store keyed
 * by content hash; the document keeps a stable `attachment:<uuid>` src. The
 * node view resolves that reference to a session object URL through the
 * injected resolver — nothing is fetched over the network, and the saved
 * document never contains session-limited blob: URLs. Inline `data:image`
 * sources keep working as before; every other source kind (remote, relative)
 * is refused at render time so the dashboard never fetches remote content
 * (PRD §10 local-first, T-048).
 */

import { Image } from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { isSafeImageSrc } from './sanitize';

/** Resize presets offered on a selected image (percent of the text column). */
export const IMAGE_WIDTH_PRESETS: readonly number[] = [25, 50, 75, 100];

/** Stable in-document reference scheme for blob-store images. */
export const ATTACHMENT_SRC_PREFIX = 'attachment:';

export function isAttachmentSrc(src: string): boolean {
  return src.startsWith(ATTACHMENT_SRC_PREFIX);
}

export function attachmentIdFromSrc(src: string): string | null {
  if (!isAttachmentSrc(src)) return null;
  const id = src.slice(ATTACHMENT_SRC_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Resolves an `attachment:` reference to a displayable (object) URL. */
export type ImageSrcResolver = (src: string) => Promise<string | null>;

export interface LocalImageOptions {
  resolveImageSrc: ImageSrcResolver;
}

export const LocalImage = Image.extend<LocalImageOptions>({
  name: 'image',

  addOptions() {
    return {
      ...this.parent?.(),
      // Safe default: unresolved references surface an honest error message
      // instead of throwing when no resolver is wired up.
      resolveImageSrc: (async () => null) as ImageSrcResolver,
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null as number | null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-width');
          if (raw === null) return null;
          const value = Number.parseInt(raw, 10);
          return Number.isFinite(value) && value >= 10 && value <= 100 ? value : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.width === 'number'
            ? { 'data-width': String(attributes.width) }
            : {},
      },
      caption: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-caption') ?? '',
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.caption === 'string' && attributes.caption.length > 0
            ? { 'data-caption': attributes.caption }
            : {},
      },
    };
  },

  addNodeView() {
    const resolveImageSrc = this.options.resolveImageSrc;
    return ({
      node,
      editor,
      getPos,
    }: {
      editor: Editor;
      node: ProseMirrorNode;
      getPos: (() => number | undefined) | number;
    }) => {
      let current = node;
      let destroyed = false;
      let resolveToken = 0;

      /* ------------------------------ DOM ---------------------------- */

      const figure = document.createElement('figure');
      figure.className = 'editor-image';
      figure.setAttribute('data-image-node', '');

      const img = document.createElement('img');
      img.draggable = false;
      img.alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
      img.decoding = 'async';

      const status = document.createElement('div');
      status.className = 'editor-image__status';
      status.hidden = true;

      const caption = document.createElement('figcaption');
      caption.className = 'editor-image__caption';
      caption.contentEditable = 'true';
      caption.dataset.placeholder = 'Write a caption…';
      caption.textContent = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';

      const controls = document.createElement('div');
      controls.className = 'editor-image__controls';
      controls.hidden = true;
      const controlsLabel = document.createElement('span');
      controlsLabel.className = 'editor-image__controls-label';
      controlsLabel.textContent = 'Image size';
      controls.append(controlsLabel);
      for (const preset of IMAGE_WIDTH_PRESETS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--ghost editor-image__resize';
        button.textContent = `${preset}%`;
        button.setAttribute('aria-label', `Resize image to ${preset} percent of the text column`);
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => setWidth(preset));
        controls.append(button);
      }
      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'btn btn--ghost editor-image__resize';
      resetButton.textContent = 'Full';
      resetButton.setAttribute('aria-label', 'Reset image to full column width');
      resetButton.addEventListener('mousedown', (event) => event.preventDefault());
      resetButton.addEventListener('click', () => setWidth(null));
      controls.append(resetButton);

      figure.append(img, status, caption, controls);

      /* --------------------------- Rendering -------------------------- */

      const applyWidth = (width: number | null): void => {
        img.style.width = width === null ? '' : `${width}%`;
      };
      applyWidth(typeof node.attrs.width === 'number' ? node.attrs.width : null);

      const resolveSrc = (src: string): void => {
        if (typeof src !== 'string' || src.length === 0) {
          showStatus('This image has no source.', true);
          return;
        }
        if (!isAttachmentSrc(src)) {
          // Inline data: images only — remote or relative srcs must never be
          // assigned to the live DOM (no network fetches, no accidental loads
          // against the extension origin). Refuse honestly instead.
          if (isSafeImageSrc(src)) {
            img.src = src;
            hideStatus();
          } else {
            showStatus(
              'This image source was not loaded: remote images are never fetched. Insert a local file or a data: image instead.',
              true,
            );
          }
          return;
        }
        const token = ++resolveToken;
        showStatus('Loading image from local storage…', false);
        resolveImageSrc(src)
          .then((url) => {
            if (destroyed || token !== resolveToken) return;
            if (url === null) {
              showStatus('This image could not be loaded from local storage.', true);
              return;
            }
            img.src = url;
            hideStatus();
          })
          .catch(() => {
            if (destroyed || token !== resolveToken) return;
            showStatus('This image could not be loaded from local storage.', true);
          });
      };

      const showStatus = (message: string, isError: boolean): void => {
        status.textContent = message;
        status.hidden = false;
        figure.classList.toggle('editor-image--error', isError);
      };
      const hideStatus = (): void => {
        status.hidden = true;
        figure.classList.toggle('editor-image--error', false);
      };
      resolveSrc(node.attrs.src as string);

      /* -------------------------- Mutations --------------------------- */

      const position = (): number | null => {
        const pos = typeof getPos === 'function' ? getPos() : getPos;
        return typeof pos === 'number' ? pos : null;
      };

      const setAttr = (patch: Record<string, unknown>): void => {
        const pos = position();
        if (pos === null) return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          ...patch,
        });
        editor.view.dispatch(tr);
      };

      const setWidth = (width: number | null): void => {
        applyWidth(width);
        setAttr({ width });
      };

      // Caption edits are plain DOM text; committed back to node attrs on
      // blur so the document stays the single source of truth.
      caption.addEventListener('input', () => {
        caption.classList.toggle('editor-image__caption--filled', caption.textContent?.length > 0);
      });
      caption.addEventListener('blur', () => {
        setAttr({ caption: (caption.textContent ?? '').slice(0, 2000) });
      });
      // Typing inside the caption must never reach ProseMirror.
      caption.addEventListener('keydown', (event) => event.stopPropagation());

      figure.addEventListener('mousedown', (event) => {
        if (event.target === caption || controls.contains(event.target as Node)) return;
        // Select the image node so the resize controls appear.
        const pos = position();
        if (pos === null) return;
        event.preventDefault();
        editor.commands.focus();
        editor.view.dispatch(
          editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
        );
      });

      return {
        dom: figure,
        // PM never needs to observe our internal DOM (caption/controls).
        ignoreMutation: () => true,
        update(updatedNode: ProseMirrorNode): boolean {
          if (updatedNode.type.name !== 'image') return false;
          const srcChanged = updatedNode.attrs.src !== current.attrs.src;
          current = updatedNode;
          img.alt = typeof updatedNode.attrs.alt === 'string' ? updatedNode.attrs.alt : '';
          applyWidth(
            typeof updatedNode.attrs.width === 'number' ? updatedNode.attrs.width : null,
          );
          if (updatedNode.attrs.caption !== caption.textContent) {
            caption.textContent =
              typeof updatedNode.attrs.caption === 'string' ? updatedNode.attrs.caption : '';
          }
          if (srcChanged) resolveSrc(updatedNode.attrs.src as string);
          return true;
        },
        selectNode(): void {
          controls.hidden = false;
          figure.classList.add('editor-image--selected');
        },
        deselectNode(): void {
          controls.hidden = true;
          figure.classList.remove('editor-image--selected');
        },
        destroy(): void {
          destroyed = true;
          resolveToken += 1;
        },
      };
    };
  },
});
