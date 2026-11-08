/* ============================================================
 * bz-reader · 壳层注入源（shell/source.ts）
 *
 * 书架视图、侧栏视图都不 import 插件类，也不 import 引擎：
 * 它们在 onload 时拿到这样一份「能力包」，回调由插件提供。
 *
 * 这样做的三个好处（都是踩过的坑）：
 *   1. 视图可以被 Obsidian 在任何时刻创建/销毁，拿不到插件实例也不会崩；
 *   2. 书架不依赖 ReaderView，阅读 tab 关掉之后书架照常工作；
 *   3. 只有一个注入口，将来换承载（比如再拆一个视图）不需要改一堆 import。
 * ============================================================ */
import type { App } from 'obsidian';
import type { BookRepo } from '../data/book-repo';
import type { ReaderBook } from '../data/schema';
import type { ReaderPrefs } from '../data/prefs';
import { normalizePrefs } from '../data/prefs';
import type { ReaderSettings } from '../data/settings';
import { normalizeSettings } from '../data/settings';
import type { ReaderStore } from '../data/store';
import type { StudyPage } from './state';
import type { TextHit } from './text-search';

export interface ShellSource {
  app: App;
  repo: BookRepo;
  store: ReaderStore;
  /**
   * 逐章导出整本正文（建全书画像用）。
   *
   * 从阅读视图走而不是自己解析文件：分页、编码、TXT 切章这些规则都已经在
   * 引擎里了，另写一份迟早和正文对不上。没有打开的书时返回空数组。
   */
  exportChapters: (opts?: {
    onProgress?: (done: number, total: number, title: string) => void;
    shouldStop?: () => boolean;
    /** 要读的是哪一本：和当前打开的书对不上时返回空（绝不拿另一本书的正文顶上） */
    bookId?: string;
  }) => Promise<Array<{ title: string; text: string }>>;
  /** 阅读视图里现在开着的那本书（没开书时是空串） */
  openBookId: () => string;
  /** 打开一本书（带 cfi 落到那一页）；已有同书 tab 就复用 */
  openBook: (book: ReaderBook, cfi?: string) => void;
  /** 在当前打开的书里按章名跳转（AI 来源点开用）；找不到就不动 */
  goToChapter: (title: string) => void;
  /** 打开导入页（整页，S1 定稿） */
  openImport: () => void;
  /**
   * 把导入页挂进给定容器，返回拆卸函数。
   *
   * 导入是命令式的（扫描 / 勾选 / 写盘都有内部状态），做成纯 HTML
   * 要么把状态全搬进 ShellState，要么每次重绘丢一次勾选。挂载更省事，
   * 也让「导入」这套逻辑只存在一份。
   */
  mountImport: (host: HTMLElement) => () => void;
  /** 打开书架 tab（单例），可指定页。移动端是全屏弹窗 */
  openStudy: (page?: StudyPage) => void;
  /** 关掉书架。移动端是关闭全屏弹窗；桌面没有「关书架」这回事，实现为空 */
  closeStudy: () => void;
  /** 打开左侧栏并切到某页签 */
  openSidebar: (tab?: 'toc' | 'bookmarks' | 'highlights' | 'ai') => void;
  /** 从笔记库重扫一遍书 */
  syncVault: () => void;
  /**
   * 升级后第一次画到书库页时调一次：该弹更新日志就弹。
   *
   * 由书架在渲染时触发（而不是 openStudy），是因为工作区恢复时视图会自己
   * mount、不经过任何打开入口。判重与记账在插件侧，重复调用是幂等的。
   */
  maybeShowChangelog: () => void;
  /** 手动打开更新日志（关于条里的「更新日志」）：随时回看，不改「已看过」记录 */
  openChangelog: () => void;
  /** 插件版本（关于条显示，来自 manifest.json） */
  version: () => string;
  /** 当前排版偏好（引擎侧持有，改它要经过 setPrefs） */
  prefs: () => ReaderPrefs;
  /** 改排版偏好：立即重排当前打开的书 */
  setPrefs: (patch: Partial<ReaderPrefs>) => void;
  /** 插件设置（导出、AI） */
  settings: () => ReaderSettings;
  setSettings: (patch: Partial<ReaderSettings>) => void;
  /**
   * 当前这一屏的正文纯文本。
   *
   * 给 AI 问答当上下文用：整本书塞不进 token，而且用户问的通常是
   * 「刚读到的这段」。没开书 / 还没分页时返回空串，调用方要处理。
   */
  currentText: () => string;
  /**
   * 激活码：验签 → 写 entitlement（data.json）→ 重绘。
   * 书架设置页与解锁弹层都必须走它，否则会出现「显示已激活、功能锁死」。
   */
  activate: (code: string) => Promise<{ ok: boolean; message: string }>;
  /** 收藏 / 取消收藏。写进业务数据（book.favorite），换设备跟着走 */
  setFavorite: (id: string, on: boolean) => void;
  /**
   * 改一本书的分类归属。`name` 为空串 = 退回「未分类」。
   * 写进业务数据（book.shelf），换设备跟着走。
   */
  setShelf: (id: string, name: string) => void;
  /**
   * 写分类名单（顺序即书架上的顺序）。
   *
   * 名单不能从书上反推——空分类在书上什么痕迹都没有，反推的下场就是
   * 刚建完的那个分类下一次重绘消失。
   */
  setShelfList: (list: string[]) => void;
  /** 改年度目标（本）。写进业务数据（data.goal） */
  setGoal: (n: number) => void;
  /** 改每日打卡目标（分钟）。写进业务数据（data.dailyGoalMinutes） */
  setDailyGoal: (minutes: number) => void;
  /**
   * 搜当前这一本的正文，返回带 CFI 的命中（新功能「书内搜索的命中定位」）。
   * 没有打开的书时返回空数组。
   */
  searchText: (kw: string) => Promise<TextHit[]>;
  /**
   * 对任意一本书扫正文（不必先打开它）：临时开引擎、扫完即拆。
   *
   * 「本书 / 全库」里的正文搜索用它。当前已经在阅读视图里打开的书优先走
   * `searchText`——引擎已经加载好，不必重新解一遍。
   */
  searchBookBody: (book: ReaderBook, kw: string, shouldStop?: () => boolean) => Promise<TextHit[]>;
  /** 当前有没有打开着的阅读视图（正文搜索前先问一句，别让用户搜了个寂寞） */
  hasOpenReader: () => boolean;
  /**
   * 一键备份：把业务数据写成一份 JSON 放进数据目录。
   * **不含激活码与 AI Key**（见 data/backup.ts 的文件头）。
   */
  backup: () => Promise<{ ok: boolean; message: string }>;
  /** 从备份文件恢复：合并而不是替换，按 updatedAt 取新的那一份 */
  restore: () => Promise<{ ok: boolean; message: string }>;
  /** 当前数据目录（vault 相对路径，默认 `bz-reader/storage`） */
  dataDir: () => string;
  /**
   * 迁移数据目录。内部顺序是「落盘 → 复制 → 校验 → 切指针 → 重新加载 → 删旧」，
   * 任何一步失败都保持原目录不动。调用前必须先让用户确认过。
   */
  migrateDataDir: (dir: string) => Promise<{ ok: boolean; message: string }>;
  /**
   * 迁移三个位置之一。export / import 走 Obsidian 的 `fileManager.renameFile`：
   * 库内链接会被宿主一起改写，不会因为我们搬了文件就断。data 走
   * `migrateDataDir` 那条「复制 → 校验 → 切指针 → 删旧」。调用前必须让用户确认过。
   */
  migrateDir: (
    kind: 'export' | 'import' | 'data',
    from: string,
    to: string,
  ) => Promise<{ ok: boolean; message: string }>;
}

