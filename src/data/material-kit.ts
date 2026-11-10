/* ============================================================
 * bz-reader · 写作素材包（data/material-kit.ts）
 *
 * 2026-11-11：把划线（连同想法）按主题词收拢成一篇能直接用的稿子。
 *
 * 这一档**不花 AI**：匹配是本地字面，排序按命中数，用户看得见为什么
 * 这一句被收进来。做「写作素材」时，可解释比「模型觉得相关」重要得多。
 *
 * 三条口径：
 *   1. 主题词按逗号 / 顿号 / 分号 / 空白拆开，单字词不收（噪音太大）；
 *   2. 想法也参与匹配——划过但没想法的常常只是半句，写东西时更想要自己
 *      写过的那些，所以想法命中比原文命中权重高；
 *   3. 输出按书分组，每条带书名 · 章节，能直接贴进文章。
 * ============================================================ */
import { t } from '../i18n';

/** 参与匹配的最小字段（只要界面给得出这几样） */
export interface MaterialMark {
  id: string;
  bookId: string;
  bookTitle: string;
  text: string;
  comment?: string;
  chapterTitle?: string;
}

export type MaterialWhere = 'text' | 'idea';

export interface MaterialHit {
  mark: MaterialMark;
  score: number;
  /** 命中在哪：原文 / 想法（两边都中可以都有） */
  where: MaterialWhere[];
}

export interface MaterialGroup {
  bookId: string;
  bookTitle: string;
  rows: MaterialHit[];
}

/** 末尾标记：之后重新整理时认得出这是插件写的段落 */
export const MATERIAL_MARK = '<!-- bz-reader:materials -->';

/** 单字词不收：中文里几乎每句都含「的」「是」，收了等于全选 */
const MIN_TERM = 2;

/** 原文字面命中的权重 */
const W_TEXT = 2;

/** 想法命中的权重：写东西时更想用自己的话 */
const W_IDEA = 3;

export function materialTerms(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/[,，、;；\s]+/)) {
    const term = part.trim();
    if (term.length < MIN_TERM || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
  }
  return out;
}

export function matchMarks(marks: readonly MaterialMark[], raw: string): MaterialHit[] {
  const terms = materialTerms(raw);
  if (!terms.length) return [];

  const out: MaterialHit[] = [];
  for (const mark of marks ?? []) {
    if (!mark) continue;
    const text = String(mark.text ?? '').toLowerCase();
    const idea = String(mark.comment ?? '').toLowerCase();
    const where: MaterialWhere[] = [];
    let score = 0;
    for (const term of terms) {
      const needle = term.toLowerCase();
      if (text.includes(needle)) {
        score += W_TEXT;
        where.push('text');
      }
      if (idea.includes(needle)) {
        score += W_IDEA;
        where.push('idea');
      }
    }
    if (score > 0) out.push({ mark, score, where: [...new Set(where)] });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function groupMaterials(hits: readonly MaterialHit[]): MaterialGroup[] {
  const map = new Map<string, MaterialGroup>();
  for (const hit of hits ?? []) {
    if (!hit?.mark) continue;
    const id = String(hit.mark.bookId ?? '');
    const group = map.get(id) ?? {
      bookId: id,
      bookTitle: String(hit.mark.bookTitle ?? '').trim(),
      rows: [],
    };
    group.rows.push(hit);
    map.set(id, group);
  }
  return [...map.values()];
}

/** 素材包 Markdown；没有命中返回空串（调用方据此不写盘） */
export function materialMarkdown(input: {
  topic: string;
  day: string;
  groups: readonly MaterialGroup[];
}): string {
  const groups = input.groups ?? [];
  if (!groups.length) return '';
  const topic = String(input.topic ?? '').trim() || t('material.title');
  const lines = [`## ${t('material.title')} · ${topic} · ${String(input.day ?? '').trim()}`, ''];

  for (const group of groups) {
    lines.push(`### ${group.bookTitle || t('common.untitled')}`, '');
    for (const hit of group.rows) {
      const mark = hit.mark;
      const quote = String(mark.text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const chapter = String(mark.chapterTitle ?? '').trim();
      const from = [group.bookTitle || t('common.untitled'), chapter].filter(Boolean).join(' · ');
      if (quote) lines.push(`> ${quote}`, '');
      lines.push(`— ${from}`, '');
      const idea = String(mark.comment ?? '').trim();
      if (idea) lines.push(`**${t('material.idea')}**`, '', idea, '');
    }
  }

  lines.push(MATERIAL_MARK);
  return lines.join('\n');
}
