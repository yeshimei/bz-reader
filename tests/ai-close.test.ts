import { beforeEach, describe, expect, it } from 'vitest';
import { closeOverlay, openOverlay } from '../src/shell/state';
import { RT } from '../src/shell/runtime';

/**
 * 关掉 AI 浮卡 = 不要这个答案了。
 *
 * 划词问 AI 的请求是流式的、按 token 计费。以前只有卡片上的「取消」会
 * abort，点正文 / 点空白关掉卡片只清界面，请求会在后台继续跑完——
 * 用户以为已经取消，钱照扣。
 */

beforeEach(() => {
  RT.aiAbort = null;
  closeOverlay({ force: true });
});

describe('关闭 AI 浮卡', () => {
  it('顺手掐掉在途请求', () => {
    openOverlay({ kind: 'ai', text: '一段正文' });
    const ctrl = new AbortController();
    RT.aiAbort = ctrl;

    closeOverlay();

    expect(ctrl.signal.aborted).toBe(true);
    expect(RT.aiAbort).toBeNull();
  });

  it('关别的浮层不动 AI 的请求', () => {
    openOverlay({ kind: 'footnote', text: '注文' });
    const ctrl = new AbortController();
    RT.aiAbort = ctrl;

    closeOverlay();

    expect(ctrl.signal.aborted).toBe(false);
  });
});