let source: ShellSource | null = null;
const listeners = new Set<() => void>();

/** 注入（传 null 卸载：插件禁用后视图还活着时不至于拿到半个能力包） */
export function setShellSource(next: ShellSource | null): void {
  source = next;
  emit();
}

export function getShellSource(): ShellSource | null {
  return source;
}

export function subscribeShellSource(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* 单个订阅者出错不连累其余 */
    }
  }
}

/* ─────────── 便捷读取（找不到源时给安全默认值） ─────────── */

export function shellPrefs(): ReaderPrefs {
  /* 走注入的 prefs()：它会按当前平台选 prefsDesktop / prefsMobile。
     直接读 store.get().prefs 会永远拿到迁移前那一份。 */
  if (source) return source.prefs();
  return normalizePrefs(undefined);
}

export function shellSettings(): ReaderSettings {
  // 设置现在住在 data.json，由插件持有；store 里那份是老版本的残留
  return source?.settings() ?? normalizeSettings(null);
}

export function allBooks(): ReaderBook[] {
  return source?.repo.all() ?? [];
}

/**
 * 书架上的书：归档（移出书架）的不算，**失联的算**。
 *
 * 失联书留在架子上、封面压暗带角标，点它进「重新定位」——这才是用户
 * 能处理的状态。以前这里把失联的过滤掉，用户以为书被插件删了。
 */
export function liveBooks(): ReaderBook[] {
  return allBooks().filter((b) => !b.archivedAt);
}

export function bookById(id: string): ReaderBook | undefined {
  return source?.repo.byId(id);
}

/** 任何写入之后：落盘 + 通知所有壳层视图重绘 */
export function commit(): void {
  source?.store.touch();
}
