/**
 * Region state helpers (PRD §11): loading / empty / error presentations for
 * any content region. Every state carries a text title and detail — colour
 * and shape are reinforcement, never the sole signal. The error state
 * always offers an explicit retry action when one is provided.
 */

export interface StateElements {
  readonly container: HTMLElement;
  readonly title: HTMLElement;
  readonly detail: HTMLElement;
  readonly retry: HTMLButtonElement | null;
}

const STATE_CLASS = 'state';

function clearRegion(region: HTMLElement): void {
  while (region.firstChild) region.removeChild(region.firstChild);
}

function mountState(
  region: HTMLElement,
  variant: 'empty' | 'loading' | 'error',
): StateElements {
  clearRegion(region);

  const container = document.createElement('div');
  container.className = `${STATE_CLASS} state--${variant}`;

  const glyph = document.createElement('span');
  glyph.className = 'state__glyph';
  glyph.setAttribute('aria-hidden', 'true');

  const title = document.createElement('p');
  title.className = 'state__title';

  const detail = document.createElement('p');
  detail.className = 'state__detail';

  container.append(glyph, title, detail);
  region.append(container);
  return { container, title, detail, retry: null };
}

export function showEmpty(region: HTMLElement, title: string, detail: string): StateElements {
  const elements = mountState(region, 'empty');
  elements.title.textContent = title;
  elements.detail.textContent = detail;
  return elements;
}

export function showLoading(region: HTMLElement, title: string, detail: string): StateElements {
  const elements = mountState(region, 'loading');
  elements.title.textContent = title;
  elements.detail.textContent = detail;
  return elements;
}

/**
 * Error state with an optional retry action. The message is announced to
 * screen readers through the region's own aria-live wiring done by callers;
 * the title always states the failure in words.
 */
export function showError(
  region: HTMLElement,
  title: string,
  detail: string,
  retry?: { label: string; onRetry: () => void },
): StateElements {
  const elements = mountState(region, 'error');
  elements.title.textContent = title;
  const errorText = document.createElement('span');
  errorText.className = 'state__error-text';
  errorText.textContent = detail;
  elements.detail.replaceChildren(errorText);

  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = retry.label;
    button.addEventListener('click', () => retry.onRetry());
    elements.container.append(button);
    return { ...elements, retry: button };
  }
  return elements;
}

/** Clears state presentation and returns the region ready for content. */
export function showContent(region: HTMLElement): void {
  clearRegion(region);
}
