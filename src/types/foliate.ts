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

/** 一个已加载章节的视图上下文。`overlayer` 是画标注的那层 SVG（可能还没建） */
export interface FoliateContent {
  doc: Document;
  index: number;
  overlayer?: {
    /** 命中测试：给 iframe 视口坐标，返回落在哪条标注上 */
    hitTest: (point: { x: number; y: number }) => [string | undefined, Range | undefined];
    redraw: () => void;
  };
}

export interface FoliateRenderer extends HTMLElement {
  setStyles: (styles: string | [string, string]) => void;
  getContents: () => FoliateContent[];
  goTo: (target: unknown) => Promise<void>;
  destroy: () => void;
}

export interface FoliateSearchItem {
  cfi: string;
  excerpt: string;
}

/* ── 标注 ── */

/** 覆盖层绘制函数：把一批矩形画成一坨 SVG */
export type OverlayerDrawer = (
  rects: Array<{ left: number; top: number; height: number; width: number }>,
  options?: { color?: string; padding?: number; width?: number; writingMode?: string },
) => SVGElement;

/** 交给 `view.addAnnotation` 的标注。`value` 就是 CFI 范围字符串 */
export interface FoliateAnnotation {
  value: string;
  [key: string]: unknown;
}

/** `draw-annotation` 事件：view 已经把范围解析好，只等我们决定画成什么样 */
export interface DrawAnnotationDetail {
  draw: (func: OverlayerDrawer, opts?: { color?: string; padding?: number; writingMode?: string }) => void;
  annotation: FoliateAnnotation;
  doc: Document;
  range: Range;
}

/** `show-annotation` 事件：点中了某条已有标注 */
export interface ShowAnnotationDetail {
  value: string;
  index: number;
  range: Range;
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
  /** 画一条标注（内部会按 CFI 解析出章节，再派发 draw-annotation） */
  addAnnotation(annotation: FoliateAnnotation, remove?: boolean): Promise<{ index: number; label: string } | undefined>;
  deleteAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
  showAnnotation(annotation: FoliateAnnotation): Promise<void>;
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
