/* ============================================================
 * bz-reader · 开发构建：退回基础版（core/dev-tier.ts）
 *
 * 只给测试库用：命令面板留一条「切换为基础版」。
 *
 * 2026-11-12 改：以前这里只把 entitlement() 的结论压成 free（另存一个
 * `devTier: 'free'` 覆盖），激活码原样留在 data.json 里。结果是切完之后
 * 再填高级版码也永远显示基础版——覆盖没人解，用户以为码失效。现在这条
 * 命令改成**真降级**：清掉真实激活码，基础版就是基础版；重新填码由
 * entitlement 正常判定，立刻回到高级版。
 *
 * 因此也没有任何「切到高级版」的入口——这里唯一的动作是丢弃授权，
 * 不可能变成绕过付费的后门。构建期 __BZ_DEV__ 为 false 时，plugin.ts
 * 里注册命令的那一块会被 esbuild 当死代码删掉：发布包里没有这条命令，
 * 这里两个函数也没有任何调用点（esbuild 可能留下函数体，但不会执行）。
 * ============================================================ */

export interface DevTierIO {
  /** 清掉真实激活码（data.json 的 entitlement 快照 + localStorage 镜像）；返回清之前有没有码 */
  dropLicense(): boolean;
}

let io: DevTierIO | null = null;

/**
 * 由 plugin.onload 注入，只有开发构建会调用。
 * 传 null 关闭（测试收尾与禁用插件时用）。
 */
export function initDevTier(next: DevTierIO | null): void {
  io = next;
}

/**
 * 真正退回基础版：清掉激活码。
 *
 * 返回 true = 这次确实清掉了一枚码（真降级）；
 * false = 本来就是基础版，或开发构建没启用。
 * 重新激活码不需要反向函数：`activateLicense` 验签通过即恢复高级版。
 */
export function forceBaseTier(): boolean {
  if (!io) return false;
  return io.dropLicense();
}
