/* ============================================================
 * bz-reader · bz 插件门面（data/bz-bridge.ts）
 *
 * 与 bz 的跨插件关系只有两种形态，这里只管第三种：**运行期调用**。
 *   · 文件级：bz 直接读 `<数据目录>/bz-reader.json`（那边的事）；
 *   · 协议级：`obsidian://bz-reader?…` 跳回原文（data/deeplink.ts）；
 *   · 运行期：本文件。bz 在插件实例上挂了两个门面（bz 侧 ADR-0215 / ADR-0294）：
 *       plugin.knowledge = { openTermNote, openPassageNote }
 *       plugin.readerAi  = { isIndexReady, embeddingModel, searchNotes, embedDocuments, embedQuery }
 *
 * 三条硬要求：
 *   1. **探测一律 typeof 守卫**，版本号只用于给人看的提示，不用于判定能力；
 *   2. 门面缺一半（老版本 bz）也算可用，缺的那一半单独降级；
 *   3. 拿不到就返回「为什么不可用」的**人话**，绝不抛错——用户点了一颗按钮，
 *      最坏的结果应该是一句话，而不是控制台里一条红字。
 * ============================================================ */
import type { App } from 'obsidian';
import { t } from '../i18n';

/** bz 的插件 id（目录名可以改，id 不会） */
export const BZ_PLUGIN_ID = 'bz';

export interface BzNoteHit {
  path: string;
  title: string;
  chunk: string;
  score: number;
}

/** 录入预填（bz 侧 KnowledgeEntryPrefill 的子集，多了就不该由我们填） */
export interface BzEntryOptions {
  text?: string;
  /** 来源：书内定位用协议串，bz 原样保存并在点开时回到原文 */
  source?: { kind: 'note'; path: string; name?: string };
  /** 写入成功后的回调；有它 bz 不会自动打开新笔记（不打断阅读） */
  onCreated?: (notePath: string) => void;
}

export interface BzKnowledgeFacade {
  openTermNote(term?: string, opts?: BzEntryOptions): void;
  openPassageNote(opts?: BzEntryOptions): void;
  /** 文献文件夹配好了没（老版本 bz 没有这一项，按「未知」处理） */
  isFolderReady?: () => boolean;
}

export interface BzAiFacade {
  isIndexReady(): boolean;
  embeddingModel(): string;
  searchNotes(query: string, topK?: number): Promise<BzNoteHit[]>;
  embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
}

/** missing = 没装；disabled = 装了没启用；ok = 实例在（门面可能缺半边） */
export type BzStatus = 'ok' | 'disabled' | 'missing';

export interface BzProbe {
  status: BzStatus;
  version: string;
  knowledge: BzKnowledgeFacade | null;
  ai: BzAiFacade | null;
}

const ABSENT: BzProbe = { status: 'missing', version: '', knowledge: null, ai: null };

type AnyApp = {
  plugins?: {
    getPlugin?: (id: string) => unknown;
    plugins?: Record<string, unknown>;
    manifests?: Record<string, { version?: string }>;
  };
};

function pluginOf(app: App | null | undefined): Record<string, unknown> | null {
  const plugins = (app as AnyApp | null | undefined)?.plugins;
  if (!plugins) return null;
  /* getPlugin 是较新的官方口子；拿不到就退回 plugins 表（两边都在的环境取到的是同一个实例） */
  const viaGetter = typeof plugins.getPlugin === 'function' ? plugins.getPlugin(BZ_PLUGIN_ID) : null;
  const raw = viaGetter ?? plugins.plugins?.[BZ_PLUGIN_ID] ?? null;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
}

function versionOf(app: App | null | undefined, plugin: Record<string, unknown> | null): string {
  const fromManifest = (app as AnyApp | null | undefined)?.plugins?.manifests?.[BZ_PLUGIN_ID]?.version;
  if (typeof fromManifest === 'string' && fromManifest) return fromManifest;
  const own = (plugin as { manifest?: { version?: unknown } } | null)?.manifest?.version;
  return typeof own === 'string' ? own : '';
}

