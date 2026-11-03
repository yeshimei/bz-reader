/* ============================================================
 * bz-reader · 封面回填（shell/covers.ts）
 *
 * 封面是异步的（要解 epub 的 zip），而书架是同步 innerHTML 渲染的。
 * 两个节奏对不上，所以分两步走：先画哈希色块占位，拿到真封面再就地
 * 把这一块换成 <img>——**不走重绘**，否则滚动位置和焦点每来一张图就跳一次。
 *
 * 以前这条路是断的：data/cover.ts 写好了三层缓存，但没人调它，书架读的是
 * meta.coverPath（全仓没有写入点），于是封面墙 100% 是色块。
 * 这个文件就是把两头接上。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { coverUrl } from '../data/cover';

/**
 * 把 root 里所有带 data-cid 的封面占位换成真封面。
 *
 * 只认当前还挂在 DOM 上的节点：填图期间用户可能已经翻页/关掉书架，
 * 那时 node.isConnected 为 false，写进去也没人看见。
 */
export function hydrateCovers(app: App | null | undefined, books: ReaderBook[], root: ParentNode | null): void {
  if (!app || !root) return;
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-cid]'));
  if (!nodes.length) return;

  const byId = new Map<string, ReaderBook>();
  for (const b of books) byId.set(b.id, b);

  for (const node of nodes) {
    const id = node.dataset.cid;
    if (!id || node.dataset.cover === '1') continue;
    const book = byId.get(id);
    if (!book) continue;
    void coverUrl(app, book).then((url) => {
      // 拿不到封面就留着色块——色块比一张破图体面
      if (!url || !node.isConnected) return;
      node.dataset.cover = '1';
      node.innerHTML = `<img class="bzs-covimg" src="${url}" alt="${node.dataset.title ?? ''}" loading="lazy">`;
    });
  }
}
