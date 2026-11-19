/* ============================================================
 * PDF 失败页标记的重置（src/engine/pdf/retry-failed.ts）
 *
 * 缩放 / 旋转会让旧尺寸的渲染结论作废：失败过的页必须重新入队，否则
 * enqueue 的 failed.has() 会永久跳过它——旋转后空壳页没画布也没提示，
 * 缩放后旧错误提示一直挂着。返回被清掉的页号，供调用方抹掉页元素上
 * 的错误提示。
 *
 * 抽成纯函数是为了能在 node 里断言这段状态收口，不必起真 PDF 渲染。
 * ============================================================ */

/** 清空失败页集合，返回清空前的页号（调用方据此清 DOM 提示）。 */
export function resetFailedPages(failed: Set<number>): number[] {
  const pages = [...failed];
  failed.clear();
  return pages;
}
