/* ============================================================
 * bz-reader · 剪藏本「活书」（engine/clipbook.ts）
 *
 * 不是 EPUB 文件，也不是 TXT：章节来自 bz 剪藏本的实时数据，按订阅分成
 * 卷、按文章切成章，造一个 foliate 认得的 book 对象交给 View.open。
 *
 * 与 TXT 引擎同一套契约（sections[].load 返回 blob URL、splitTOCHref、
 * resolveHref），所以翻页、目录、进度、划线、搜索、朗读全部照旧。
 *
 * 三条与静态书不同的地方：
 *   · 正文是 Markdown，按章惰性渲染（打开书不解析全部文章）。
 *   · 图片/视频走调用方给的解析器：本地文件读成 blob，外链保留原地址。
 *   · 章节文件名按文章 key 稳定生成（`t-<hash>.xhtml`），刷新后同一篇
 *     文章还在同一章，CFI 的章内部分继续有效。
 * ============================================================ */
import type { FoliateBook, FoliateSection, FoliateTOCItem } from '../types/foliate';
import { KEEP_FRAME_ATTR } from './blob-srcdoc';
import { collectImageRefs, escXhtml, markdownToXhtml } from '../data/clip-epub/markdown';

export type ClipChapterState = 'unread' | 'read' | 'saved';

export interface ClipChapter {
  key: string;
  title: string;
  sourceId: string;
  sourceName: string;
  author: string;
  date: string;
  url: string;
  state: ClipChapterState;
  notePath: string | null;
  body: string;
}

export interface ClipGroup {
  id: string;
  name: string;
  chapters: ClipChapter[];
}

export interface ClipBookHandle {
  book: FoliateBook;
  chapters: ClipChapter[];
  byHref(href: string): ClipChapter | null;
  byKey(key: string): ClipChapter | null;
  hrefOf(key: string): string;
  indexOf(key: string): number;
  destroy(): void;
}

export interface ClipBookBuildOptions {
  title: string;
  author?: string;
  groups: ClipGroup[];
  /**
   * 取一个本地资源（vault 路径）的可用地址（blob URL / 外链）。
   * 图片与视频共用；返回 null 表示这一项进不了书（渲染层给占位）。
   */
  resolveAsset?: (kind: 'image' | 'video', path: string) => Promise<string | null>;
  /**
   * 按需取正文（打开书时只拿清单，翻到那一章才拉）。
   * 缺省时直接用 `chapter.body`——批量预取过正文的调用方不用传。
   */
  loadBody?: (key: string) => Promise<string>;
  /** 书页里的几个短文案（由调用方按当前语言给；缺省英文，别把中文写进渲染层） */
  labels?: Partial<ClipBookLabels>;
}

export interface ClipBookLabels {
  author: string;
  original: string;
  saved: string;
  videoLink: string;
  videoMissing: string;
  missingImage: string;
}

const DEFAULT_LABELS: ClipBookLabels = {
  author: 'bz clipbook',
  original: 'Source',
  saved: 'Saved',
  videoLink: 'Watch in browser',
  videoMissing: '[video]',
  missingImage: '[image]',
};

function hashId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* 书页样式。
 *
 * 视频容器只用 `margin`，**不要**用 padding-top 百分比 / aspect-ratio 撑高度：
 * 章节进分页器后是分栏排的，百分比内边距按列宽算出来是 0，容器整个塌成一条线，
 * 播放器一个像素都不显示（真机验证过）。高度由 iframe 自带的 height 决定。
 */
const CHAPTER_CSS = `
html, body { margin: 0; padding: 0; }
body { font-family: serif; line-height: 1.75; padding: 1.2em; overflow-wrap: break-word; }
h1 { font-size: 1.5em; line-height: 1.35; margin: 0 0 .55em; }
.bzr-clip-meta { color: #888; font-size: .82em; margin: 0 0 1.4em; }
.bzr-clip-body img { max-width: 100%; height: auto; }
.bzr-clip-body pre { overflow-x: auto; padding: .7em; background: rgba(0,0,0,.05); }
.bzr-clip-body blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #bbb; color: #555; }
.bzr-clip-foot { margin-top: 2.4em; padding-top: .8em; border-top: 1px solid #ddd; font-size: .82em; color: #888; }
.bzr-clip-foot a { color: inherit; }
.bzr-img-missing { color: #999; font-style: italic; }
video { max-width: 100%; height: auto; display: block; margin: 1em 0; background: #000; }
.bzr-video-frame { margin: 1em 0; background: #000; }
.bzr-video-link { color: #888; font-size: .85em; }
`;

