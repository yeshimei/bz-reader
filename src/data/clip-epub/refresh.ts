/**
 * 剪藏本「实时刷新」的判定（纯函数，node 可测）。
 *
 * 刷新分两种，代价差很多：
 *   · 结构没变（只是已读/已剪藏这类状态变了）→ 就地改状态，**不重排全书**。
 *     以前一律重建：标一篇已读就整本重排，同一处内容页码从 196/552 跳到
 *     691/1587，读者正在读的那页还会被顶走。
 *   · 结构变了（增删文章、改标题、换顺序）→ 换一本新书，按 key/URL 回到原处。
 *
 * 还有一个真实的坑：一篇文章「存为剪藏」后 key 会从 `url:…` 变成
 * `clip:…`，按 key 找不到就退回百分比，位置被挪到相邻一篇。URL 是同一篇
 * 更稳的身份证——先按 key，认不到再按 URL 认。
 */
import type { ClipBookHandle } from '../../engine/clipbook';
import type { ClipBookSnapshot } from '../clip-book';

/** 目录结构指纹：章节 key 顺序 + 标题（状态不参与）。 */
export function clipStructureKey(snap: ClipBookSnapshot | null | undefined): string {
  if (!snap) return '';
  return snap.chapters.map((c) => `${c.key}\u0000${c.title}`).join('\u0001');
}

/** 结构变了才需要换书；只变状态不需要。 */
export function clipStructureChanged(
  prev: ClipBookSnapshot | null | undefined,
  next: ClipBookSnapshot | null | undefined,
): boolean {
  return clipStructureKey(prev) !== clipStructureKey(next);
}

/**
 * 把刷新前的章节 key 映射到刷新后的书里。
 *
 * 依次尝试：原 key → 同 URL 的章节 → 原 key（让调用方按百分比兜底）。
 */
export function migrateClipKey(
  handle: Pick<ClipBookHandle, 'byKey' | 'chapters'>,
  oldKey: string,
  oldUrl: string,
): string {
  if (!oldKey) return '';
  if (handle.byKey(oldKey)) return oldKey;
  const url = String(oldUrl || '').trim();
  if (url) {
    const hit = handle.chapters.find((c) => String(c.url || '').trim() === url);
    if (hit) return hit.key;
  }
  return oldKey;
}

/**
 * 重建后把「同一篇的实测页数」带过去。
 *
 * 每次 rebuild 都清空实测页数的话，整本书的总页数只能拿当前这一章反推
 * （真机：剪藏一篇后总页数从 441 跳到 622）。结构变化时下标可能整体挪位，
 * 所以只带「同一位置还是同一篇」的那些。
 */
export function carryMeasuredPages(
  oldKeys: readonly string[],
  newKeys: readonly string[],
  measured: ReadonlyMap<number, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  const n = Math.min(oldKeys.length, newKeys.length);
  for (let i = 0; i < n; i += 1) {
    if (oldKeys[i] !== newKeys[i]) continue;
    const pages = measured.get(i);
    if (pages && pages > 0) out.set(i, pages);
  }
  return out;
}

/**
 * 结构没变时，把新快照的「状态 / 剪藏笔记路径」同步到现有 handle。
 *
 * 返回是否真的改了东西（调用方据此决定要不要重绘底条/目录）。
 */
export function syncClipChapterMeta(
  handle: Pick<ClipBookHandle, 'chapters'>,
  snap: ClipBookSnapshot | null | undefined,
): boolean {
  if (!handle || !snap) return false;
  const byKey = new Map(handle.chapters.map((c) => [c.key, c]));
  let changed = false;
  for (const next of snap.chapters) {
    const cur = byKey.get(next.key);
    if (!cur) continue;
    if (cur.state !== next.state) {
      cur.state = next.state;
      changed = true;
    }
    if ((cur.notePath || null) !== (next.notePath || null)) {
      cur.notePath = next.notePath ?? null;
      changed = true;
    }
    if (cur.url !== next.url) {
      cur.url = next.url;
      changed = true;
    }
    if (cur.date !== next.date) {
      cur.date = next.date;
      changed = true;
    }
  }
  return changed;
}
