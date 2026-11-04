/* ============================================================
 * bz-reader · 插件目录与数据根（core/plugin-path.ts）
 *
 * 插件目录名由用户决定（`bz-reader` / `bz 阅读` / `bz-reader (1)` 都可能）。
 * 写死 `plugins/bz-reader` 的后果不是报错，是静默错位：文件写进一个不该写的
 * 目录，表现出来是「设置存了但下次打开又变回去」——最难查的那类。
 *
 * 来源优先级：onload 注入的真实目录 → app.plugins.manifests 记录 → configDir 兜底。
 * ============================================================ */
import type { App } from 'obsidian';

const PLUGIN_ID = 'bz-reader';

let injectedRelDir = '';

export function setPluginRelDir(rel: string | null | undefined): void {
  injectedRelDir = String(rel || '').replace(/^[\\/]+|[\\/]+$/g, '');
}

function trim(p: string): string {
  return String(p || '').replace(/^[\\/]+|[\\/]+$/g, '');
}

/** 插件目录的 vault 相对路径（如 `.obsidian/plugins/bz-reader`） */
export function pluginRelDirOf(app: App): string {
  if (injectedRelDir) return injectedRelDir;
  const fromManifests = trim(
    (app as unknown as { plugins?: { manifests?: Record<string, { dir?: string }> } })
      ?.plugins?.manifests?.[PLUGIN_ID]?.dir || '',
  );
  if (fromManifests) return fromManifests;
  const configDir = trim(
    (app as unknown as { vault?: { configDir?: string } })?.vault?.configDir || '.obsidian',
  );
  return `${configDir || '.obsidian'}/plugins/${PLUGIN_ID}`;
}

/** 插件目录内的文件，vault 相对路径 */
export function pluginVaultPath(app: App, rel: string): string {
  return `${pluginRelDirOf(app)}/${trim(rel)}`;
}

/* ─────────── 数据根（用户可改） ───────────
 * 库根只放一个容器 `bz-reader/`，里面三份东西各占一个子目录：
 *   storage/  插件私有数据（bz-reader.json + covers/）
 *   books/    用户导入的书
 *   notes/    导出的书摘
 * 分开是因为归属不同：`storage` 删了只是丢进度，`books` 删了是丢用户的藏书，
 * `notes` 删了是丢笔记。混在一起会让人以为删掉整棵目录的代价是一样的。
 *
 * 为什么不再塞进 `.obsidian/plugins/bz-reader/storage`：
 *   1. 用户备份库的时候，.obsidian 里那块很多同步方案默认跳过；
 *   2. 换插件版本 / 重装插件时，那块目录容易被一起清掉；
 *   3. 用户根本看不见自己的书摘数据在哪，出了问题没法自救。
 *
 * 为什么是 `bz-reader` 而不是 `bz 阅读`：空格在同步工具、命令行、URL 编码上
 * 反复翻车；而且它要和插件 id、仓库名、`.obsidian/plugins/bz-reader` 对齐。
 *
 * 目录指针存 localStorage 而不是存 JSON 本身——这是个先有鸡还是先有蛋的
 * 问题：不知道目录就读不到写着目录的那个文件。JSON 里那份只是镜像。
 */

/** 默认数据目录：库根 `bz-reader/storage` */
export const DEFAULT_DATA_DIR = 'bz-reader/storage';

const LS_DATA_DIR = 'bzs-data-dir-v1';

let dataDirCache: string | null = null;

/** 收口径：反斜杠转正斜杠、去首尾斜杠、拒绝上跳与配置目录 */
export function normalizeDataDir(v: string | null | undefined): string {
  const s = String(v || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  if (!s) return DEFAULT_DATA_DIR;
  const segs = s.split('/').filter(Boolean);
  // `..` 会指到库外，`.` 开头的目录（.obsidian / .trash）不该被当数据目录
  if (segs.some((x) => x === '..' || x.startsWith('.'))) return DEFAULT_DATA_DIR;
  return segs.join('/');
}

/** 当前数据目录（vault 相对路径，无首尾斜杠） */
export function dataDirOf(): string {
  if (dataDirCache) return dataDirCache;
  let raw = '';
  try {
    raw = window.localStorage.getItem(LS_DATA_DIR) || '';
  } catch {
    /* 读不到就用默认值 */
  }
  dataDirCache = normalizeDataDir(raw);
  return dataDirCache;
}

/** 改数据目录并记住。调用方负责先把文件搬过去。 */
export function setDataDir(dir: string): string {
  const next = normalizeDataDir(dir);
  dataDirCache = next;
  try {
    window.localStorage.setItem(LS_DATA_DIR, next);
  } catch {
    /* 存不下不影响本次会话 */
  }
  return next;
}

/** 数据根：用户指定目录（默认 `bz-reader/storage`），书架 JSON 与封面都在里面 */
export function storageDirOf(_app?: App): string {
  return dataDirOf();
}

/**
 * 调试入口：`<数据目录>/debug-open.json`，写一次启动时读一次然后删掉。
 *
 * 以前它在 `<插件目录>/storage/` 下——重装插件时跟着一起没了，而且
 * 插件目录应该是只读的（里面只有 Obsidian 自己的 main.js / manifest.json /
 * data.json）。既然它是「下次启动做什么」的指令，就该和业务数据住一起。
 */
export function debugOpenPath(_app?: App): string {
  return `${storageDirOf(_app)}/debug-open.json`;
}

export { PLUGIN_ID };