/** 视频占位：Markdown 里单独成行，渲染后整段替换成播放器 */
const VIDEO_RE = /!\[\[([^\]|]+\.(?:mp4|webm|ogv|m4v|mov))(?:\|[^\]]*)?\]\]|(?<![(\[])(https?:\/\/\S+?\.(?:mp4|webm|ogv|m4v))(?![)\w])|^\s*(https?:\/\/(?:www\.)?(?:bilibili\.com\/video\/|b23\.tv\/)\S+)\s*$/gim;

interface VideoRef {
  kind: 'local' | 'direct' | 'bilibili';
  src: string;
}

/** 把视频行换成占位，正文其余部分交给 Markdown 渲染 */
function extractVideos(body: string): { body: string; videos: VideoRef[] } {
  const videos: VideoRef[] = [];
  const out = body.replace(VIDEO_RE, (_m, local?: string, direct?: string, bili?: string) => {
    if (local) {
      videos.push({ kind: 'local', src: local.trim() });
    } else if (direct) {
      videos.push({ kind: 'direct', src: direct.trim() });
    } else if (bili) {
      videos.push({ kind: 'bilibili', src: bili.trim() });
    }
    return `\n\n@@BZRVIDEO:${videos.length - 1}@@\n\n`;
  });
  return { body: out, videos };
}

function bilibiliEmbed(url: string): string | null {
  const m = /\/video\/(BV[\w]+)/i.exec(url);
  if (!m) return null;
  return `https://player.bilibili.com/player.html?bvid=${m[1]}&page=1&high_quality=1&autoplay=0`;
}

function videoHtml(v: VideoRef, resolved: string | null, L: ClipBookLabels): string {
  if (v.kind === 'bilibili') {
    const embed = bilibiliEmbed(v.src);
    if (embed) {
      /* `data-bzr-keep` 是给 blob-srcdoc 的通行证：它默认删掉所有 iframe（防书里
         夹带框架），只放行打了这个标记、且地址是 https 的那一个。 */
      const frame = `<div class="bzr-video-frame"><iframe ${KEEP_FRAME_ATTR}="video" src="${escXhtml(embed)}" width="100%" height="320" style="width:100%;height:320px;border:0;display:block" scrolling="no" frameborder="0" allowfullscreen="true"></iframe></div>`;
      /* 播放器起不来（网络 / 站点拒绝内嵌 / 宿主策略）时，至少还有一条路走：
         链接永远渲染，点一下到浏览器里看。 */
      const fallback = `<p class="bzr-video-link"><a href="${escXhtml(v.src)}">${escXhtml(L.videoLink)}</a></p>`;
      return frame + fallback;
    }
    return `<p><a href="${escXhtml(v.src)}">${escXhtml(L.videoLink)}</a></p>`;
  }
  if (!resolved) return `<p class="bzr-img-missing">${escXhtml(L.videoMissing)}</p>`;
  return `<video controls playsinline preload="metadata" src="${escXhtml(resolved)}"></video>`;
}

function chapterHtml(ch: ClipChapter, bodyHtml: string, L: ClipBookLabels): string {
  const meta = [ch.sourceName, ch.author, ch.date].map((s) => String(s || '').trim()).filter(Boolean);
  const foot = [
    /^https?:\/\//i.test(ch.url) ? `<a href="${escXhtml(ch.url)}">${escXhtml(L.original)}</a>` : '',
    ch.state === 'saved' ? `<span>${escXhtml(L.saved)}</span>` : '',
  ].filter(Boolean);
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8" />',
    `<title>${escXhtml(ch.title)}</title>`,
    `<style>${CHAPTER_CSS}</style>`,
    '</head>',
    `<body data-bzr-clip-key="${escXhtml(ch.key)}">`,
    '<article class="bzr-clip-article">',
    '<header>',
    `<h1>${escXhtml(ch.title)}</h1>`,
    meta.length ? `<p class="bzr-clip-meta">${escXhtml(meta.join(' · '))}</p>` : '',
    '</header>',
    `<div class="bzr-clip-body">${bodyHtml}</div>`,
    foot.length ? `<footer class="bzr-clip-foot">${foot.join(' · ')}</footer>` : '',
    '</article>',
    '</body>',
    '</html>',
  ].join('');
}

/**
 * 造一本剪藏书。章节内容是惰性的：只有 foliate 真的装到某一章，才会
 * 解析那篇的 Markdown、读图、造 blob。
 */
