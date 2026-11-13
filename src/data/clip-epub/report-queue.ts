/**
 * 剪藏本：阅读时长上报队列（纯逻辑，node 可测）。
 *
 * 阅读器按章计时，切章时把这一篇新增的秒数交给这里。不能每拍都往 bz 写盘
 * （15 秒一拍，读一小时就是 240 次读改写），所以先攒着，由调用方按节流窗口
 * 一次发走；关书 / 切走时再补发一次，保证最后一段不丢。
 *
 * 同一篇在窗口内被切进切出好几次是常态（翻过去又翻回来），必须合并——
 * 否则 bz 那边同一篇会收到一串碎条目。
 */
import type { ClipReadEntry } from '../clipbook-bridge';

function normKey(key: unknown): string {
  return String(key ?? '').trim();
}

export class ClipReportQueue {
  /** 入队顺序 = 首次出现顺序（Map 保序），上报时按这个顺序发 */
  private pending = new Map<string, ClipReadEntry>();

  get size(): number {
    return this.pending.size;
  }

  get isEmpty(): boolean {
    return this.pending.size === 0;
  }

  /** 攒一段秒数；空 key 或非正秒数直接忽略（不产生垃圾上报） */
  add(entry: Partial<ClipReadEntry> | null | undefined): void {
    const key = normKey(entry?.key);
    const seconds = Math.floor(Number(entry?.seconds) || 0);
    if (!key || seconds <= 0) return;
    const prev = this.pending.get(key);
    if (prev) {
      prev.seconds += seconds;
      /* 标题 / 来源取到过就不覆盖：剪藏本刷新后同一篇的 sourceName 可能变空 */
      if (!prev.title) prev.title = String(entry?.title ?? '').trim();
      if (!prev.src) prev.src = String(entry?.src ?? '').trim();
      return;
    }
    this.pending.set(key, {
      key,
      seconds,
      title: String(entry?.title ?? '').trim(),
      src: String(entry?.src ?? '').trim(),
    });
  }

  /** 取走全部（清空）；没有内容时给空数组 */
  take(): ClipReadEntry[] {
    if (!this.pending.size) return [];
    const out = [...this.pending.values()];
    this.pending.clear();
    return out;
  }
}
