import { describe, expect, it, vi } from 'vitest';
import { aiProbe, type AiProbeLabels } from '../src/data/ai-probe';

const labels: AiProbeLabels = {
  chatTesting: '测试中',
  embedTesting: '测试中',
  ok: (n) => `问答好：${n}`,
  empty: '问答空',
  notReady: '问答没配',
  embedOk: (n) => `检索好：${n}`,
  embedNoModel: '检索没配',
  embedEmpty: '检索空',
  failed: '失败',
};

function deps(patch: Partial<Parameters<typeof aiProbe>[0]> = {}): Parameters<typeof aiProbe>[0] {
  return {
    chatReady: true,
    chat: async () => '好',
    embedModel: 'bge-small',
    embed: async () => [0.1, 0.2],
    ...patch,
  };
}

describe('aiProbe · 设置页连接测试', () => {
  it('两路都通：各报各的结果', async () => {
    const r = await aiProbe(deps(), labels);
    expect(r.chat).toMatchObject({ level: 'ok' });
    expect(r.chat.message).toContain('问答好');
    expect(r.embed).toMatchObject({ level: 'ok' });
    expect(r.embed.message).toContain('bge-small');
  });

  it('chat 没配好：直接报没配，不发请求', async () => {
    const chat = vi.fn(async () => '好');
    const r = await aiProbe(deps({ chatReady: false, chat }), labels);
    expect(r.chat.level).toBe('skip');
    expect(chat).not.toHaveBeenCalled();
    /* 不影响 embed */
    expect(r.embed.level).toBe('ok');
  });

  it('chat 抛错不连累 embed', async () => {
    const r = await aiProbe(
      deps({ chat: async () => { throw new Error('404'); } }),
      labels,
    );
    expect(r.chat.level).toBe('fail');
    expect(r.chat.message).toContain('404');
    expect(r.embed.level).toBe('ok');
  });

  it('chat 连上但回空、embed 回空向量：两样都判失败', async () => {
    const r = await aiProbe(
      deps({ chat: async () => '   ', embed: async () => [] }),
      labels,
    );
    expect(r.chat.message).toBe(labels.empty);
    expect(r.embed.message).toBe(labels.embedEmpty);
  });

  it('没选嵌入模型：检索报没配，不请求', async () => {
    const embed = vi.fn(async () => [1]);
    const r = await aiProbe(deps({ embedModel: '', embed }), labels);
    expect(r.embed.level).toBe('skip');
    expect(r.embed.message).toBe(labels.embedNoModel);
    expect(embed).not.toHaveBeenCalled();
  });
});
