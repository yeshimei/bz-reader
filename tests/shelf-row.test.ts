import { describe, expect, it } from 'vitest';
import { shelfActionsHtml } from '../src/shell/render/shelf-row';

/**
 * 分类管理弹窗里每一类后面那组动作。
 *
 * 2026-11-09：改名与删除从文字胶囊改成图标钮。手机上一行被两颗胶囊
 * 吃掉大半宽度，名字稍长就只剩省略号；四个动作统一成方形图标后，
 * 「看得见的是形状，读得懂的是标签」——所以这组断言既查「没有文字」，
 * 也查「标签还在」。
 */
const labels = { up: '上移', down: '下移', rename: '改名', del: '删除' };

/** 去掉图标与标签后剩下的可见文字 */
function visibleText(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

describe('shelfActionsHtml', () => {
  it('四个动作都只画图标，按钮里没有可读文字', () => {
    const html = shelfActionsHtml('小说', labels);
    expect(html.match(/<svg/g)).toHaveLength(4);
    expect(visibleText(html)).toBe('');
  });

  it('文字挪进 title 与 aria-label：悬停看得见，读屏听得懂', () => {
    const html = shelfActionsHtml('小说', labels);
    for (const word of ['上移', '下移', '改名', '删除']) {
      expect(html).toContain(`title="${word}"`);
      expect(html).toContain(`aria-label="${word}"`);
    }
  });

  it('四个动作的点击标识不变，行内按钮仍靠它们找得到目标分类', () => {
    const html = shelfActionsHtml('小说', labels);
    expect(html).toContain('data-act="shelfmove"');
    expect(html).toContain('data-act="shelfrename"');
    expect(html).toContain('data-act="shelfdel"');
    expect(html.match(/data-name="小说"/g)).toHaveLength(4);
  });

  it('删除那颗是危险色，与改名区分开', () => {
    const html = shelfActionsHtml('小说', labels);
    const del = /<button[^>]*data-act="shelfdel"[^>]*>/.exec(html)?.[0] ?? '';
    expect(del).toContain('danger');
  });

  it('排序与整理两组之间有一道分隔，手指不会连点错', () => {
    const html = shelfActionsHtml('小说', labels);
    const sep = html.indexOf('class="sep"');
    expect(sep).toBeGreaterThan(html.indexOf('data-act="shelfmove"'));
    expect(sep).toBeGreaterThan(html.indexOf('data-v="down"'));
    expect(sep).toBeLessThan(html.indexOf('data-act="shelfrename"'));
  });

  it('分类名进 data-name 前要转义', () => {
    const html = shelfActionsHtml('a"b<c', labels);
    expect(html).toContain('data-name="a&quot;b&lt;c"');
  });
});
