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
import { coverPathOf, coverUrl } from '../data/cover';
import { esc } from './render/html';
import { getShellSource } from './source';

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
      /* 回填 meta.coverPath：数据文件不只给插件自己看（bz 书库也在读），
         没有这一条，外部只能看到一片色块。只在值真的变了时 touch，
         免得每次开书架都写一次盘。 */
      const path = coverPathOf(book.id);
      if (path && book.meta.coverPath !== path) {
        book.meta.coverPath = path;
        getShellSource()?.store.touch();
      }
      node.dataset.cover = '1';
      /* dataset.title 是浏览器**解码后**的原始书名（写入时虽然 esc 过，读回来
         已经还原），这里重拼 innerHTML 必须再转义一次：书名里一个引号就能
         闭合属性，书名来自导入的 EPUB，属不可信输入。 */
      node.innerHTML = `<img class="bzs-covimg" src="${esc(url)}" alt="${esc(node.dataset.title ?? '')}" loading="lazy">`;
    });
  }
}
