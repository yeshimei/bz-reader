/**
 * 自给嵌入（tests/ai-embed.test.ts）
 *
 * 2026-11-07 起，书的向量由 bz 阅读自己算：用设置里的 OpenAI 兼容服务，
 * 不再借 bz 的 Ollama 门面。这里锁三件会悄悄坏掉、而界面上看不出来的事：
 *   1. 请求体长什么样（模型名与输入数组，少一样接口就 400）；
 *   2. 返回的条数与顺序（错位一条 = 整本书的向量与块对不上）；
 *   3. 批量切分（一次塞几百块会把接口打挂，且失败时整批白跑）。
 */
import { describe, expect, it } from 'vitest';
import { EMBED_BATCH, aiEmbed, buildEmbedRequest, parseEmbeddings } from '../src/data/ai';
import { DEFAULT_SETTINGS, embedReady, normalizeSettings } from '../src/data/settings';

const withEmbed = () =>
  normalizeSettings({
    ...DEFAULT_SETTINGS,
    ai: { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'chat-x', embedModel: 'embed-x' },
  });

describe('嵌入请求', () => {
  it('地址接在 /embeddings 上，模型与输入原样带上', () => {
    const req = buildEmbedRequest(withEmbed(), ['第一块', '第二块']);
    expect(req.url).toBe('https://api.example.com/v1/embeddings');
    expect(req.body.model).toBe('embed-x');
    expect(req.body.input).toEqual(['第一块', '第二块']);
  });
});

describe('嵌入返回', () => {
  it('按 index 归位（接口不保证顺序）', () => {
    const got = parseEmbeddings(
      {
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      },
      2,
    );
    expect(got).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it('条数不对要报错：少一条就等于少一块的依据', () => {
    expect(() => parseEmbeddings({ data: [{ embedding: [0.1] }] }, 2)).toThrow(/条数/);
  });

  it('空向量要报错，不能当成 0 相似度混过去', () => {
    expect(() => parseEmbeddings({ data: [{ embedding: [] }] }, 1)).toThrow(/空向量/);
  });

  it('接口自己报错时把原话带出来', () => {
    expect(() => parseEmbeddings({ error: { message: 'model not found' } }, 1)).toThrow(/model not found/);
  });
});

describe('批量切分', () => {
  it('超过一批就分几次请求，结果按原顺序拼回来', async () => {
    const texts = Array.from({ length: EMBED_BATCH + 3 }, (_, i) => `t${i}`);
    const sizes: number[] = [];
    const got = await aiEmbed(withEmbed(), texts, {
      fetch: (async (_url: string, init: { body?: string }) => {
        const body = JSON.parse(String(init.body ?? '{}')) as { input: string[] };
        sizes.push(body.input.length);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: body.input.map((t, i) => ({ index: i, embedding: [Number(t.slice(1)), 1] })),
          }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    expect(sizes).toEqual([EMBED_BATCH, 3]);
    expect(got).toHaveLength(texts.length);
    expect(got[0]).toEqual([0, 1]);
    expect(got[texts.length - 1]).toEqual([EMBED_BATCH + 2, 1]);
  });

  it('没配嵌入模型就不发请求', async () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, ai: { baseUrl: 'https://x/v1', apiKey: 'k' } });
    expect(embedReady(s)).toBe(false);
    await expect(aiEmbed(s, ['x'])).rejects.toThrow(/嵌入模型/);
  });
});
