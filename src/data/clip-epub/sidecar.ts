/**
 * 剪藏成书：侧车（章 ↔ 文章对照 + 每章阅读时长）（纯函数，node 可测）。
 *
 * 书本身是标准 EPUB，不塞私有文件；阅读页要的联动信息放在 Reader 自己的
 * 数据目录里：`<dataDir>/clipbooks/<bookId>.json`。
 *
 * 三件事：
 * - chapters：当前这版书的章节表（href → 文章 key / 来源 / 状态）；
 * - chapterSeconds：每章累计阅读秒数，**键是文章 key 而不是章节序号**，
 *   书重建后顺序变了也能对上；
 * - readReported：已回写剪藏本「已读」的 key，避免反复写。
 */

export interface SidecarChapter {
  key: string;
  href: string;
  title: string;
  sourceId: string;
  sourceName: string;
  state: 'unread' | 'read' | 'saved';
  url: string;
  notePath: string | null;
}

export interface ClipBookSidecar {
  version: 1;
  bookId: string;
  title: string;
  generatedAt: number;
  /** 生成时的数据指纹：用来判断「剪藏本有没有变」 */
  dataHash: string;
  chapters: SidecarChapter[];
  chapterSeconds: Record<string, number>;
  readReported: string[];
}

export function emptySidecar(bookId: string, title: string, now = Date.now()): ClipBookSidecar {
  return {
    version: 1,
    bookId,
    title,
    generatedAt: now,
    dataHash: '',
    chapters: [],
    chapterSeconds: {},
    readReported: [],
  };
}

/** FNV-1a 32 位：数据指纹用，跨平台稳定、实现短 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 数据指纹：key + 状态 + 正文长度/内容一起算；任何一篇变了都要能看出来 */
export function hashArticles(
  list: Array<{ key: string; state: string; body?: string }>,
  sourceNames: string[] = [],
): string {
  const parts = list.map((a) => `${a.key}\u0001${a.state}\u0001${a.body ? fnv1a(a.body) : ''}`);
  parts.sort();
  return fnv1a(`${sourceNames.join('\u0002')}\u0003${parts.join('\u0002')}`);
}

/** href 归一：去掉锚点、开头的 ./、前导斜杠 */
export function normHref(href: string): string {
  return String(href || '')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .split('#')[0]
    .trim();
}

export function findChapter(sidecar: ClipBookSidecar | null, href: string): SidecarChapter | null {
  if (!sidecar) return null;
  const want = normHref(href);
  if (!want) return null;
  return sidecar.chapters.find((c) => c.href === want) ?? null;
}

export function chapterIndex(sidecar: ClipBookSidecar | null, key: string): number {
  if (!sidecar) return -1;
  return sidecar.chapters.findIndex((c) => c.key === key);
}

/**
 * 换书后迁移 CFI 的脊柱段。
 *
 * EPUB CFI 的 spine 段是 `/6/<2*(index+1)>`；正文引用（`!/4/10…`）与章节文件
 * 内容绑定，只要同一篇文章的正文没变就能继续用。迁不了（不是标准 CFI）原样返回——
 * 宁可跳不准，也不要静默把用户的划线位置删掉。
 */
export function migrateCfi(cfi: string, fromIndex: number, toIndex: number): string {
  const s = String(cfi || '');
  if (fromIndex < 0 || toIndex < 0) return s;
  const m = /^epubcfi\(\/6\/(\d+)/.exec(s);
  if (!m) return s;
  const oldSpine = Number(m[1]);
  if (oldSpine !== 2 * (fromIndex + 1)) return s;
  return s.replace(/^epubcfi\(\/6\/\d+/, `epubcfi(/6/${2 * (toIndex + 1)}`);
}

/** 每章时长累加（取走时清零由调用方负责） */
export function addChapterSeconds(
  map: Record<string, number>,
  key: string,
  seconds: number,
): Record<string, number> {
  const add = Math.floor(Number(seconds) || 0);
  if (!key || add <= 0) return map;
  return { ...map, [key]: (map[key] || 0) + add };
}

/** 把一批增量并进侧车（纯函数，返回新对象） */
export function mergeSeconds(
  sidecar: ClipBookSidecar,
  delta: Record<string, number>,
): ClipBookSidecar {
  let next = sidecar.chapterSeconds;
  for (const [key, sec] of Object.entries(delta || {})) next = addChapterSeconds(next, key, sec);
  return { ...sidecar, chapterSeconds: next };
}
