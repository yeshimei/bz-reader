import { describe, expect, it } from 'vitest';
import { findCollapsibleAncestor } from '../src/shell/drawer-collapse';

/**
 * 从侧栏 leaf 往上找到「能收起来的那个容器」。
 *
 * 移动端是 WorkspaceMobileDrawer，桌面是 WorkspaceSidedock，两者都有
 * `collapsed: boolean` + `collapse()`。从 leaf 自己的 parent 链找，天然
 * 知道它在哪一侧，不用像老代码那样靠 `closest('.mod-right-split')` 猜左右
 * ——那套猜测在移动端抽屉 DOM 上不可靠，正是「跳得动却关不掉」的根因。
 */
function drawer(): { collapsed: boolean; collapse: () => void } {
  return { collapsed: false, collapse: () => undefined };
}

function parentOf(child: unknown, parent: unknown): void {
  (child as { parent?: unknown }).parent = parent;
}

describe('findCollapsibleAncestor', () => {
  it('移动端：leaf → tabs → 抽屉，找到抽屉', () => {
    const tabGroup = {};
    const d = drawer();
    parentOf(tabGroup, d);
    const leaf = {};
    parentOf(leaf, tabGroup);
    expect(findCollapsibleAncestor(leaf)).toBe(d);
  });

  it('桌面：leaf → tabs → sidedock，找到 sidedock', () => {
    const tabGroup = {};
    const dock = drawer();
    parentOf(tabGroup, dock);
    const leaf = {};
    parentOf(leaf, tabGroup);
    expect(findCollapsibleAncestor(leaf)).toBe(dock);
  });

  it('leaf 直接在抽屉里（没有 tabs 层）也能找到', () => {
    const d = drawer();
    const leaf = {};
    parentOf(leaf, d);
    expect(findCollapsibleAncestor(leaf)).toBe(d);
  });

  it('parent 链上没有可收容器：返回 null', () => {
    const root = {};
    const tabGroup = {};
    parentOf(tabGroup, root);
    const leaf = {};
    parentOf(leaf, tabGroup);
    expect(findCollapsibleAncestor(leaf)).toBeNull();
  });

  it('leaf 为空 / 没有 parent：返回 null', () => {
    expect(findCollapsibleAncestor(null)).toBeNull();
    expect(findCollapsibleAncestor(undefined)).toBeNull();
    expect(findCollapsibleAncestor({})).toBeNull();
  });

  it('parent 成环时不死循环，返回 null', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    parentOf(a, b);
    parentOf(b, a);
    const leaf = {};
    parentOf(leaf, a);
    expect(findCollapsibleAncestor(leaf)).toBeNull();
  });

  it('只认 collapsed 布尔 + collapse 方法都有的对象，半个属性不算', () => {
    const half = { collapsed: false }; // 缺 collapse
    const leaf = {};
    parentOf(leaf, half);
    expect(findCollapsibleAncestor(leaf)).toBeNull();
  });

  it('节点脱离 DOM 后仍能从 parent 链找到容器（真机跳转会重绘，DOM closest 会失效）', () => {
    // 真机根因：jumpTo 触发侧栏重绘，旧的 el 脱离 document，
    // el.closest('.bzs-shell.is-side') 判不出来源；但 leaf 的 parent 链还在。
    // 这也是为什么关闭走 parent 链、而 fromSidebar 判定要提前到跳转前做。
    const d = drawer();
    const tabGroup = {};
    parentOf(tabGroup, d);
    const leaf = {};
    parentOf(leaf, tabGroup);
    // 模拟「脱离 DOM」：没有任何祖先 DOM 节点，只有 parent 对象链
    expect(findCollapsibleAncestor(leaf)).toBe(d);
  });
});
