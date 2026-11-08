/* ============================================================
 * bz-reader · 点按翻页前的那道闸（engine/tap-gate.ts）
 *
 * 手指在正文上抬手会被当成一次点按（翻页）。但在正文里还留着一段选中的字时，
 * 这一下点按显然是「在看选中的内容」或者「想把选中收起」，不该翻页。
 *
 * 这里只回答「有没有选中的字」，**一个字都不动**。
 * 2026-11-08 安卓反馈「选中，闪一下就没了」：当时这段判断顺手调了
 * `removeAllRanges()`，而长按选字抬手正好会被判成一次点按，于是刚选中的字
 * 当场消失、工具条也跟着收起。选区的收起是浏览器原生行为（点空白处自己收），
 * 不需要我们代劳；代劳的结果就是把用户刚做的选择毁掉。
 * ============================================================ */

/** 只取这里用得到的部分，测试可以喂一个替身进来 */
interface DocWithSelection {
  getSelection?: () => { isCollapsed?: boolean } | null;
}

/**
 * 正文里是否还留着一段选中的字。
 *
 * 拿不到文档或选区时按「没有选区」处理：宁可翻一页，也不要让正文卡在
 * 一个点不动的状态上。
 */
export function hasLiveSelection(doc: DocWithSelection | null | undefined): boolean {
  const sel = doc?.getSelection?.() ?? null;
  return !!sel && sel.isCollapsed === false;
}
