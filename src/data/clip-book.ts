/**
 * 剪藏本「活书」的数据层：从 bz 门面拉清单、按订阅分组、按需取正文。
 *
 * 与静态导出的区别：这里**没有「生成」这个动作**。打开书 = 读一次清单；
 * 翻到哪一章 = 拉哪一篇正文；图片视频 = 用的时候才读。剪藏本一变，
 * 阅读页轮询 `dataVersion()` 就能知道，重建目录即可。
 */
import type { App } from 'obsidian';
import { t } from '../i18n';
import { probeClipbook, clipbookProblem, type ClipbookArticle, type ClipbookFacade, type ClipReadEntry } from './clipbook-bridge';
import { planClipBook, type PlanArticle } from './clip-epub/plan';
import { makeClipBook, type ClipBookHandle, type ClipChapter, type ClipGroup } from '../engine/clipbook';

export class ClipBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipBookError';
  }
}

export interface ClipBookSnapshot {
  version: string;
  title: string;
  groups: ClipGroup[];
  chapters: ClipChapter[];
  articleCount: number;
  sourceCount: number;
}

/** 门面：拿不到就抛一句人话 */
export function requireClipbook(app: App): ClipbookFacade {
  const probe = probeClipbook(app);
  const problem = clipbookProblem(probe);
  if (problem || !probe.facade) {
    throw new ClipBookError(problem ?? t('bz.outdated', { version: probe.version || '—' }));
  }
  return probe.facade;
}

export function clipbookProblemText(app: App): string | null {
  const probe = probeClipbook(app);
  return clipbookProblem(probe);
}

function toPlanArticle(a: ClipbookArticle): PlanArticle {
  return {
    key: a.key,
    title: a.title,
    url: a.url,
    author: a.author,
    date: a.date,
    body: '',
    size: a.size,
    summary: a.summary,
    saved: a.state === 'saved',
    state: a.state,
    notePath: a.notePath,
    ts: a.ts,
    sourceId: a.sourceId,
    sourceName: a.source,
  };
}

/** 拉一次清单：源 + 文章元数据，不含正文 */
export async function loadClipBook(app: App): Promise<ClipBookSnapshot> {
  const facade = requireClipbook(app);
  let version = '';
  try {
    version = await facade.dataVersion();
  } catch {
    version = '';
  }
  const sources = await facade.sources();
  const articles = await facade.articles({ includeRead: true });
  const plan = planClipBook(sources, articles.map(toPlanArticle), { includeUnsaved: true, order: 'newest' });
  const groups: ClipGroup[] = plan.sources.map((s) => ({
    id: s.id,
    name: s.name,
    chapters: s.articles.map((a) => ({
      key: a.key,
      title: a.title,
      sourceId: s.id,
      sourceName: s.name,
      author: a.author,
      date: a.date,
      url: a.url,
      state: a.state ?? 'unread',
      notePath: a.notePath ?? null,
      body: '',
      size: a.size,
      summary: a.summary,
    })),
  }));
  return {
    version,
    title: t('clip.bookTitle'),
    groups,
    chapters: groups.flatMap((g) => g.chapters),
    articleCount: plan.articleCount,
    sourceCount: plan.sourceCount,
  };
}

/**
 * 剪藏本里一篇都收不到（新装 bz、订阅全清空、剪藏目录还没配）。
 *
 * 这类书不能交给 foliate：0 个 section 的 open 不派发 relocate、也不报错，
 * 界面上就是一整屏纯白（真机：新用户第一次点开 100% 命中）。阅读页拿到
 * 这个判定就画错误页，不要假装书打开了。
 */
export function clipBookIsEmpty(snap: ClipBookSnapshot | null | undefined): boolean {
  return !snap || snap.chapters.length === 0;
}

const VIDEO_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
};

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

function mimeOf(path: string, kind: 'image' | 'video'): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return (kind === 'video' ? VIDEO_EXT : IMAGE_EXT)[ext] || 'application/octet-stream';
}

/**
 * 本地资源解析：vault 文件读成 blob URL。
 * 同一个文件只读一次；blob 的生命周期交给 clip book 的 destroy。
 */
