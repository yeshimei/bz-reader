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
  /* 签名按外部口径写（不带 app）。bz 1.40 及更早挂的是带 app 的内部函数，
     由 openBzEntry 按参数个数识别后补位——别在这里改回带 app 的形状，
     那会让新门面（绑定写法）收到一个多出来的首参。 */
  openTermNote(term?: string, opts?: BzEntryOptions): void;
  openPassageNote(opts?: BzEntryOptions): void;
  /** 文献文件夹配好了没（老版本 bz 没有这一项，按「未知」处理） */
  isFolderReady?: () => boolean;
  /**
   * 按路径打开知识盒的「文献预览」弹窗（2026-11-08，bz 侧同款出口）。
   *
   * 可选：老版本 bz 没有它，调用方（openBzPreview）探测不到就退回
   * 打开那篇笔记，不能因为缺这一项整块不可用。
   */
  openPreview?: (path: string) => void | Promise<void>;
}

export interface BzAiFacade {
  isIndexReady(): boolean;
  embeddingModel(): string;
  searchNotes(query: string, topK?: number): Promise<BzNoteHit[]>;
  embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
}

/** 没加进去的原因：已在计划中 / 文件不存在 */
export type BzReviewAddReason = 'exists' | 'notFound';

/**
 * 复习计划门面（bz 新增的 `reviewPlan`）。
 *
 * 这是两边关系里**第一次反向写 bz 的数据**：以前只有「录入交给你」（knowledge）
 * 与「问你只读算力」（readerAi）。复习排期表以文件路径为钥匙，所以我们写出的
 * 卡片必须先落盘、再通过这里登记，顺序反了会留下一条挂起记录。
 */
export interface BzReviewFacade {
  /** 复习域本身能不能用（bz 那边面板能打开） */
  isReady(): boolean;
  hasNote(path: string): Promise<boolean>;
  addNote(path: string): Promise<{ added: boolean; reason?: BzReviewAddReason }>;
  addNotes(paths: string[]): Promise<{ added: number; exists: number; notFound: number }>;
  removeNote(path: string): Promise<boolean>;
}

/** missing = 没装；disabled = 装了没启用；ok = 实例在（门面可能缺半边） */
export type BzStatus = 'ok' | 'disabled' | 'missing';

export interface BzProbe {
  status: BzStatus;
  version: string;
  knowledge: BzKnowledgeFacade | null;
  ai: BzAiFacade | null;
  /** 复习计划门面（bz 新增）；老版本为 null */
  review: BzReviewFacade | null;
}

const ABSENT: BzProbe = { status: 'missing', version: '', knowledge: null, ai: null, review: null };

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

/** 复习门面要齐的五个动作：缺一个就整块当没有 */
const REVIEW_METHODS = ['isReady', 'hasNote', 'addNote', 'addNotes', 'removeNote'] as const;

function reviewOf(plugin: Record<string, unknown> | null): BzReviewFacade | null {
  const r = plugin?.reviewPlan as Partial<BzReviewFacade> | undefined;
  if (!r) return null;
  if (REVIEW_METHODS.some((k) => typeof (r as Record<string, unknown>)[k] !== 'function')) return null;
  return r as BzReviewFacade;
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
    return {
      status: hasManifest ? 'disabled' : 'missing',
      version: versionOf(app, null),
      knowledge: null,
      ai: null,
      review: null,
    };
  }
  return {
    status: 'ok',
    version: versionOf(app, plugin),
    knowledge: knowledgeOf(plugin),
    ai: aiOf(plugin),
    review: reviewOf(plugin),
  };
}

/**
 * 门面缺哪一半 → 一句人话；齐了返回 null。
 *
 * 两个入口（检索/嵌入 与 知识盒录入）的三种失败说法完全一样，只差「缺的
 * 是哪一项」。以前是两份逐字相同的实现，改一句文案得记住改两处。
 */
