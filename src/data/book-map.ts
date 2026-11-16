/* ============================================================
 * bz-reader · 全书地图（data/book-map.ts）
 *
 * 2026-11-16：全书问答一直是「向量取六块」。定位型问题（船叫什么、
 * 哪一章提到 X）补了字面通道之后能答了，但**结构型**问题还是答不了：
 * 「这本书讲了什么」「作者的态度怎么变的」「第九章主要写什么」——
 * 六块碎片没有顺序、没有章界，模型只能拼出一段似真似假的概述。
 *
 * 社区三条线收敛到同一件事（见 docs/ai-knowledge-decisions.md §9）：
 *   · PageIndex：把书切成树，先让模型在**目录**里选节点，再读节点原文；
 *   · MindMax：章级地图 + 「能读完就整篇读，读不完按目录选章」；
 *   · BookRAG：树索引 + 查询分类，不同问法走不同 workflow。
 *
 * bz 已经有了地图的全部原料，不用另建索引：
 *   · 章节名与顺序 —— 每一块都带 `chapter`；
 *   · 一行说明 —— `guides[章名]` 有就用导读第一句，没有就用该章开头；
 *   · 整章原文 —— 向量画像的每块都存了 `text`，按顺序拼起来就是那一章。
 *
 * 与社区的一处**有意的不同**：选章不发模型调用（PageIndex 是让模型在树里
 * 做选择）。本地 14B 单问 77 秒，为选章再加一次往返，用户等不起；而书的
 * 目录只有十几到几十行，字面打分已经足够准。挑不中就不挑，退回检索结果，
 * 不硬凑——这是「宁可少读一章，不可读错一章」。
 * ============================================================ */
import { AI_EVIDENCE_LIMIT } from './ai-budget';
import type { AiSource } from './ai-evidence';
import { firstSentence, type PortraitFile } from './portrait';
import { countMatchedTerms, queryTerms, tokenize } from './text-terms';

/** 目录占用的上限：地图是「怎么读」的指引，不该挤掉正文 */
const MAP_BUDGET = 2200;

/** 一行说明的默认长度：侧栏一行放得下，也够看出这一章讲什么 */
const LINE_MAX = 60;

/** 默认读几章：两章 ≈ 5000 字，正好在 8000 字依据预算里留出目录的份额 */
const CHAPTER_LIMIT = 2;

/** 章名命中的权重：问「三闾大学」时，章名里就有这四个字，比正文提一句强得多 */
const NAME_WEIGHT = 3;

/** 至少要这么多分才算「这一章跟问题有关」，否则不如不挑 */
const PICK_FLOOR = 2;

export interface MapEntry {
  /** 章节键：画像里每一块都按它归组，`chapterText` 也按它取 */
  chapter: string;
  /** 给人看的章名。目录里只有「第 7 节」时，从正文第一行的标题补出来 */
  title: string;
  /** 一行说明（导读第一句 / 该章开头） */
  line: string;
  /** 这一章有几块 */
  blocks: number;
  /** 这一章原文共多少字（拿不到原文时按要点算） */
  chars: number;
  /** 第一块在 `portrait.blocks` 里的下标 */
  from: number;
}

/**
 * 目录里只有「第 7 节」这种空壳章名。
 *
 * EPUB 的 nav 有时只给序号（`第 3 节`），真章名在正文第一行
 * （`第九章贝尔格莱德Ⅰ：蓝色火车`）。不补出来，地图对人和模型都没用：
 * 用户问「第九章讲了什么」，目录里根本没有「第九章」这三个字。
 */
const GENERIC_CHAPTER = /^第\s*[一二三四五六七八九十百千零〇\d]+\s*[章节篇回卷]?$/;

/** 正文开头的标题行：到空白为止，最多 24 字，避免把整段正文当成标题 */
const HEADING_LINE = /^第\s*[一二三四五六七八九十百千零〇\d]+\s*[章节篇部卷][^\s]{0,24}(?=\s|$)/;

/** 块的可读正文：向量画像有原文，压缩画像只有要点，老画像只有一句 */
function bodyOf(block: { text?: string; summary?: string; digest?: string }): string {
  return String(block.text || block.summary || block.digest || '').trim();
}

/**
 * 建地图：一章一行，顺序就是书的顺序。
 *
 * 空章名的块（封面、版权页、没有标题的散块）归到「正文」名下，不丢——
 * 丢了就会出现「目录里少一段，模型以为书里没有」。
 */
