import { describe, expect, it } from 'vitest';
import {
  QUERY_INTENT_LIMIT,
  buildQueryIntentMessages,
  parseQueryIntent,
  refineQuery,
} from '../src/data/search-intent';

/* ============================================================
 * 按意思搜的「意图改写」：让 AI 先把读者那句口语变成检索词，
 * 再拿去算向量。这里只钉纯逻辑与降级——真请求要 bz 的嵌入服务，
 * node 里造不出来，见 book-search.test.ts 的分工说明。
 * ============================================================ */
describe('buildQueryIntentMessages', () => {
  it('把原话交给模型，并要求只给一行检索词', () => {
    const messages = buildQueryIntentMessages('哪本书讲过知行合一');
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('检索词');
    expect(messages[messages.length - 1].content).toContain('哪本书讲过知行合一');
  });
});

describe('parseQueryIntent', () => {
  it('正常返回：取第一行检索词', () => {
    expect(parseQueryIntent('知行合一 王阳明', '原话')).toBe('知行合一 王阳明');
  });

  it('多行的解释不要，只留第一行', () => {
    expect(parseQueryIntent('知行合一\n这句话的意思是', '原话')).toBe('知行合一');
  });

  it('剥掉前缀与包裹的引号', () => {
    expect(parseQueryIntent('检索词：「知行合一」', '原话')).toBe('知行合一');
  });

  it('空回复回退原话', () => {
    expect(parseQueryIntent('  \n ', '原话')).toBe('原话');
  });

  it('超长截断，别把一整段塞进检索', () => {
    const long = '知'.repeat(QUERY_INTENT_LIMIT + 50);
    expect(parseQueryIntent(long, '原话')).toHaveLength(QUERY_INTENT_LIMIT);
  });
});

describe('refineQuery', () => {
  it('模型正常时用改写后的检索词', async () => {
    const out = await refineQuery(async () => '知行合一 心学', '哪本书讲过知行合一');
    expect(out).toBe('知行合一 心学');
  });

  it('AI 抛错时静默回退原话，不打断搜索', async () => {
    const out = await refineQuery(async () => {
      throw new Error('接口挂了');
    }, '原话');
    expect(out).toBe('原话');
  });

  it('AI 返回空时回退原话', async () => {
    const out = await refineQuery(async () => '', '原话');
    expect(out).toBe('原话');
  });
});
