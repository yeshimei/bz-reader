import { describe, expect, it } from 'vitest';
import { ocrBarAutoHide, ocrBarHtml, ocrBarProgress, type OcrBarStage } from '../src/view/ocr-bar';

/* 底部识别控制条：纯函数，状态进、HTML 出。
   断言的是「用户能看到什么」——第几页、认了几页、有没有停止/重试/收起。 */

const running: OcrBarStage = { kind: 'running', page: 47, done: 3, total: 20 };

describe('运行态', () => {
  const html = ocrBarHtml({ stage: running, engine: 'http', recognized: 12, totalPages: 278 });

  it('说清正在认第几页、这一批到哪了', () => {
    expect(html).toContain('第 47 页');
    expect(html).toContain('3/20');
  });

  it('只给停止，不给收起', () => {
    expect(html).toContain('data-act="ocrstop"');
    expect(html).not.toContain('data-act="ocrclose"');
  });

  it('进度条跟着走', () => {
    expect(ocrBarProgress(3, 20)).toBe(15);
    expect(html).toContain('width:15%');
  });

  it('标出这次走的哪条通道', () => {
    expect(html).toContain('本地');
    expect(ocrBarHtml({ stage: running, engine: 'deepseek' })).toContain('DeepSeek');
  });
});

describe('单页完成', () => {
  const html = ocrBarHtml({ stage: { kind: 'page', page: 5, layout: true }, recognized: 13, totalPages: 278 });

  it('说这一页可以划词了', () => {
    expect(html).toContain('第 5 页可以划词了');
  });

  it('给收起、不给重试', () => {
    expect(html).toContain('data-act="ocrclose"');
    expect(html).not.toContain('data-act="ocrretry"');
  });

  it('带上这本书的已认数', () => {
    expect(html).toContain('已认 13/278');
  });
});

describe('单页只认出文字、没给位置', () => {
  const html = ocrBarHtml({ stage: { kind: 'page', page: 5, layout: false } });

  it('先说不影响搜索和朗读，再说暂时不能划词', () => {
    expect(html).toContain('不能划词');
    expect(html).toContain('搜索');
  });
});

describe('空白页', () => {
  const html = ocrBarHtml({ stage: { kind: 'page', page: 9, layout: true, empty: true } });

  it('当成正常结果说「没有文字」，不是失败', () => {
    expect(html).toContain('没有文字');
    expect(html).not.toContain('data-act="ocrretry"');
  });
});

describe('批量结束', () => {
  it('全成功：说认完几页，不给重试', () => {
    const html = ocrBarHtml({ stage: { kind: 'batch', pages: 20, failed: [] } });
    expect(html).toContain('认完 20 页');
    expect(html).not.toContain('data-act="ocrretry"');
  });

  it('有失败：列出页号并给重试', () => {
    const html = ocrBarHtml({ stage: { kind: 'batch', pages: 18, failed: [4, 9] } });
    expect(html).toContain('第 4、9 页');
    expect(html).toContain('重试 2 页');
    expect(html).toContain('data-act="ocrretry"');
  });

  it('失败原因只进 title，并转义', () => {
    const html = ocrBarHtml({
      stage: { kind: 'batch', pages: 1, failed: [3] },
      why: '<b>额度不够</b>',
    });
    expect(html).toContain('&lt;b&gt;额度不够&lt;/b&gt;');
    expect(html).not.toContain('<b>额度不够</b>');
  });
});

describe('停止', () => {
  const html = ocrBarHtml({ stage: { kind: 'stopped', pages: 14, failed: [] } });

  it('说已停止，并把认完的页数留下', () => {
    expect(html).toContain('已停止');
    expect(html).toContain('14');
  });
});

describe('单页失败', () => {
  const html = ocrBarHtml({ stage: { kind: 'page-failed', page: 6 } });

  it('说这一页没认出来，并给「重试这一页」', () => {
    expect(html).toContain('第 6 页没认出来');
    expect(html).toContain('重试这一页');
  });
});

describe('自动收起', () => {
  it('单页三种终态收，其余不收', () => {
    expect(ocrBarAutoHide({ kind: 'page', page: 1, layout: true })).toBe(true);
    expect(ocrBarAutoHide({ kind: 'page', page: 1, layout: false })).toBe(true);
    expect(ocrBarAutoHide({ kind: 'page', page: 1, layout: true, empty: true })).toBe(true);
    expect(ocrBarAutoHide({ kind: 'page-failed', page: 1 })).toBe(false);
    expect(ocrBarAutoHide({ kind: 'batch', pages: 3, failed: [] })).toBe(false);
    expect(ocrBarAutoHide({ kind: 'stopped', pages: 3, failed: [] })).toBe(false);
    expect(ocrBarAutoHide(running)).toBe(false);
  });
});

describe('进度百分比', () => {
  it('没总量就是 0，超额封顶 100，负数当 0', () => {
    expect(ocrBarProgress(3, 0)).toBe(0);
    expect(ocrBarProgress(30, 20)).toBe(100);
    expect(ocrBarProgress(-1, 20)).toBe(0);
    expect(ocrBarProgress(1, 3)).toBe(33);
  });
});

describe('条子本身', () => {
  it('每个状态都带得走的那层壳', () => {
    for (const stage of [
      running,
      { kind: 'page', page: 1, layout: true },
      { kind: 'page-failed', page: 1 },
      { kind: 'batch', pages: 1, failed: [] },
      { kind: 'stopped', pages: 1, failed: [] },
    ] as OcrBarStage[]) {
      expect(ocrBarHtml({ stage })).toContain('data-role="ocrbar"');
    }
  });
});
