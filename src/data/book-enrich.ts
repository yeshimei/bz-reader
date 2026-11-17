/* ============================================================
 * bz-reader · 导入补元数据（data/book-enrich.ts）
 *
 * 2026-11-11：导入一本 EPUB 常常只带书名与作者，简介、分类、语言都空着。
 * 这一层让用户**点一下菜单**让模型补：
 *
 *   1. **只填空白**：用户改过的简介、已有的分类不动——模型写的东西不该
 *      覆盖人写的东西，**也不该往上面追加**（追加意味着每次调用都能凑出
 *      「新增」，于是每点一次都报成功，用户自己归的分类还被越搅越乱）；
 *   2. **齐了就不问**：enrichNeeds 先说清缺哪项，两项都齐时调用方一个
 *      请求都不发；
 *   3. **格式固定**：要求严格输出「简介 / 标签 / 语言」三行。解析不出来就
 *      什么都不写，绝不把一段散文塞进简介字段；
 *   4. **样本来自画像**：有画像就带一段正文，没有就只凭书名与作者。
 *      不为了补信息去解析整本书——那是另一件事，也违背「不自动花额度」。
 * ============================================================ */
import type { BookMeta } from './schema';
import type { PortraitFile } from './portrait';
import type { AiMessage } from './ai';
import { ALL_SHELF, NO_SHELF, cleanShelfList, cleanShelfName } from './shelves';

export interface EnrichPatch {
  description?: string;
  subjects?: string[];
  language?: string;
  /** 书架分类（归类名，见 shelves.ts）；与 subjects 标签是两回事 */
  shelf?: string;
}

/** 简介最多留多少字：书架详情与 bz 那边都用同一段，太长只会被截断 */
const DESC_MAX = 200;

/** 分类最多留几个：再多在书卡上就换行了，也不是分类而是关键词堆 */
const TAGS_MAX = 6;

/** 样本最多带多少字：够模型认出题材即可 */
const SAMPLE_LIMIT = 3000;

function lineValue(src: string, labels: readonly string[]): string {
  for (const label of labels) {
    const m = new RegExp(`^\\s*${label}\\s*[:：]\\s*(.+)$`, 'm').exec(src);
    if (m) return String(m[1] ?? '').trim();
  }
  return '';
}

/**
 * 解析模型的固定格式回复。
 *
 * 容错范围：全角/半角冒号、中英文标签名、顿号/逗号/分号分隔。
 * **不在容错范围内**的是「整段自由发挥」——那种一律返回空对象，让调用方
 * 什么都不写。写错简介比没有简介糟得多。
 */
