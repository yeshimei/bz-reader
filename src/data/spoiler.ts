/**
 * 剧透门（2026-11-16）：读到哪，答到哪。
 *
 * 全书问答默认把整本书都摆给模型。非虚构读者要的就是这个（前后章节互相
 * 印证）；小说读者问「这个人后来怎么样了」时，整本可查就把结局直接漏出来
 * 了——Kindle 的「Ask this book」默认只答到当前阅读位置，正是这个原因。
 *
 * 截断点按**章**算，不按字数百分比：
 *   · 百分比在目录不准的书上会把「下一章开头」算成「这一章末尾」；
 *   · 章的边界在画像里是现成的（每块都带 `chapter`），不需要另建索引。
 *
 * 当前章在画像里找不到时**不截**。宁可整本可查，也不能因为 nav 给的章名
 * 和画像里的对不上，就把用户要查的东西整本藏起来——那是一种更难查的坏。
 *
 * 这是**设置项、默认关**（见 `ReaderSettings.aiSpoiler`）：默认开会让非虚构
 * 读者莫名其妙搜不到后半本，而他们才是「按意思搜 / 问全书」的主力。
 */
import { bookMap } from './book-map';
import type { PortraitFile } from './portrait';

export interface SpoilerScope {
  /** 截断后的画像：块下标与完整画像的前缀一致，来源能照常跳回书里 */
  portrait: PortraitFile;
  /** 当前章在目录里的显示名（写进依据里那句范围说明） */
  chapter: string;
  /** 砍掉了多少块（调试与测试用，不进界面） */
  dropped: number;
}

/**
 * 一章在块数组里的区间 `[start, end)`。
 *
 * 只认**连续**同名：书名重复的章（「正文」出现在好几处）取第一段。取最后
 * 一段会把中间几章一起放进来——剧透门宁可少给，不能多给。
 */
function chapterRange(
  blocks: readonly { chapter?: string }[],
  chapter: string,
): [number, number] | null {
  let start = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    if (String(blocks[i].chapter ?? '').trim() === chapter) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = start + 1;
  while (end < blocks.length && String(blocks[end].chapter ?? '').trim() === chapter) end += 1;
  return [start, end];
}

/**
 * 按当前阅读位置截出「能看的那半本」。
 *
 * @param chapterTitle `reading.position.chapterTitle`
 * @returns 不截（章名对不上 / 已在最后一章 / 没有画像）时返回 `null`
 */
export function spoilerScope(
  p: PortraitFile | null | undefined,
  chapterTitle?: string,
): SpoilerScope | null {
  const title = String(chapterTitle ?? '').trim();
  const blocks = p?.blocks ?? [];
  if (!p || !title || !blocks.length) return null;

  let end: number | null = null;
  let label = title;
  const exact = chapterRange(blocks, title);
  if (exact) {
    end = exact[1];
  } else {
    /* nav 只给「第 7 节」、目录补出来是「第九章贝尔格莱德Ⅰ：蓝色火车」这类
       对不上的情况：按目录的显示名再匹配一次（补名逻辑在 book-map 里）。 */
    for (const entry of bookMap(p)) {
      if (entry.title !== title && !entry.title.includes(title)) continue;
      end = entry.from + entry.blocks;
      label = entry.title;
      break;
    }
  }
  if (end === null) return null;
  /* 已经在最后一章：截了等于没截，别白做一次拷贝 */
  if (end >= blocks.length) return null;

  return {
    /* overview 是全书总述，留着等于把后面的事先说了；剧透门开着就不给 */
    portrait: { ...p, overview: '', blocks: blocks.slice(0, end) },
    chapter: label,
    dropped: blocks.length - end,
  };
}

/** 依据开头那句范围说明：不写，模型会拿「书里没有」回答后面的事 */
export function spoilerNote(scope: SpoilerScope): string {
  return `【范围】只提供到《${scope.chapter}》为止（读者当前读到这一章），后面的内容不可见；问到这之后的事，说「后面的内容还没读到」。`;
}