function bridgeProblem(p: BzProbe, cap: 'ai' | 'knowledge' | 'review'): string | null {
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

/** 「加入复习」要用的能力缺了（老版本 bz 没有这个出口） */
export function reviewBridgeProblem(p: BzProbe): string | null {
  return bridgeProblem(p, 'review');
}

/**
 * 当前能用的复习门面；null = 用不了。
 *
 * 与 bzEmbedder 同一种收口：探测走一处，调用方不必自己把 missing / disabled /
 * outdated 三种状态各判一遍。
 */
export function reviewPlanOf(app: App | null | undefined): BzReviewFacade | null {
  return probeBz(app).review;
}

/* ─────────── 借 bz 的向量库（2026-11-07 决策回摆） ───────────
 *
 * 早先是「书自己算向量」：设置里填嵌入模型，本插件直连 `/embeddings`，
 * 画像存自己目录，bz 在不在都不影响。后来定为**向量这一层归第二大脑**：
 * 模型名、维度、嵌入都由 bz 提供，本插件只把正文递过去、把向量收回来
 * （向量仍存本插件目录，bz 只当嵌入服务）。
 *
 * 由此「能不能建索引」的判据从「设置里填没填嵌入模型」变成「bz 在不在」。
 * 模型名从 bz 取还有个额外好处：换了模型，画像里的模型名对不上，
 * 旧向量自动判废——这是自建时代靠用户手填才能发现的错。
 */

export interface BzEmbedder {
  /** bz 的向量能力；null = 用不了，原因看 problem */
  ai: BzAiFacade | null;
  /** bz 现在用的嵌入模型名（写进画像，换模型时据此判旧向量作废） */
  model: string;
  /** 用不了时的一句人话（null = 能用） */
  problem: string | null;
}

/**
 * 当前可用的嵌入能力。
 *
 * 空模型名也算不可用：画像里记不下模型名，将来换了模型就发现不了，
 * 拿旧向量去检索会静默给错结果——比建不了更糟。
 */
export function bzEmbedder(app: App | null | undefined): BzEmbedder {
  const probe = probeBz(app);
  const problem = aiBridgeProblem(probe);
  if (problem || !probe.ai) {
    return { ai: null, model: '', problem: problem ?? t('bz.outdated', { version: probe.version || '—' }) };
  }
  let model = '';
  try {
    model = String(probe.ai.embeddingModel() || '').trim();
  } catch {
    model = '';
  }
  if (!model) return { ai: null, model: '', problem: t('bz.noEmbedModel') };
  return { ai: probe.ai, model, problem: null };
}

/** 能不能把划词录进 bz 的文献盒（知识盒门面在不在） */
export function bzEntryReady(app: App | null | undefined): boolean {
  return !!probeBz(app).knowledge;
}

/**
 * 知识盒有没有「按路径打开预览」这个出口（bz 1.42+）。
 *
 * 与 bzEntryReady 分开：录入和打开是两件事，老版本 bz 能存不能放，
 * 界面据此决定「看名词」是开弹窗还是打开笔记。
 */
export function bzPreviewReady(app: App | null | undefined): boolean {
  return typeof probeBz(app).knowledge?.openPreview === 'function';
}

/**
 * 让 bz 打开一篇知识盒笔记的预览弹窗。
 *
 * 返回**是否转交出去**：false 时调用方自己打开笔记（`openLinkText`）。
 * 门面内部抛错一律吞掉——用户点了一枚链接，最坏的结果应该是「打开了笔记」，
 * 而不是控制台里一条红字。异步拒绝也不往外抛（bz 侧自己会兜回原生打开）。
 */
export function openBzPreview(app: App | null | undefined, path: string): boolean {
  const fn = probeBz(app).knowledge?.openPreview;
  const key = String(path ?? '').trim();
  if (typeof fn !== 'function' || !key) return false;
  try {
    /* 门面返回值在类型上可能是 void 或 Promise：统一按 unknown 接，
       有 catch 才吞拒绝，别用强转假装它一定是 Promise。 */
    const out: unknown = fn(key);
    if (out && typeof (out as { catch?: unknown }).catch === 'function') {
      (out as Promise<void>).catch(() => undefined);
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * 能不能把 bz 的笔记当依据（门面齐 + bz 自己的索引建好了）。
 *
 * 问「索引建好没」是必须的：门面在、索引空着时去搜只会拿到空结果，
 * 界面却会显示「已连接」——那是更让人困惑的状态。
 */
export function bzNotesReady(app: App | null | undefined): boolean {
  const ai = probeBz(app).ai;
  if (!ai) return false;
  try {
    return ai.isIndexReady();
  } catch {
    return false;
  }
}

/** 设置页要显示的那几行（不把门面对象递给渲染层，那里只会用到这几个值） */
export interface BzSnapshot {
  /** bz 在不在（装了并启用） */
  ok: boolean;
  version: string;
  /** bz 现在用的嵌入模型名；空串 = 还没配 */
  model: string;
  /** 划词能录进文献盒 */
  entry: boolean;
  /** bz 的索引建好了，笔记能当依据 */
  notes: boolean;
}

export function bzSnapshot(app: App | null | undefined): BzSnapshot {
  const probe = probeBz(app);
  return {
    ok: probe.status === 'ok',
    version: probe.version,
    model: bzEmbedder(app).model,
    entry: !!probe.knowledge,
    notes: bzNotesReady(app),
  };
}

export type BzEntryKind = 'term' | 'passage';

/**
 * 这个门面函数要不要我们先塞一个 app 进去。
 *
 * bz 1.40 及更早把 knowledge 域的**内部函数原样**挂在 `plugin.knowledge` 上，
 * 第一个参数是 Obsidian 的 app；文档里给外部用的形状（也是这里的接口）没有 app。
 * 按文档调用会把选项对象当成名词递进去，bz 内部那句 `term.trim()` 当场抛
 * `term.trim is not a function`——2026-11-07 用户点「存为名词」看到的就是它。
 *
 * 只能按参数个数认：绑定写法是 2 个（名词）/ 1 个（段落），原样挂出来是
 * 3 个 / 2 个。bz 那边改成绑定写法之后这里自然走不到补 app 的分支。
 */
function wantsApp(fn: (...args: never[]) => void, bound: number): boolean {
  return typeof fn === 'function' && fn.length > bound;
}

/**
 * 打开 bz 的录入界面。
 *
 * 返回**是否真的发出去了**：调用方据此决定要不要提示失败。文献文件夹没配时
 * bz 自己会把人送去设置页，这里补一句说明，不让用户对着一个跳走的界面猜。
 *
 * `app` 是给老门面补位用的（见 `wantsApp`）；新门面用不上，传了也不影响。
 */
export function openBzEntry(
  probe: BzProbe,
  kind: BzEntryKind,
  text: string,
  source?: BzEntryOptions['source'],
  onCreated?: (notePath: string) => void,
  app?: App | null,
): { ok: boolean; message?: string } {
  const problem = entryBridgeProblem(probe);
  if (problem || !probe.knowledge) return { ok: false, message: problem ?? t('bz.outdated', { version: probe.version || '—' }) };
  const k = probe.knowledge;
  const opts: BzEntryOptions = { source, onCreated };
  const termFn = k.openTermNote.bind(k);
  const passageFn = k.openPassageNote.bind(k);
  const needApp = kind === 'term' ? wantsApp(termFn, 2) : wantsApp(passageFn, 1);
  /* 老门面缺 app 时宁可不调：硬调进去只会得到一条看不懂的 TypeError */
  if (needApp && !app) return { ok: false, message: t('bz.outdated', { version: probe.version || '—' }) };
  try {
    if (kind === 'term') {
      if (needApp) (termFn as unknown as (host: App, t: string, o: BzEntryOptions) => void)(app as App, text, opts);
      else k.openTermNote(text, opts);
    } else {
      const arg = { ...opts, text };
      if (needApp) (passageFn as unknown as (host: App, o: BzEntryOptions) => void)(app as App, arg);
      else k.openPassageNote(arg);
    }
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