function knowledgeOf(plugin: Record<string, unknown> | null): BzKnowledgeFacade | null {
  const k = plugin?.knowledge as Partial<BzKnowledgeFacade> | undefined;
  if (!k || typeof k.openTermNote !== 'function' || typeof k.openPassageNote !== 'function') return null;
  return k as BzKnowledgeFacade;
}

function aiOf(plugin: Record<string, unknown> | null): BzAiFacade | null {
  const a = plugin?.readerAi as Partial<BzAiFacade> | undefined;
  if (!a) return null;
  const need = ['isIndexReady', 'embeddingModel', 'searchNotes', 'embedDocuments', 'embedQuery'] as const;
  if (need.some((k) => typeof (a as Record<string, unknown>)[k] !== 'function')) return null;
  return a as BzAiFacade;
}

/**
 * 探测 bz。任何时候都能调：没装、禁用、老版本、插件列表拿不到，一律返回结构化结果，
 * 不抛错、不打日志——这条路径在每次重绘里都可能走到。
 */
export function probeBz(app: App | null | undefined): BzProbe {
  let plugin: Record<string, unknown> | null = null;
  try {
    plugin = pluginOf(app);
  } catch {
    return ABSENT;
  }
  if (!plugin) {
    /* 区分「没装」和「装了没启用」：前者该引导安装，后者该引导启用。
       manifest 在、实例不在，就是装了没启用。 */
    const hasManifest = !!(app as AnyApp | null | undefined)?.plugins?.manifests?.[BZ_PLUGIN_ID];
    return { status: hasManifest ? 'disabled' : 'missing', version: versionOf(app, null), knowledge: null, ai: null };
  }
  return { status: 'ok', version: versionOf(app, plugin), knowledge: knowledgeOf(plugin), ai: aiOf(plugin) };
}

/**
 * 门面缺哪一半 → 一句人话；齐了返回 null。
 *
 * 两个入口（检索/嵌入 与 知识盒录入）的三种失败说法完全一样，只差「缺的
 * 是哪一项」。以前是两份逐字相同的实现，改一句文案得记住改两处。
 */
function bridgeProblem(p: BzProbe, cap: 'ai' | 'knowledge'): string | null {
  if (p.status === 'missing') return t('bz.missing');
  if (p.status === 'disabled') return t('bz.disabled');
  if (!p[cap]) return t('bz.outdated', { version: p.version || '—' });
  return null;
}

/** 知识库 / 全书这两档要用的能力缺哪一半 */
export function aiBridgeProblem(p: BzProbe): string | null {
  return bridgeProblem(p, 'ai');
}

/** 两颗录入按钮要用的能力缺了 */
export function entryBridgeProblem(p: BzProbe): string | null {
  return bridgeProblem(p, 'knowledge');
}

export type BzEntryKind = 'term' | 'passage';

/**
 * 打开 bz 的录入界面。
 *
 * 返回**是否真的发出去了**：调用方据此决定要不要提示失败。文献文件夹没配时
 * bz 自己会把人送去设置页，这里补一句说明，不让用户对着一个跳走的界面猜。
 */
export function openBzEntry(
  probe: BzProbe,
  kind: BzEntryKind,
  text: string,
  source?: BzEntryOptions['source'],
  onCreated?: (notePath: string) => void,
): { ok: boolean; message?: string } {
  const problem = entryBridgeProblem(probe);
  if (problem || !probe.knowledge) return { ok: false, message: problem ?? t('bz.outdated', { version: probe.version || '—' }) };
  const opts: BzEntryOptions = { source, onCreated };
  try {
    if (kind === 'term') probe.knowledge.openTermNote(text, opts);
    else probe.knowledge.openPassageNote({ ...opts, text });
  } catch (e) {
    return { ok: false, message: (e as Error)?.message || t('bz.callFailed') };
  }
  /* 文件夹没配：bz 已把设置页送到用户面前，这里只补一句「还需要配什么」 */
  let folderReady = true;
  try {
    folderReady = probe.knowledge.isFolderReady ? probe.knowledge.isFolderReady() !== false : true;
  } catch {
    folderReady = true;
  }
  return { ok: true, message: folderReady ? undefined : t('bz.noFolder') };
}
