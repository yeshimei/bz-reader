import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../src/data/settings';
import { describeOcrProbe, ocrProbe } from '../src/shell/ocr-probe';

/* 设置页那颗「测试连接」：把一次真实请求的结果说成三档，
   用户不用先去认一页才知道地址对不对。 */

function withOcr(patch: Partial<ReaderSettings['pdfOcr']>): ReaderSettings {
  return { ...DEFAULT_SETTINGS, pdfOcr: { ...DEFAULT_SETTINGS.pdfOcr, ...patch } };
}

describe('三档结果', () => {
  it('有文字也有行位置：能划词，报出行数', () => {
    const r = describeOcrProbe({ lines: [{ text: 'a' }, { text: 'b' }], layout: true, text: 'ab' });
    expect(r.level).toBe('ok');
    expect(r.message).toContain('2');
    expect(r.message).toContain('位置');
  });

  it('只有整页文字、没有行位置：能搜能读，不能划词', () => {
    const r = describeOcrProbe({ lines: [], layout: false, text: '一段字' });
    expect(r.level).toBe('text');
    expect(r.message).toContain('不能划词');
  });

  it('什么都没返回：算没通', () => {
    const r = describeOcrProbe({ lines: [], layout: false, text: '' });
    expect(r.level).toBe('fail');
  });
});

describe('还没填配置就直接说去哪填', () => {
  it('外部服务没地址', async () => {
    const r = await ocrProbe(withOcr({ engine: 'http', url: '' }), async () => null);
    expect(r.level).toBe('fail');
    expect(r.message).toContain('地址');
  });

  it('DeepSeek 没密钥', async () => {
    const r = await ocrProbe(withOcr({ engine: 'deepseek', apiKey: '' }), async () => null);
    expect(r.level).toBe('fail');
    expect(r.message).toContain('密钥');
  });
});

describe('出图失败', () => {
  it('当作没通，并说明这一页没生成图片', async () => {
    const r = await ocrProbe(withOcr({ engine: 'http', url: 'http://127.0.0.1:1224/api/ocr' }), async () => null);
    expect(r.level).toBe('fail');
    expect(r.message).not.toBe('');
  });
});
