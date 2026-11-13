/* ============================================================
 * bz-reader · bz 剪藏本门面（data/clipbook-bridge.ts）
 *
 * 「剪藏成书」的数据来源。与 bz 的关系只有运行期调用一种：
 * 经 getPlugin('bz').clipbook 拿源清单、文章、正文，并调标已读 / 存剪藏。
 *
 * 三条硬要求与 bz-bridge 一致：
 *   1. 探测一律 typeof 守卫，版本号只给人看；
 *   2. 门面缺一半（老版本 bz）也算可用，缺的那一半单独降级；
 *   3. 拿不到就返回「为什么不可用」的人话，不抛错。
 * ============================================================ */
import type { App } from 'obsidian';
import { t } from '../i18n';
import { bzPluginInstance, bzPluginVersion } from './bz-bridge';

export type ClipSourceKind = 'rss' | 'bilibili' | 'platform' | 'site';

export interface ClipbookSource {
  id: string;
  name: string;
  kind: ClipSourceKind;
}

export interface ClipbookArticle {
  key: string;
  origin: 'news' | 'clip';
  title: string;
  url: string;
  author: string;
  sourceId: string;
  source: string;
  date: string;
  ts: number;
  summary: string;
  /** 正文长度（字符数）；剪藏笔记清单阶段给 0，渲染后回填 */
  size?: number;
  state: 'unread' | 'read' | 'saved';
  notePath: string | null;
  tags: string[];
}

export interface ClipSaveResult {
  ok: boolean;
  notePath?: string;
  code?: 'bilibili' | 'alreadySaved' | 'notFound' | 'noFolder';
}

export interface ClipSummaryResult {
  ok: boolean;
  summary?: string;
  code?: 'notFound' | 'aiFailed' | 'writeFailed';
}

/** 一篇的阅读时长上报（阅读器按章计时后交给剪藏本） */
export interface ClipReadEntry {
  /** 文章标识（与 articles() 的 key 同一套） */
  key: string;
  /** 新增秒数（≥1；调用方已合并、已取整） */
  seconds: number;
  /** 展示用：剪藏本列表与报告的条目名 */
  title?: string;
  /** 展示用：来源名（B站 UP / 平台 / 站点） */
  src?: string;
}

/** bz 挂在插件实例上的剪藏本门面（形状只在这里声明） */
export interface ClipbookFacade {
  readonly version: 1;
  sources(): Promise<ClipbookSource[]>;
  articles(opts?: { savedOnly?: boolean; includeRead?: boolean }): Promise<ClipbookArticle[]>;
  articleBody(key: string): Promise<string>;
  markRead(keys: string[]): Promise<number>;
  saveArticle(key: string): Promise<ClipSaveResult>;
  /**
   * 生成单篇 AI 摘要并写回（可选：老版本 bz 没有这个能力）。
   * 形状声明成可选，调用方一律 typeof 探测，不要拿版本号当判据。
   */
  summarizeArticle?(key: string): Promise<ClipSummaryResult>;
  /**
   * 回写阅读时长（可选：老版本 bz 没有这个能力）。
   *
   * 剪藏本这边把秒数累进侧写、凑满的整分钟进阅读流水；阅读器只报增量。
   * 同样是 typeof 探测，缺了就当没这个功能——读照常读，只是剪藏本里
   * 看不到「读了几分钟」。
   */
  recordRead?(entries: ClipReadEntry[]): Promise<number>;
  isReady(): { ok: boolean; code?: 'noFolder' };
  /** 数据版本：变了说明剪藏本有新文章 / 状态变化 / 笔记改动（阅读页轮询它） */
  dataVersion(): Promise<string>;
}

export interface ClipbookProbe {
  /** ok = 门面在；missing = 没装 bz；disabled = 装了没启用；outdated = bz 版本没有这个门面 */
  status: 'ok' | 'missing' | 'disabled' | 'outdated';
  version: string;
  facade: ClipbookFacade | null;
}

const NEED = ['sources', 'articles', 'articleBody', 'markRead', 'saveArticle'] as const;

function facadeOf(plugin: Record<string, unknown> | null): ClipbookFacade | null {
  const c = plugin?.clipbook as Partial<ClipbookFacade> | undefined;
  if (!c) return null;
  if (NEED.some((k) => typeof (c as Record<string, unknown>)[k] !== 'function')) return null;
  return c as ClipbookFacade;
}

/** 探测 bz 的剪藏本门面。任何时候都能调，不抛错。 */
export function probeClipbook(app: App | null | undefined): ClipbookProbe {
  let plugin: Record<string, unknown> | null = null;
  try {
    plugin = bzPluginInstance(app);
  } catch {
    return { status: 'missing', version: '', facade: null };
  }
  if (!plugin) {
    const anyApp = app as { plugins?: { manifests?: Record<string, unknown> } } | null | undefined;
    const hasManifest = !!anyApp?.plugins?.manifests?.['bz'];
    return {
      status: hasManifest ? 'disabled' : 'missing',
      version: bzPluginVersion(app, null),
      facade: null,
    };
  }
  const facade = facadeOf(plugin);
  return {
    status: facade ? 'ok' : 'outdated',
    version: bzPluginVersion(app, plugin),
    facade,
  };
}

/** 用不了时的一句话（null = 能用）；生成书只需要门面在，保存/已读才需要具体方法 */
export function clipbookProblem(p: ClipbookProbe): string | null {
  if (p.status === 'missing') return t('bz.missing');
  if (p.status === 'disabled') return t('bz.disabled');
  if (p.status === 'outdated') return t('bz.outdated', { version: p.version || '—' });
  return null;
}

/** 剪藏本的门面能不能读（生成书的前提） */
export function clipbookReady(app: App | null | undefined): boolean {
  return !!probeClipbook(app).facade;
}
