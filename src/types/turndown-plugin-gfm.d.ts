declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  /** Whatever shape use() accepts (rules bundle). */
  export type GfmBundle = Parameters<TurndownService['use']>[0];

  export const gfm: GfmBundle;
  export const tables: GfmBundle;
  export const strikethrough: GfmBundle;
  export const taskListItems: GfmBundle;
  export const highlightedCodeBlock: GfmBundle;
}
