import { describe, expect, it } from 'vitest';
import { segHtml } from '../src/shell/render/seg';

/**
 * 分段按钮（2026-11-09 发版复核）。
 *
 * 设置页、排版浮层、统计页共用这一份结构；外层类名与动作由调用点给。
 */

describe('分段按钮', () => {
  it('当前值那一项带 on，其余不带', () => {
    const h = segHtml(
      [
        { v: 'all', k: '全部' },
        { v: 'today', k: '今天' },
      ],
      'today',
      { act: 'statsrange', cls: 'seg' },
    );
    expect(h).toBe(
      '<div class="seg"><button class="" data-act="statsrange" data-v="all">全部</button>' +
        '<button class="on" data-act="statsrange" data-v="today">今天</button></div>',
    );
  });

  it('设置项带 data-k，动作缺省是 setpref', () => {
    const h = segHtml([{ v: 'zh', k: '简体中文' }], 'zh', { name: 'language' });
    expect(h).toContain('class="bzs-seg"');
    expect(h).toContain('data-act="setpref" data-k="language" data-v="zh"');
    expect(h).toContain('class="on"');
  });

  it('没有 name 时不写空 data-k', () => {
    expect(segHtml([{ v: 'a', k: 'A' }], '')).not.toContain('data-k');
  });
});
