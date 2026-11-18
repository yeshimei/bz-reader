/* ============================================================
 * bz-reader · 收起侧栏容器（shell/drawer-collapse.ts）
 *
 * 从侧栏 leaf 往上找「能收起来的那个容器」，直接收它。
 *
 * 为什么要往上找，而不是像老代码那样 `closest('.mod-right-split')` 猜左右：
 * 移动端 Obsidian 的抽屉是 WorkspaceMobileDrawer，跟桌面的 WorkspaceSidedock
 * 是两套对象；抽屉 DOM 上的 mod-left/right-split 类并不可靠，猜错边就收错，
 * 结果是「点目录跳得动，侧栏却关不掉」。从 leaf 自己的 parent 链找，天然
 * 知道它在哪一侧，移动端 / 桌面都用同一套逻辑。
 *
 * 两者都满足鸭子类型 `collapsed: boolean` + `collapse()`，所以这里不 import
 * obsidian 的具体类——纯函数，可在 node 里直接测。
 * ============================================================ */

/** 能收起的容器：WorkspaceMobileDrawer / WorkspaceSidedock 的共同形状 */
export interface CollapsiblePanel {
  collapsed: boolean;
  collapse(): void;
}

function isCollapsible(v: unknown): v is CollapsiblePanel {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.collapsed === 'boolean' && typeof o.collapse === 'function';
}

/**
 * 从 leaf 沿 parent 链往上，找第一个可收起的容器；找不到返回 null。
 *
 * parent 成环时（异常宿主状态）用 visited 挡住，返回 null 而不是死循环。
 */
export function findCollapsibleAncestor(leaf: unknown): CollapsiblePanel | null {
  const visited = new Set<unknown>();
  let cur: unknown = (leaf as { parent?: unknown } | null | undefined)?.parent;
  while (cur && !visited.has(cur)) {
    if (isCollapsible(cur)) return cur;
    visited.add(cur);
    cur = (cur as { parent?: unknown }).parent;
  }
  return null;
}
