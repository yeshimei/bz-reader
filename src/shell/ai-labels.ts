/* ============================================================
 * bz-reader · 侧栏 AI 上下文的文案（shell/ai-labels.ts）
 *
 * 拼提问（【上下文】/【问题】）与 chip 摘要共用同一套标签。
 * 单独一层是为了让 ai-context.ts 保持纯函数——那边不 import i18n，
 * 测试可以在 node 里直接跑；这里的标签只有界面层会用到。
 * ============================================================ */
import { t } from '../i18n';
import type { AiPromptLabels } from './ai-context';

export function aiPromptLabels(): AiPromptLabels {
  return {
    context: t('side.ai.ctx.tag.context'),
    question: t('side.ai.ctx.tag.question'),
    quote: t('side.ai.ctx.quote'),
    body: t('side.ai.ctx.body'),
    shot: t('side.ai.ctx.shot'),
    note: t('side.ai.ctx.note'),
    chars: (n) => t('side.ai.ctx.chars', { n }),
    onlyContext: t('side.ai.ctx.only'),
  };
}
