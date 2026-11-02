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

/** 数据根：`<插件目录>/storage/`（ADR-0270 口径，不占 CONFIG/STORAGE） */
export function storageDirOf(app: App): string {
  return pluginVaultPath(app, 'storage');
}

export { PLUGIN_ID };