export function bookMap(p: PortraitFile | null | undefined, opts: { lineMax?: number } = {}): MapEntry[] {
  const lineMax = Math.max(8, Math.floor(opts.lineMax ?? LINE_MAX));
  const out: MapEntry[] = [];
  const index = new Map<string, MapEntry>();
  const blocks = p?.blocks ?? [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const chapter = String(block.chapter ?? '').trim() || '正文';
    const body = bodyOf(block);
    let entry = index.get(chapter);
    if (!entry) {
      const heading = GENERIC_CHAPTER.test(chapter) ? (body.match(HEADING_LINE)?.[0] ?? '').trim() : '';
      entry = { chapter, title: heading || chapter, line: '', blocks: 0, chars: 0, from: i };
      index.set(chapter, entry);
      out.push(entry);
    }
    entry.blocks += 1;
    entry.chars += body.length;
    if (!entry.line) entry.line = firstSentence(body, lineMax);
  }
  /* 导读比开头那句更像「这一章讲什么」：用户生成过就用，没生成不强求 */
  const guides = p?.guides ?? {};
  for (const entry of out) {
    const guide = String(guides[entry.chapter] ?? '').trim();
    if (guide) entry.line = firstSentence(guide, lineMax);
    /* 正文开头那行标题已经从章名取走了，说明里不要再重复一遍 */
    if (entry.title !== entry.chapter && entry.line.startsWith(entry.title)) {
      entry.line = entry.line.slice(entry.title.length).trim();
    }
  }
  return out;
}

/** 章节序号：`第九章` / `第 9 章` / `第二十九回` 都认 */
const CHAPTER_NO = /第\s*([一二两三四五六七八九十百千零〇\d]+)\s*[章节篇回卷部]/;

/** 中文数字转整数（只到千位，够章节用）；认不出返回 NaN */
function cnNumber(raw: string): number {
  const text = String(raw ?? '').trim();
  if (!text) return NaN;
  if (/^\d+$/.test(text)) return Number(text);
  const digit: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  let total = 0;
  let num = 0;
  for (const ch of text) {
    if (ch in digit) {
      num = digit[ch];
      continue;
    }
    if (ch === '十') {
      total += (num || 1) * 10;
      num = 0;
      continue;
    }
    if (ch === '百') {
      total += (num || 1) * 100;
      num = 0;
      continue;
    }
    if (ch === '千') {
      total += (num || 1) * 1000;
      num = 0;
      continue;
    }
    return NaN;
  }
  return total + num;
}

