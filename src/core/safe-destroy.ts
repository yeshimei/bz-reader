/* ============================================================
 * bz-reader · 关引擎时别把收尾流程带崩（core/safe-destroy.ts）
 *
 * `EngineHost.destroy()` 会拆 iframe、摘 ResizeObserver、取消导航队列。
 * 书已经半死不活时它自己也可能 reject（iframe 被宿主先一步拿走、文档已卸载）。
 *
 * 两个必须吞掉失败的地方：
 *   · 并排对照装载失败：副卷 mount 抛了，但 host2 可能已经建了 iframe。
 *     先销毁再清引用；destroy 再抛也不能把主卷的清理卡住（A-28）。
 *   · 关书收尾：closeParallel 失败后 settle() 仍然必须跑，否则这一段阅读
 *     时长与打卡永远不落盘（A-29）。
 * ============================================================ */

interface Destroyable {
  destroy(): Promise<void>;
}

/** 调用 destroy 并吞掉失败；返回的 Promise 永远 resolve */
export async function destroyQuietly(host: Destroyable | null | undefined): Promise<void> {
  try {
    await host?.destroy();
  } catch {
    /* 引擎已经没了 / 页面正在卸载：收尾流程继续 */
  }
}
