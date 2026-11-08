/* ============================================================
 * bz-reader · 开发构建的授权档位覆盖（core/dev-tier.ts）
 *
 * 只给测试库用：命令面板里一键在基础版 / 高级版之间来回切，
 * 方便看两套界面。**不动真实激活码**——覆盖只改 entitlement()
 * 的结论，data.json 里那枚码原样躺着，清掉覆盖就回到真实判定。
 *
 * 构建期 __BZ_DEV__ 为 false 时，entitlement.ts 里引用这段的分支
 * 会被 esbuild 当死代码删掉，整个模块不进发布包。
 * ============================================================ */
import type { Tier } from '../data/entitlement';

export interface DevTierIO {
  /** 读持久化的覆盖值（data.json 的 devTier 字段） */
  read(): unknown;
  /** 写回覆盖值。宿主负责落盘 */
  write(raw: unknown): void;
}

let enabled = false;
let current: Tier | null = null;
let io: DevTierIO | null = null;

/** 只认 free / paid；坏数据（手改、旧版本）一律当没设置 */
function normalize(raw: unknown): Tier | null {
  return raw === 'free' || raw === 'paid' ? raw : null;
}

/**
 * 由 plugin.onload 注入，只有开发构建会调用。
 * 传 null 关闭覆盖（测试收尾与禁用插件时用）。
 */
export function initDevTier(next: DevTierIO | null): void {
  io = next;
  enabled = !!next;
  current = next ? normalize(next.read()) : null;
}

/** 当前覆盖档位；没启用 / 没覆盖时为 null */
export function devTierOverride(): Tier | null {
  return enabled ? current : null;
}

/** 切换覆盖并落盘。传 null 等于恢复真实授权 */
export function setDevTier(tier: Tier | null): void {
  if (!enabled) return;
  current = tier;
  io?.write(tier);
}

/** 恢复真实授权：清掉覆盖，回到激活码的判定 */
export function resetDevTier(): void {
  if (!enabled) return;
  current = null;
  io?.write(null);
}
