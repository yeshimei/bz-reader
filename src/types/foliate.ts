/* ============================================================
 * bz-reader · foliate 接口类型（types/foliate.ts）
 *
 * vendor/foliate 是上游 1.0.1 原版 JS（MIT），没有类型。这里只声明本仓用到的面，
 * 运行时统一从 engine/foliate.ts 这道门面进来 —— 别在业务代码里直接 import vendor。
 * ============================================================ */

export interface FoliateTOCItem {
  label: string;
  href: string;
  subitems?: FoliateTOCItem[];
}

export interface FoliateMetadata {
  title?: string | (() => string);
  author?: string | (() => string);
  language?: string | (() => string);
  publisher?: string;
  description?: string;
  identifier?: string;
}

export interface FoliateSection {
  id: string;
  href: string;
  linear?: string;
  size?: number;
  mediaOverlay?: unknown;
  /** 返回可交给 iframe 的 src（EPUB 是 blob url，TXT 也造成 blob url） */
  load?: () => Promise<string>;
  /** 供搜索用；foliate 的 search 直接遍历它 */
  createDocument?: () => Promise<Document>;
  unload?: () => void;
  resolveHref?: (href: string) => string;
}

export interface FoliateBook {
  metadata?: FoliateMetadata;
  toc?: FoliateTOCItem[];
  sections: FoliateSection[];
  rendition?: { layout?: string };
  dir?: 'ltr' | 'rtl';
  splitTOCHref?: (href: string) => Promise<[string, string | null] | null>;
  getTOCFragment?: (doc: Document, id: string) => Node | null;
  resolveHref?: (href: string) => { index: number; anchor?: unknown };
  isExternal?: (href: string) => boolean;
  destroy?: () => void;
}

export interface FoliateLocation {
  fraction: number;
  section?: { current: number; total: number };
  location?: { current: number; next: number; total: number };
  time?: { section: number; total: number };
  tocItem?: FoliateTOCItem | null;
  cfi?: string;
  range?: Range;
  reason?: string;
}

export interface FoliateRenderer extends HTMLElement {
  setStyles: (styles: string | [string, string]) => void;
  getContents: () => Array<{ doc: Document; index: number }>;
  goTo: (target: unknown) => Promise<void>;
  destroy: () => void;
}

export interface FoliateSearchItem {
  cfi: string;
  excerpt: string;
}

export interface FoliateView extends HTMLElement {
  book: FoliateBook;
  renderer: FoliateRenderer;
  lastLocation?: FoliateLocation;
  isFixedLayout: boolean;
  open(book: FoliateBook | File | string): Promise<void>;
  close(): void;
  init(opts?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
  goTo(target: unknown): Promise<unknown>;
  goToFraction(frac: number): Promise<void>;
  goToTextStart(): Promise<void>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  goLeft(): void;
  goRight(): void;
  resolveNavigation(target: unknown): unknown;
  select(target: unknown): Promise<void>;
  deselect(): void;
  getCFI(index: number, range: Range): string;
  getSectionFractions(): number[];
  search(opts: { query: string; index?: number }): AsyncGenerator<
    | { cfi?: string; excerpt?: string; progress?: number; index?: number; subitems?: FoliateSearchItem[]; label?: string }
    | 'done',
    void,
    unknown
  >;
  clearSearch(): void;
  history: unknown;
}
