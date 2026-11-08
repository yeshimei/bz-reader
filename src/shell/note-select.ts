/* ============================================================
 * bz-reader · 标注多选（shell/note-select.ts）
 *
 * 笔记页的批量操作需要一份「选中了哪些」的纯逻辑：勾选、全选 / 取消全选、
 * 判断是否已全选。抽出来是为了能直接测——这些判断错了会表现为
 * 「点全选只选了一半」「取消全选把看不见的也清了」，都是难复现的界面 bug。
 *
 * 不变量：返回的数组永远去重，且顺序保持「先选的在前」。
 * ============================================================ */

/** 勾上 / 取消一条，返回新数组（不改入参） */
export function togglePick(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/**
 * 全选 / 取消全选**当前可见的这批**。
 *
 * 只处理 `ids`：筛选条切到「有想法」时点全选，不该把看不见的划线也选上；
 * 同理取消时只从选中里移除这批，其它筛选下选的仍然保留。
 *
 * 用 Set 做判重与包含判断（D5）：500 条标注时，「已全选」判一次就是
 * 25 万次 `includes`，点一下全选要顿一帧。
 */
export function toggleAll(selected: string[], ids: string[]): string[] {
  const visible = [...new Set(ids)];
  if (!visible.length) return selected;
  const chosen = new Set(selected);
  if (visible.every((id) => chosen.has(id))) {
    const drop = new Set(visible);
    return selected.filter((id) => !drop.has(id));
  }
  return [...new Set([...selected, ...visible])];
}

/** 当前可见的是否已经全部选中（空列表不算） */
export function allPicked(selected: string[], ids: string[]): boolean {
  if (!ids.length) return false;
  const chosen = new Set(selected);
  return ids.every((id) => chosen.has(id));
}
