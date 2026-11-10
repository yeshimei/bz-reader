/* ============================================================
 * bz-reader · 跳转历史（core/nav-history.ts）
 *
 * 「回到上一处」这条栈：点目录、点书签、点正文链接跳走之前记一手，
 * 翻页与滚动**不**记——否则一路翻过去，回退要按十几次。
 *
 * 为什么抽成纯函数：
 *   · PDF 早就有这段逻辑（`engine/pdf/view.ts` 的 recordHistory），EPUB 要补
 *     一条一模一样的规则；两份各写一遍，迟早会一边记「翻页」一边不记；
 *   · 栈的边界（去重、上限、空定位串）是纯数据规则，node 里能直接测。
 *
 * 为什么放在 core 而不是 view：engine 的两个宿主都要用它，而 engine 不该
 * 反过来依赖 view（那是上层）。
 *
 * 定位串对两个引擎是两种写法：EPUB 是 `epubcfi(/6/8!/4/2)`，PDF 是
 * `pdf/<页>/<起>-<止>`。这里只当不透明字符串存，不认识内容。
 * ============================================================ */

export interface NavSpot {
  /** 引擎定位串。EPUB 是 CFI，PDF 是 pdf/<页> */
  cfi: string;
  /** 跳走时所在的章节名，提示里能说「回到第 3 章」；拿不到就留空 */
  label?: string;
}

/**
 * 最多留这么多处。
 *
 * 50 是 PDF 那边一直在用的数：再久以前的「上一处」用户自己也记不住，
 * 而每条都要在头栏悬停提示里报个数。
 */
export const NAV_HISTORY_LIMIT = 50;

export class NavHistory {
  private stack: NavSpot[] = [];

  constructor(private readonly limit: number = NAV_HISTORY_LIMIT) {}

  get size(): number {
    return this.stack.length;
  }

  get canBack(): boolean {
    return this.stack.length > 0;
  }

  /** 栈顶那处（不弹出）。重挂头栏时只看一眼亮不亮用得上 */
  peek(): NavSpot | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /**
   * 记一处。返回是否真的入栈。
   *
   * 两种不入栈：定位串为空（引擎还没准备好的时候会报空串），以及与栈顶同一处
   * （重绘 / 进度条会连着报同一个位置）。
   */
  push(spot: NavSpot | null | undefined): boolean {
    const cfi = String(spot?.cfi ?? '').trim();
    if (!cfi) return false;
    if (this.peek()?.cfi === cfi) return false;
    this.stack.push({ cfi, label: spot?.label || undefined });
    if (this.stack.length > this.limit) this.stack.splice(0, this.stack.length - this.limit);
    return true;
  }

  /** 取出最近一处；没有则返回 null */
  pop(): NavSpot | null {
    return this.stack.pop() ?? null;
  }

  /** 换书时清空：上一本的定位串不能拿来跳这一本 */
  clear(): void {
    this.stack = [];
  }
}
