/* ============================================================
 * bz-reader · 主题书单（data/topic-route.ts）
 *
 * 2026-11-11：给一个主题，让向量在书架里找「哪几本的哪几章讲过」，再让
 * 模型排一条阅读路线。与「问这摞书」正好相反：
 *   · 问这摞书：用户指定书，模型回答；
 *   · 主题书单：用户只给主题，检索去挑书。
 *
 * 三条约束：
 *   1. **只用检索到的书**：prompt 里写死，模型不许在书单里塞书架上没有的书；
 *   2. **不自动跑**：命令点了才检索与对话；
 *   3. **结果能落成笔记**：Markdown 带 frontmatter、正文与来源，用户可改。
 * ============================================================ */
import type { SemanticHit } from './book-search';
import type { AiMessage } from './ai';
import { yamlStr } from './export';

export interface RouteBook {
  bookId: string;
  title: string;
  /** 命中的章节（去重、按相关度排序、最多几章） */
  chapters: string[];
  /** 最高相关度 */
  best: number;
  /** 命中段数 */
  hits: number;
}

/** 每本最多列几章：书单要的是路线，不是把一本书翻个底朝天 */
export const ROUTE_CHAPTERS = 3;

/**
 * 把逐段命中聚成「书 → 章」。
 *
 * 排序按最高分而不是命中数：一本只有一段极相关的书，比一本到处都沾一点
 * 的书更该被排进路线。
 */
export function routeCandidates(hits: readonly SemanticHit[], perBookChapters = ROUTE_CHAPTERS): RouteBook[] {
  const cap = Math.max(1, Math.floor(perBookChapters) || ROUTE_CHAPTERS);
  const map = new Map<string, RouteBook>();
  for (const hit of hits ?? []) {
    if (!hit) continue;
    const id = String(hit.bookId ?? '');
    const row = map.get(id) ?? {
      bookId: id,
      title: String(hit.title ?? '').trim(),
      chapters: [],
      best: 0,
      hits: 0,
    };
    row.hits += 1;
    row.best = Math.max(row.best, Number(hit.score) || 0);
    const chapter = String(hit.chapter ?? '').trim();
    if (chapter && !row.chapters.includes(chapter) && row.chapters.length < cap) row.chapters.push(chapter);
    map.set(id, row);
  }
  return [...map.values()].sort((a, b) => b.best - a.best || a.title.localeCompare(b.title));
}

/** 给模型的消息：主题 + 候选表 */
export function buildRouteMessages(input: { topic: string; books: readonly RouteBook[] }): AiMessage[] {
  const topic = String(input.topic ?? '').trim();
  const books = input.books ?? [];
  const system = books.length
    ? '你是读书顾问。根据读者给的主题与下面这些书的命中章节，排一条阅读路线：先读哪本、读哪几章、为什么这样排。只用列出来的书，不要推荐列表之外的书；用中文，四百字以内，按「阅读路线」逐条写。'
    : '你是读书顾问。读者给了一个主题，但书架里没有找到可用的画像。只用一句话说明这一点，不要编造书名；再给两三条「可以怎么找书」的建议。用中文，简洁。';
  const user = books.length
    ? [
        `【主题】${topic}`,
        '【候选】',
        ...books.map(
          (b) =>
            `- ${b.title || '未命名'}${b.chapters.length ? ` · ${b.chapters.join(' / ')}` : ''}（相关度 ${b.best.toFixed(2)}）`,
        ),
      ].join('\n')
    : `【主题】${topic}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export interface RouteMarkdownInput {
  topic: string;
  body: string;
  /** YYYY-MM-DD */
  day: string;
  books: readonly RouteBook[];
}

/**
 * 书单落成 Markdown。
 *
 * 带 frontmatter（title / created）与末尾来源——用户之后在库里看到这篇，
 * 至少能知道「当初是哪些书被检索到了」，而不是一段无出处的路线。
 */
export function routeMarkdown(input: RouteMarkdownInput): string {
  const body = String(input.body ?? '').trim();
  if (!body) return '';
  const topic = String(input.topic ?? '').trim() || '未命名主题';
  const title = `主题书单 · ${topic}`;
  const lines = ['---', `title: ${yamlStr(title)}`, `created: ${String(input.day ?? '').trim()}`, '---', '', `# ${title}`, '', body, ''];
  const src = (input.books ?? [])
    .map((b) => `${String(b.title ?? '').trim()}${b.chapters.length ? ` · ${b.chapters.join(' / ')}` : ''}`)
    .filter(Boolean);
  if (src.length) {
    lines.push('---', '', `来源：${src.join('；')}`, '');
  }
  return lines.join('\n');
}
