/* ============================================================
 * bz-reader · 插件配置文件（data/plugin-data.ts）
 *
 * `.obsidian/plugins/bz-reader/data.json`，走 Obsidian 原生的
 * `Plugin.loadData()` / `Plugin.saveData()`。只存三样：
 *
 *   settings     插件怎么工作（导出目录、导入目录、AI 地址与 Key）
 *   entitlement  激活码 + 活跃日（形状由 data/entitlement.ts 解释）
 *   dataDir      数据目录指针（业务 JSON 在哪）
 *
 * **为什么不跟业务数据放一起**（2026-11-04 改）：
 *   1. 激活码跟着库同步 = 一份授权无限复制。README 承诺「换电脑重新填
 *      一次激活码」，码就不能进随库走的那份 JSON。
 *   2. AI Key 是设备凭据。用户把 `bz 阅读/bz-reader.json` 发给别人看
 *      划线时，不该顺手把自己的 API Key 也发出去。
 *   3. localStorage 会被清（清缓存、重装、iOS 回收存储），付费用户
 *      某天打开发现变回基础版。文件不会被浏览器回收。
 *
 * 反过来，业务数据（书架 / 进度 / 标注 / 收藏 / 分组 / 目标）一律不写
 * 这里：那份数据要随库同步、要能被用户直接备份和阅读。
 * ============================================================ */
import { DEFAULT_DATA_DIR, normalizeDataDir } from '../core/plugin-path';
import { DEFAULT_SETTINGS, normalizeSettings, type ReaderSettings } from './settings';

export interface PluginDataFile {
  version: 1;
  settings: ReaderSettings;
  /** entitlement 的原始快照。这里不解释形状，免得和 entitlement.ts 互相依赖 */
  entitlement: unknown;
  /** 业务数据目录（vault 相对路径，无首尾斜杠） */
  dataDir: string;
}

export const EMPTY_PLUGIN_DATA: PluginDataFile = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  entitlement: null,
  dataDir: DEFAULT_DATA_DIR,
};

/**
 * 收口径：手改坏的 JSON、旧版本残留、`null`，一律夹回可用值。
 *
 * 不能直接 `raw as PluginDataFile`——`settings` 少一个字段，设置页读
 * `s.ai.baseUrl` 就是 TypeError，整页白屏；`dataDir` 是 `undefined` 时
 * `normalizeDataDir` 会把它当默认值，反而把用户设的目录悄悄改回去。
 */
export function normalizePluginData(raw: unknown): PluginDataFile {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<PluginDataFile>;
  return {
    version: 1,
    settings: normalizeSettings(d.settings),
    entitlement: d.entitlement ?? null,
    dataDir: normalizeDataDir(typeof d.dataDir === 'string' ? d.dataDir : ''),
  };
}
