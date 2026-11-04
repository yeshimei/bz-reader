/* ============================================================
 * bz-reader · 关书时的视图拆卸兜底（engine/view-teardown.ts）
 *
 * `view.close()` 内部是一条链：`renderer.destroy()` → `renderer.remove()` →
 * 清进度 / 搜索 / 历史。第一环抛错，后面全不执行：
 *   · `renderer.sections` 还钉着整本书（几百章的 DOM / 文本引用）；
 *   · 分页器的 `#mediaQuery` change 监听没摘，全局对象一直握着 renderer。
 *
 * 宿主不能只 `catch {}` 就把 view 丢掉——那样泄漏是静默的。这里补一条
 * 兜底：清空 sections，再单独调一次 `renderer.destroy()`（它自己是幂等的：
 * `unobserve` / `removeEventListener` 重复调用无害）。任何一步再抛都吞掉，
 * 关书流程不能因为「收尾失败」卡住。
 * ============================================================ */
import type { FoliateView } from '../types/foliate';

/** close 之后仍要手动断掉的渲染器面（只声明这里用到的） */
interface DetachableRenderer {
  sections?: unknown;
  destroy?: () => void;
}

/**
 * 关掉一个 foliate-view，并保证「半路失败」时也把重引用断掉。
 *
 * 成功路径保持上游行为，什么也不多做（close 自己已经 destroy 过 renderer）。
 */
export function teardownView(view: FoliateView | null | undefined): void {
  if (!view) return;

  try {
    view.close();
    return;
  } catch {
    /* 下面兜底：close 抛错时它内部的 destroy/remove 未必跑完 */
  }

  const renderer = view.renderer as unknown as DetachableRenderer | null | undefined;
  if (!renderer) return;

  /* 先清 sections 再 destroy：分页器 destroy 末尾会读 `sections[index].unload`，
     sections 为 null 时那一行自己会抛，mediaQuery 监听又摘不掉。 */
  try {
    renderer.sections = [];
  } catch {
    /* 只读属性就算了，至少再试一次 destroy */
  }
  try {
    renderer.destroy?.();
  } catch {
    /* 兜底的兜底：收尾失败不该拦住关书 */
  }
}
