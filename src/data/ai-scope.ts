/* ============================================================
 * bz-reader · AI 回答依据的三种档位（data/ai-scope.ts）
 *
 * 「当前这一屏 / 连接 AI 知识库 / 全书」三选一，互斥、记住上次选择。
 * 这里只放与界面无关的那部分：档位名、检索结果怎么拼成上下文、
 * 来源怎么列。真正的检索与提问在 shell/actions.ts。
 *
 * 一条口径：**拼进上下文的字要有上限**。知识库一段检索可能命中八条笔记，
 * 每条几百上千字，全塞进去既超出模型窗口，也是在替用户烧钱。
 * ============================================================ */
import { t, type MsgKey } from '../i18n';
import type { BzNoteHit } from './bz-bridge';

export type AiScope = 'screen' | 'brain' | 'book';

export const AI_SCOPES: readonly AiScope[] = ['screen', 'brain', 'book'];

export const DEFAULT_AI_SCOPE: AiScope = 'screen';

export function isAiScope(v: unknown): v is AiScope {
  return v === 'screen' || v === 'brain' || v === 'book';
}

const LABEL_KEY: Record<AiScope, MsgKey> = {
  screen: 'side.ai.scope.screen',
  brain: 'side.ai.scope.brain',
  book: 'side.ai.scope.book',
};

export function aiScopeLabel(scope: AiScope): string {
  return t(LABEL_KEY[scope] ?? LABEL_KEY.screen);
}

/** 来源：有 path 的能点开（知识库笔记），没有的只当说明（全书的章节） */
export interface AiSource {
  title: string;
  /** 库内相对路径（Markdown 笔记） */
  path?: string;
  /** 副标题：命中片段或章节名 */
  note?: string;
}

/** 拼进上下文的字数上限：约 4k token 中文，留够回答与历史的余量 */
export const AI_CONTEXT_LIMIT = 6000;

/**
 * 检索命中 → 给模型看的上下文。
 *
 * 顺序就是相关度顺序（bz 按 score 排好了），不做二次排序：检索分在
 * 不同查询之间不可比，但同一次返回里的先后是有意义的。
 */
export function hitsToContext(hits: readonly BzNoteHit[], limit = AI_CONTEXT_LIMIT): string {
  const parts: string[] = [];
  let used = 0;
  for (const h of hits) {
    const body = String(h.chunk ?? '').trim();
    if (!body) continue;
    const title = String(h.title || h.path || '').trim() || t('common.untitled');
    const head = `【${title}】\n`;
    /* 段之间那两个换行也算字：只算正文就总会超出去几十个字符 */
    const sep = parts.length ? 2 : 0;
    /* 留一个格的余量：最后一条能塞多少塞多少，塞不下就整条不要——
       半句话比没有更容易把模型带偏。 */
    if (used + sep + head.length + body.length > limit) {
      const room = limit - used - sep - head.length - 1; /* 1 留给「…」 */
      if (room > 40) parts.push(head + body.slice(0, room) + '…');
      break;
    }
    parts.push(head + body);
    used += sep + head.length + body.length;
  }
  return parts.join('\n\n');
}

export function sourcesOfHits(hits: readonly BzNoteHit[], take = 5): AiSource[] {
  const out: AiSource[] = [];
  for (const h of hits) {
    if (out.length >= take) break;
    const path = String(h.path ?? '').trim();
    const title = String(h.title ?? '').trim() || path;
    if (!title) continue;
    out.push({ title, path: path || undefined, note: String(h.chunk ?? '').trim().slice(0, 40) });
  }
  return out;
}