export function makeClipBook(opts: ClipBookBuildOptions): ClipBookHandle {
  const L: ClipBookLabels = { ...DEFAULT_LABELS, ...(opts.labels || {}) };
  const all: ClipChapter[] = opts.groups.flatMap((g) => g.chapters);
  const hrefList = all.map((c) => `t-${hashId(c.key)}.xhtml`);
  const hrefByKey = new Map<string, string>();
  all.forEach((c, i) => hrefByKey.set(c.key, hrefList[i]));
  const chapterByHref = new Map<string, ClipChapter>();
  all.forEach((c, i) => chapterByHref.set(hrefList[i], c));

  const sectionUrls: string[] = [];
  const assetUrls: string[] = [];
  const assetCache = new Map<string, string | null>();

  const resolveAsset = async (kind: 'image' | 'video', path: string): Promise<string | null> => {
    const key = `${kind}:${path}`;
    if (assetCache.has(key)) return assetCache.get(key) ?? null;
    let url: string | null = null;
    try {
      url = opts.resolveAsset ? await opts.resolveAsset(kind, path) : null;
    } catch {
      url = null;
    }
    assetCache.set(key, url);
    if (url && url.startsWith('blob:')) assetUrls.push(url);
    return url;
  };

  const render = async (ch: ClipChapter): Promise<string> => {
    const raw = ch.body || (opts.loadBody ? await opts.loadBody(ch.key).catch(() => '') : '');
    const { body, videos } = extractVideos(raw || '');
    const refs = collectImageRefs(body);
    const imageMap = new Map<string, string>();
    for (const p of refs.local) {
      const url = await resolveAsset('image', p);
      if (url) imageMap.set(p, url);
    }
    const videoUrls: Array<string | null> = [];
    for (const v of videos) {
      videoUrls.push(v.kind === 'local' ? await resolveAsset('video', v.src) : v.src);
    }
    let html = markdownToXhtml(body, {
      localImage: (p) => imageMap.get(p) ?? null,
      /* 外链图直接交给阅读器加载；网络断了就是一张裂图，好过整章不显示 */
      externalImage: (src) => src,
      missingImage: L.missingImage,
    });
    html = html
      .replace(/<p>\s*@@BZRVIDEO:(\d+)@@\s*<\/p>/g, (_m, i: string) => {
        const idx = Number(i);
        return videos[idx] ? videoHtml(videos[idx], videoUrls[idx] ?? null, L) : '';
      })
      .replace(/@@BZRVIDEO:(\d+)@@/g, (_m, i: string) => {
        const idx = Number(i);
        return videos[idx] ? videoHtml(videos[idx], videoUrls[idx] ?? null, L) : '';
      });
    return chapterHtml(ch, html, L);
  };

  const sections: FoliateSection[] = all.map((ch, i) => {
    let html: string | null = null;
    let current: string | null = null;
    const ensure = async (): Promise<string> => (html ??= await render(ch));
    return {
      id: `clip-${i}`,
      href: hrefList[i],
      linear: 'yes',
      /* 正文还没拉时给一个估算值：页数估算按字节走，0 会让封面进度条一开始就满 */
      size: Math.max(1200, (ch.body || '').length),
      load: async () => {
        const url = URL.createObjectURL(new Blob([await ensure()], { type: 'text/html' }));
        sectionUrls.push(url);
        current = url;
        return url;
      },
      createDocument: async () => new DOMParser().parseFromString(await ensure(), 'text/html'),
      unload: () => {
        const url = current;
        current = null;
        if (!url) return;
        const at = sectionUrls.indexOf(url);
        if (at >= 0) sectionUrls.splice(at, 1);
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* 已经回收过就算了 */
        }
      },
      resolveHref: () => hrefList[i],
    };
  });

  const toc: FoliateTOCItem[] = opts.groups
    .filter((g) => g.chapters.length > 0)
    .map((g) => ({
      label: g.name,
      href: hrefByKey.get(g.chapters[0].key) ?? hrefList[0] ?? '',
      subitems: g.chapters.map((c) => ({ label: c.title, href: hrefByKey.get(c.key) ?? '' })),
    }));

  const book: FoliateBook = {
    metadata: { title: opts.title, author: opts.author || L.author, language: 'zh' },
    toc,
    sections,
    rendition: { layout: 'reflowable' },
    dir: 'ltr',
    splitTOCHref: async (href: string) => {
      const [file, frag] = String(href).split('#');
      return [file, frag ?? null];
    },
    getTOCFragment: (doc: Document, id: string) => doc.getElementById(id),
    resolveHref: (href: string) => {
      const [file, frag] = String(href).split('#');
      const index = hrefList.indexOf(file);
      return {
        index: index >= 0 ? index : 0,
        anchor: frag ? (doc: Document) => doc.getElementById(frag) ?? 0 : 0,
      };
    },
    isExternal: (href: string) => /^https?:/i.test(href),
    destroy: () => {
      for (const url of sectionUrls.splice(0)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* 单条回收失败不拦整本收尾 */
        }
      }
      for (const url of assetUrls.splice(0)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* 同上 */
        }
      }
    },
  };

  return {
    book,
    chapters: all,
    byHref: (href: string) => chapterByHref.get(String(href).split('#')[0]) ?? null,
    byKey: (key: string) => all.find((c) => c.key === key) ?? null,
    hrefOf: (key: string) => hrefByKey.get(key) ?? '',
    indexOf: (key: string) => all.findIndex((c) => c.key === key),
    destroy: () => book.destroy?.(),
  };
}

export { hashId as clipChapterHash };