/** 这段文字里点名的章节序号；没点名返回 null */
export function chapterNumber(text: string): number | null {
  const m = String(text ?? '').match(CHAPTER_NO);
  if (!m) return null;
  const n = cnNumber(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 挑章：字面打分，不发请求。
 *
 * 章名命中比正文开头命中重三倍——问「三闾大学」时章名里就有这四个字，
 * 那是作者亲手给的标签；正文开头提一句只是巧合。
 * 一个词都不沾就返回空：让上层退回检索，而不是随便挑两章读一遍。
 *
 * 但问题里点名了第几章时（「第九章讲了什么」），**序号就是硬条件**：
 * 二字组会把「第二十九章」切出「第二」，正好撞上「第二章」，问 29 章
 * 答第 2 章。序号对不上就不挑，交给兜底。
 */
export function pickChapters(map: readonly MapEntry[], query: string, limit = CHAPTER_LIMIT): MapEntry[] {
  const terms = queryTerms(query);
  if (!map.length || !terms.length) return [];
  const cap = Math.max(1, Math.floor(limit) || CHAPTER_LIMIT);

  const asked = chapterNumber(query);
  if (asked !== null) {
    const same = map.filter((e) => chapterNumber(e.title) === asked || chapterNumber(e.chapter) === asked);
    return same.slice(0, cap);
  }

  const scored: Array<{ entry: MapEntry; score: number; order: number }> = [];
  map.forEach((entry, order) => {
    const nameHits = countMatchedTerms(tokenize(entry.title), terms);
    const lineHits = countMatchedTerms(tokenize(entry.line), terms);
    const score = nameHits * NAME_WEIGHT + lineHits;
    if (score >= PICK_FLOOR) scored.push({ entry, score, order });
  });
  /* 同分按书的顺序：读两章时希望它们前后相接，而不是跳着读 */
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored
    .slice(0, cap)
    .sort((a, b) => a.order - b.order)
    .map((s) => s.entry);
}

/**
 * 整章原文：按块顺序拼，不重排、不摘要。
 *
 * 这是与「六块碎片」最关键的区别——论证是顺着走的，抽掉中间三块，
 * 结论就成了断章取义。超预算时截断并留痕，让模型知道自己没读全。
 */
export function chapterText(p: PortraitFile | null | undefined, chapter: string, budget = 3000): string {
  const key = String(chapter ?? '').trim();
  const cap = Math.max(0, Math.floor(budget));
  if (!p || !key || !cap) return '';
  const parts: string[] = [];
  let used = 0;
  for (const block of p.blocks ?? []) {
    if ((String(block.chapter ?? '').trim() || '正文') !== key) continue;
    const body = bodyOf(block);
    if (!body) continue;
    if (used >= cap) {
      parts.push('…');
      break;
    }
    const room = cap - used;
    if (body.length <= room) {
      parts.push(body);
      used += body.length + 1;
      continue;
    }
    parts.push(`${body.slice(0, room)}…`);
    break;
  }
  return parts.join('\n');
}

/**
 * 这本书整体在问什么。
 *
 * 两道门都要过：**说的是整本**（全书 / 这本书 / 通篇）**且在问结构**
 * （讲什么 / 脉络 / 主题 / 结构 / 演变）。只有一道门不算——
 * 「这本书的船叫什么」提到了整本，但问的是某一句，走地图会答成概述。
 */
const WHOLE_OBJECT = /全书|整本|整部|通篇|全篇|整篇|这本书|本书/;
const WHOLE_FACET =
  /讲(了|的)?(些)?(什么|啥)|说什么|写了什么|主题|主旨|中心思想|脉络|主线|结构|框架|概要|概括|大纲|走向|整体|全局|贯穿|演变|变化|转变|发展脉络|总结|梳理|分几(个)?(部分|阶段|章)|几章/;
/** 不带「全书」也明确在问结构的说法 */
const WHOLE_STRONG = /脉络|主线|中心思想|主旨|全书结构|整体结构|章节安排|通篇|整体上|总体上|贯穿全文|全书概括/;

export function isWholeBookQuestion(q: string): boolean {
  const text = String(q ?? '').trim();
  if (!text) return false;
  if (WHOLE_STRONG.test(text)) return true;
  return WHOLE_OBJECT.test(text) && WHOLE_FACET.test(text);
}

/**
 * 在问「这一章讲了什么」。
 *
 * 必须同时有**章节引用**和**问内容**两部分：「第 3 章里那个船叫什么」
 * 也带着章节引用，但它要的是一句话，读整章是浪费。
 */
const CHAPTER_REF = /第\s*[一二三四五六七八九十百千零〇\d]+\s*[章节篇回卷]/;
const CHAPTER_ABOUT =
  /(讲|写|说|谈|聊)(了|的)?(些)?(什么|啥|哪些)|内容|概述|大意|梗概|摘要|概要|主题|主要讲/;

export function isChapterQuestion(q: string): boolean {
  const text = String(q ?? '').trim();
  return CHAPTER_REF.test(text) && CHAPTER_ABOUT.test(text);
}

/** 该走地图还是走检索 */
export function needsMap(q: string): boolean {
  return isWholeBookQuestion(q) || isChapterQuestion(q);
}

export interface WholeBookOptions {
  /** 依据总预算（含目录） */
  limit?: number;
  /** 最多读几章 */
  chapterLimit?: number;
  lineMax?: number;
  /** 一章都没挑中时用检索结果兜底；不给就只给目录 */
  fallback?: { context: string; sources: AiSource[] };
}

/**
 * 这份依据是怎么来的。
 *
 * 调用方要据此决定「还需不需要向量检索」：chapters / spread 都是自足的；
 * catalog 只有目录，细节还得靠检索补——但也比报错强，嵌入服务挂了的时候
 * 结构型问题仍然答得出来。
 */
export type WholeBookKind = 'chapters' | 'spread' | 'fallback' | 'catalog';

export interface WholeBookEvidence {
  context: string;
  sources: AiSource[];
  kind: WholeBookKind;
}

/**
 * 结构型问题的依据：目录打底，挑中的章整段读。
 *
 * 顺序是「先目录、后原文」：模型先看到自己在书的哪一段，再读原文，
 * 引用时才知道该说「第三章」。反过来（先原文后目录）模型经常读完就
 * 忘了还有别的章。
 */
/**
 * 全书速览：每章开头各取一段，按书的顺序铺满预算。
 *
 * 「这本书讲了什么」用目录答，只能答出「有哪些部分」，答不出「在讲什么」：
 * 目录那一行是句式，不是内容。但整本读完又装不下。
 *
 * 折中是社区那几家的共同做法（Readwise 的单篇分块、MindMax 的「读不完就
 * 按目录选」）：**均匀撒**。每章开头通常就是这一章的论点与场景，17 章各
 * 400 字，模型的视野覆盖全书，而不是死盯最像的六段。
 *
 * 与检索结果的区别是「分布」：检索永远向最像的那几段收敛，全书问题要的
 * 恰恰是不收敛。
 */
export function bookSpread(p: PortraitFile | null | undefined, limit = AI_EVIDENCE_LIMIT): string {
  const map = bookMap(p);
  if (!map.length) return '';
  const cap = Math.max(200, Math.floor(limit));
  /* 每章的份额按章数均分。只有一两章的短书不再单独放大——以前 `per = cap`
     会让第一章吃掉整份预算，第二章直接被「后文省略」掉，两章的书等于只读了半本。 */
  const each = Math.floor((cap - 40) / Math.max(1, map.length));
  const per = map.length <= 2 ? Math.max(160, each) : Math.max(160, Math.min(700, each));
  const parts: string[] = [];
  let used = 0;
  for (const entry of map) {
    const text = chapterText(p, entry.chapter, per);
    if (!text) continue;
    const chunk = `【${entry.title}】\n${text}`;
    if (used + chunk.length > cap) {
      parts.push('…（后文省略）');
      break;
    }
    parts.push(chunk);
    used += chunk.length + 1;
  }
  return parts.join('\n');
}

export function wholeBookEvidence(
  p: PortraitFile | null | undefined,
  q: string,
  opts: WholeBookOptions = {},
): WholeBookEvidence | null {
  const limit = Math.max(200, Math.floor(opts.limit ?? AI_EVIDENCE_LIMIT));
  const map = bookMap(p, { lineMax: opts.lineMax });
  if (!map.length) return null;

  const picked = pickChapters(map, q, opts.chapterLimit ?? CHAPTER_LIMIT);

  /* 全书问题、又一章都挑不中：给「每章开头」而不是「目录 + 六块」。
     目录那一行是句式，答不出「在讲什么」；六块又只覆盖最像的一处。 */
  if (!picked.length && isWholeBookQuestion(q)) {
    const spread = bookSpread(p, limit);
    if (spread.trim()) {
      return {
        kind: 'spread',
        context: spread,
        sources: map.slice(0, 5).map((entry) => ({
          title: entry.title,
          bookId: p?.bookId,
          note: entry.line || `共 ${entry.blocks} 段`,
        })),
      };
    }
  }

  const mapBudget = Math.min(MAP_BUDGET, Math.floor(limit * 0.3));
  const lines: string[] = ['【全书目录】'];
  let used = lines[0].length + 1;
  for (const entry of map) {
    const line = entry.line ? `- ${entry.title}：${entry.line}` : `- ${entry.title}`;
    if (used + line.length + 1 > mapBudget) {
      lines.push('- …');
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  let head = lines.join('\n');

  let sources: AiSource[];
  let kind: WholeBookKind;

  if (picked.length) {
    /* 目录先吃掉它的份额，剩下的均分给挑中的章；每章至少留 600 字，
       否则「整章读」只剩个开头，还不如不读 */
    const rest = Math.max(600 * picked.length, limit - head.length - 40);
    const each = Math.max(600, Math.floor(rest / picked.length));
    const body: string[] = ['【重点章节】'];
    for (const entry of picked) {
      const text = chapterText(p, entry.chapter, each);
      if (!text) continue;
      body.push(`【${entry.title}】`, text);
    }
    if (body.length > 1) head = `${head}\n${body.join('\n')}`;
    sources = picked.map((entry) => ({
      title: entry.title,
      bookId: p?.bookId,
      note: entry.line || `共 ${entry.blocks} 段`,
    }));
    kind = 'chapters';
  } else if (opts.fallback?.context.trim()) {
    /* 一章都不沾：目录照给（结构是真的），细节用检索结果补 */
    const rest = Math.max(200, limit - head.length - 20);
    const tail = opts.fallback.context.trim();
    head = `${head}\n【相关段落】\n${tail.length <= rest ? tail : `${tail.slice(0, rest)}\n…`}`;
    sources = opts.fallback.sources.slice();
    kind = 'fallback';
  } else {
    /* 只有目录：回答会偏概述，但每个字都有出处 —— 比编一段情节强 */
    sources = map.slice(0, 5).map((entry) => ({
      title: entry.title,
      bookId: p?.bookId,
      note: entry.line || `共 ${entry.blocks} 段`,
    }));
    kind = 'catalog';
  }

  if (head.length > limit) head = head.slice(0, limit);
  return { context: head, sources, kind };
}