export function parseEnrichReply(text: string): EnrichPatch {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const out: EnrichPatch = {};

  const desc = lineValue(src, ['简介', '内容简介', 'Description', 'Summary']).replace(/\s+/g, ' ');
  if (desc) out.description = desc.length > DESC_MAX ? `${desc.slice(0, DESC_MAX)}…` : desc;

  const tags = lineValue(src, ['标签', '分类', 'Tags', 'Subjects']);
  if (tags) {
    const list = tags
      .split(/[,，、;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) out.subjects = [...new Set(list)].slice(0, TAGS_MAX);
  }

  const langRaw = lineValue(src, ['语言', 'Language']);
  const lang = /^(zh|en|ja|de|fr|es|pt)/i.exec(langRaw);
  if (lang) out.language = lang[1].toLowerCase();

  /* 书架分类用「归类」标签，与 subjects 的「分类」别名分开——两个概念：
     「标签」是书的内容标签（meta.subjects），「归类」是书架的格子（book.shelf）。 */
  const shelf = lineValue(src, ['归类', '书架分类', 'Shelf']);
  if (shelf) out.shelf = shelf;

  return out;
}

/**
 * 把模型给的归类名定成真正要写进 book.shelf 的值。
 *
 * 优先复用现有分类（规整后同名，连空格都按 shelves 的口径压过），没有合适
 * 的才用新名字；空名与保留名「全部 / 未分类」都不写——它是筛选格不是分类。
 * 返回空串 = 这次不归类。
 */
export function pickEnrichShelf(raw: string, existing: readonly string[]): string {
  const name = cleanShelfName(raw);
  if (!name || name === ALL_SHELF || name === NO_SHELF) return '';
  /* 比较时抹掉所有空白：模型偶尔在词间多插一个空格（「文 学」），
     那也算同一个分类。复用时返回名册里原来的写法，不改写用户的格子。 */
  const squash = (s: string) => cleanShelfName(s).replace(/\s+/g, '');
  for (const cur of existing ?? []) {
    if (squash(cur) === squash(name)) return cleanShelfName(cur);
  }
  return name;
}

/**
 * 把补丁并进现有元数据，只返回**真的要写**的字段。
 *
 * 返回空对象 = 没有可写的（调用方据此跳过落盘与重绘）。
 */
export function mergeMetaPatch(
  meta: BookMeta,
  patch: EnrichPatch,
  maxTags = TAGS_MAX,
): Partial<BookMeta> {
  const out: Partial<BookMeta> = {};

  const desc = String(patch.description ?? '').trim();
  if (desc && !String(meta.description ?? '').trim()) out.description = desc;

  const add = (patch.subjects ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
  /* 已经有分类就一个都不写：合并追加会让每次调用都「有新增」，于是每点一次
     都报成功（2026-11-11 真机反馈），而用户自己归的分类被越搅越乱。 */
  const cur = (meta.subjects ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
  if (add.length && !cur.length) {
    out.subjects = [...new Set(add)].slice(0, Math.max(1, Math.floor(maxTags) || TAGS_MAX));
  }

  const lang = String(patch.language ?? '').trim();
  if (lang && !String(meta.language ?? '').trim()) out.language = lang;

  return out;
}

export interface EnrichNeed {
  /** 缺简介 */
  description: boolean;
  /** 缺分类 */
  subjects: boolean;
}

/**
 * 这本书还缺什么。
 *
 * 两项都 false = 信息齐了，调用方**不该**再发请求。以前没有这一层，齐了
 * 也照样问模型，答回来时标签总能凑出「新增」，于是永远「写成功了」。
 */
export function enrichNeeds(meta: BookMeta): EnrichNeed {
  const desc = String(meta.description ?? '').trim();
  const subs = (meta.subjects ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
  return { description: !desc, subjects: !subs.length };
}

/** 这次到底补上了什么：决定说哪句话（以前不管补到什么都弹「简介与分类」） */
export type EnrichDone = 'both' | 'desc' | 'tags' | 'lang' | 'none';

export function enrichDoneKind(patch: Partial<BookMeta>): EnrichDone {
  const desc = !!(patch.description ?? '').trim();
  const tags = Array.isArray(patch.subjects) && patch.subjects.length > 0;
  const lang = !!(patch.language ?? '').trim();
  if (desc && tags) return 'both';
  if (desc) return 'desc';
  if (tags) return 'tags';
  /* 只补到语言也要说清楚：以前落进 none，被调用方当成「两样都补了」报出去，
     用户看到「已补上简介与分类」却一个字没变（2026-11-17 真机反馈）。 */
  if (lang) return 'lang';
  return 'none';
}

/**
 * 给模型的样本。
 *
 * 压缩画像用「全书总述 + 块要点」，向量画像用最早几块正文——两种都能让
 * 模型认出这是什么书，又都不需要重新解析原文件。
 */
export function enrichSample(p: PortraitFile | null | undefined, limit = SAMPLE_LIMIT): string {
  if (!p) return '';
  const cap = Math.max(200, Math.floor(limit) || SAMPLE_LIMIT);
  const parts: string[] = [];
  if (p.plan === 'compress') {
    const overview = String(p.overview ?? '').trim();
    if (overview) parts.push(overview);
    for (const b of p.blocks ?? []) {
      const body = String(b.summary || b.digest || '').trim();
      if (body) parts.push(body);
    }
  } else {
    for (const b of p.blocks ?? []) {
      const body = String(b.text ?? '').trim();
      if (body) parts.push(body);
    }
  }
  const all = parts.join('\n\n').trim();
  return all.length > cap ? `${all.slice(0, cap)}…` : all;
}

/**
 * 给模型的消息。
 *
 * 严格三行：多一个字模型就容易自由发挥，解析就失败。语言那一行是给
 * `meta.language` 补的（朗读、断句都看它）。
 */
export function buildEnrichMessages(input: {
  title: string;
  author?: string;
  sample?: string;
  /** 现有书架分类名册：归类时优先复用其中的名字，没有合适的再新建 */
  shelfNames?: readonly string[];
}): AiMessage[] {
  const title = String(input.title ?? '').trim();
  const author = String(input.author ?? '').trim();
  const sample = String(input.sample ?? '').trim();
  const names = cleanShelfList(input.shelfNames ?? []);
  const shelfRule = names.length
    ? `「归类」那一行只给一个书架分类名：优先从这些现有分类里挑最贴切的一个——${names.join('、')}；确实都不合适才另起一个新名字（不超过 8 字）。`
    : '「归类」那一行只给一个书架分类名（不超过 8 字）；它是书架的格子，不是内容标签。';
  const system =
    '你是图书馆员。根据给出的书名、作者与片段，为这本书写一段简介（不超过 120 字）与几个分类标签（不超过 4 个）。' +
    shelfRule +
    '严格按下面四行输出，不要任何解释或其他文字：\n简介：……\n标签：标签1, 标签2\n语言：zh\n归类：文学';
  const user = [
    `【书名】${title}`,
    author ? `【作者】${author}` : '',
    sample ? `【片段】\n${sample}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
