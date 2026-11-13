/**
 * 一本剪藏本同一时刻只能有一个「计时 + 轮询」的主人。
 *
 * Obsidian 允许把同一个 tab 拖到新窗口（或分屏再开一本）：两个视图各跑一个
 * 20 秒轮询和一份计时器，同一章的秒数会被两边各加一遍，阅读时长静默翻倍，
 * 两边页码也各走各的（真机量到 135→150 与 15→30 同时发生）。
 *
 * 后打开的那个视图接管；前一个视图收到通知后停表、停轮询，但底条与正文
 * 照常显示（它仍然是一本可读的书）。
 */
export class ClipOwnerRegistry<T> {
  private owners = new Map<string, T>();

  /** 认领这本书；返回需要让位的上一个主人（没有 / 就是自己 → null） */
  claim(bookId: string, owner: T): T | null {
    if (!bookId) return null;
    const prev = this.owners.get(bookId) ?? null;
    this.owners.set(bookId, owner);
    return prev && prev !== owner ? prev : null;
  }

  /** 关书时释放；不是当前主人就什么都不做 */
  release(bookId: string, owner: T): void {
    if (this.owners.get(bookId) === owner) this.owners.delete(bookId);
  }

  ownerOf(bookId: string): T | null {
    return this.owners.get(bookId) ?? null;
  }
}