export function clipAssetResolver(app: App): (kind: 'image' | 'video', path: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return (kind, path) => {
    const key = `${kind}:${path}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const task = (async (): Promise<string | null> => {
      try {
        if (!(await app.vault.adapter.exists(path))) return null;
        const buf = await app.vault.adapter.readBinary(path);
        return URL.createObjectURL(new Blob([buf], { type: mimeOf(path, kind) }));
      } catch {
        return null;
      }
    })();
    cache.set(key, task);
    return task;
  };
}

/** 管住「按需拉正文」的缓存：同一章只拉一次（刷新时换新的 resolver） */
export function clipBodyLoader(facade: ClipbookFacade): (key: string) => Promise<string> {
  const cache = new Map<string, string>();
  return async (key) => {
    if (cache.has(key)) return cache.get(key) as string;
    let body = '';
    try {
      body = await facade.articleBody(key);
    } catch {
      body = '';
    }
    cache.set(key, body);
    return body;
  };
}

/** 造一本可在 View.open 里用的剪藏书（清单已就绪，正文按章拉） */
export function makeClipBookForApp(
  app: App,
  snap: ClipBookSnapshot,
  onSectionSize?: (index: number, size: number) => void,
): ClipBookHandle {
  const facade = requireClipbook(app);
  const loadBody = clipBodyLoader(facade);
  return makeClipBook({
    title: snap.title,
    author: t('clip.author'),
    groups: snap.groups,
    resolveAsset: clipAssetResolver(app),
    loadBody,
    onSectionSize,
    labels: {
      author: t('clip.author'),
      original: t('clip.action.openSource'),
      saved: t('clip.action.saved'),
      videoLink: t('clip.video.browser'),
      videoMissing: t('clip.video.missing'),
      missingImage: t('clip.image.missing'),
      emptyBody: t('clip.chapter.empty'),
    },
  });
}

/** 进章标已读（失败静默，下一章再试；不影响阅读） */
export async function markClipChapterRead(app: App, key: string): Promise<boolean> {
  const probe = probeClipbook(app);
  if (!probe.facade) return false;
  try {
    return (await probe.facade.markRead([key])) > 0;
  } catch {
    return false;
  }
}

/**
 * 把这一批阅读秒数回写给剪藏本（2026-11-13）。返回落账篇数。
 *
 * 三步都是一样的边界：没装 bz / 老版本没有 recordRead / 写盘失败，
 * 一律返回 0 且不抛。时长回写是「锦上添花」，绝不能因为它让阅读中断——
 * 剪藏本那边最坏就是少记这一批，书里的 chapterSeconds 还是准的。
 */
export async function reportClipSeconds(app: App, entries: ClipReadEntry[]): Promise<number> {
  if (!entries || !entries.length) return 0;
  const probe = probeClipbook(app);
  const facade = probe.facade;
  if (!facade || typeof facade.recordRead !== 'function') return 0;
  try {
    return (await facade.recordRead(entries)) || 0;
  } catch {
    return 0;
  }
}

export interface ClipSaveOutcome {
  ok: boolean;
  code?: string;
  notePath?: string;
}

/** 存为剪藏：结果码交给界面翻译 */
export async function saveClipChapter(app: App, key: string): Promise<ClipSaveOutcome> {
  const probe = probeClipbook(app);
  if (!probe.facade) return { ok: false, code: 'noBridge' };
  try {
    const r = await probe.facade.saveArticle(key);
    return { ok: !!r.ok, code: r.code, notePath: r.notePath };
  } catch (e) {
    return { ok: false, code: (e as Error)?.message || t('common.unknownError') };
  }
}

/** 打开 bz 的剪藏本面板（bz 裸注册的命令 id） */
export function openClipbookPanel(app: App): boolean {
  try {
    const commands = (app as unknown as { commands?: { executeCommandById?: (id: string) => boolean } }).commands;
    return !!commands?.executeCommandById?.('bz-clipbook-open');
  } catch {
    return false;
  }
}

/** 当前数据版本（轮询用）；拿不到门面或读失败给 null */
export async function currentClipVersion(app: App): Promise<string | null> {
  const probe = probeClipbook(app);
  if (!probe.facade) return null;
  try {
    return await probe.facade.dataVersion();
  } catch {
    return null;
  }
}

/** 剪藏本可用吗（设置页/打开书时说清差哪一步） */
export function clipbookAvailability(app: App): { ok: boolean; problem: string | null } {
  const probe = probeClipbook(app);
  const problem = clipbookProblem(probe);
  return {
    ok: !problem && !!probe.facade,
    problem: problem ?? (probe.facade ? null : t('bz.outdated', { version: probe.version || '—' })),
  };
}

/** 生成/保存失败时给一句人话 */
export function clipSaveText(code?: string): string {
  switch (code) {
    case 'bilibili':
      return t('clip.save.bilibili');
    case 'noFolder':
      return t('clip.save.noFolder');
    case 'alreadySaved':
      return t('clip.save.already');
    case 'noBridge':
      return t('bz.missing');
    default:
      return t('clip.save.failed', { why: code || t('common.unknownError') });
  }
}

/**
 * 单篇摘要（2026-11-13）：调 bz 门面生成并写回，成功后这一段会出现在这一章
 * 的标题下方。只对「还没落地成剪藏笔记」的订阅文章有效——剪藏笔记的摘要来自
 * 它自己的 frontmatter，由 bz 那边维护。
 *
 * 门面可能来自老版本 bz（没有这个能力）：按 typeof 探测，缺失时报 noBridge，
 * 不要假装成功、也不要把整本书判成不可用。
 */
export async function summarizeClipChapter(
  app: App,
  key: string,
): Promise<{ ok: boolean; summary?: string; code?: string }> {
  const probe = probeClipbook(app);
  const facade = probe.facade;
  if (!facade) return { ok: false, code: 'noBridge' };
  if (typeof facade.summarizeArticle !== 'function') return { ok: false, code: 'noBridge' };
  try {
    const out = await facade.summarizeArticle(key);
    if (out && out.ok && out.summary) return { ok: true, summary: out.summary };
    return { ok: false, code: out?.code || 'unknown' };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

/** 摘要失败原因码 → 一句人话（阅读器自己翻译，bz 只给码） */
export function clipSummaryText(code?: string): string {
  switch (code) {
    case 'notFound':
      return t('clip.summary.notFound');
    case 'clipNote':
      /* 剪藏笔记的摘要来自它自己的 frontmatter，门面不给它生成。
         以前这里落到 notFound 的「没有正文」文案，用户以为文章坏了。 */
      return t('clip.summary.clipNote');
    case 'aiFailed':
      return t('clip.summary.aiFailed');
    case 'writeFailed':
      return t('clip.summary.writeFailed');
    case 'noBridge':
      return t('bz.missing');
    default:
      return t('clip.save.failed', { why: code || t('common.unknownError') });
  }
}
