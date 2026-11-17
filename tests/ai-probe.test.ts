import { describe, expect, it, vi } from 'vitest';
import { aiProbe, type AiProbeLabels } from '../src/data/ai-probe';

const labels: AiProbeLabels = {
  testing: '测试中',
  ok: (n) => `问答好：${n}`,
  empty: '问答空',
  notReady: '问答没配',
  failed: '失败',
};

function deps(patch: Partial<Parameters<typeof aiProbe>[0]> = {}): Parameters<typeof aiProbe>[0] {
  return {
    chatReady: true,
    chat: async () => '好',
    ...patch,
  };
}

describe('aiProbe · 设置页连接测试', () => {
  it('连上：把回的字带进结论', async () => {
    const r = await aiProbe(deps(), labels);
    expect(r.level).toBe('ok');
    expect(r.message).toContain('问答好');
  });

  it('没配好：直接报没配，不发请求', async () => {
    const chat = vi.fn(async () => '好');
    const r = await aiProbe(deps({ chatReady: false, chat }), labels);
    expect(r.level).toBe('skip');
    expect(r.message).toBe(labels.notReady);
    expect(chat).not.toHaveBeenCalled();
  });

  it('抛错：判失败并带上原因', async () => {
    const r = await aiProbe(
      deps({
        chat: async () => {
          throw new Error('404');
        },
      }),
      labels,
    );
    expect(r.level).toBe('fail');
    expect(r.message).toContain('404');
  });

  it('连上但回空：判失败', async () => {
    const r = await aiProbe(deps({ chat: async () => '   ' }), labels);
    expect(r.level).toBe('fail');
    expect(r.message).toBe(labels.empty);
  });

  /* 2026-11-17：设置页删掉「检索」那一行，探测也只留问答——
     不能再偷偷发一次嵌入请求（真实计费，且结果无处可显示）。 */
  it('只发一次问答请求，不再顺带探测嵌入', async () => {
    const chat = vi.fn(async () => '好');
    const r = await aiProbe(deps({ chat }), labels);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ level: 'ok', message: labels.ok('好') });
  });
});
