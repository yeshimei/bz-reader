/* ============================================================
 * bz-reader · 开发构建：强制基础版（core/dev-tier.ts）
 *
 * 只给测试库用：命令面板留一条「切换为基础版」，把界面压到基础版。
 * **刻意没有反向入口**——切高级版与恢复真实授权都已删掉，这条开发
 * 路径不可能变成绕过付费的后门。
 *
 * 覆盖不碰 data.json 里的真实激活码，只改 entitlement() 的结论；
 * 构建期 __BZ_DEV__ 为 false 时，entitlement.ts 里引用这段的分支
 * 会被 esbuild 当死代码删掉，整个模块不进发布包。
 * ============================================================ */

export interface DevTierIO {
  /** 读持久化的覆盖值（data.json 的 devTier 字段） */
  read(): unknown;
  /** 写回覆盖值。宿主负责落盘 */
  write(raw: unknown): void;
}

let enabled = false;
let forced = false;
let io: DevTierIO | null = null;

/** 只认 'free'；旧版本留下的 'paid'、手改坏的 JSON 一律当没设置 */
function normalize(raw: unknown): boolean {
  return raw === 'free';
}

/**
 * 由 plugin.onload 注入，只有开发构建会调用。
 * 传 null 关闭覆盖（测试收尾与禁用插件时用）。
 */
export function initDevTier(next: DevTierIO | null): void {
  io = next;
  enabled = !!next;
  forced = next ? normalize(next.read()) : false;
}

/** 是否正在强制基础版 */
export function devTierForced(): boolean {
  return enabled && forced;
}

/**
 * 把界面压到基础版。
 *
 * 返回 true = 这一次真的切了；false = 已经是基础版，或开发构建没启用。
 * **没有反向函数**：这里只往下切，切不回去——想回高级版只能填真实激活码。
 */
export function forceBaseTier(): boolean {
  if (!enabled || forced) return false;
  forced = true;
  io?.write('free');
  return true;
}
