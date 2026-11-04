import { describe, expect, it } from 'vitest';
import { typographyFormHtml } from '../src/shell/overlay';

/**
 * 排版面板：字号 / 行距 / 页边距之外，上下边距要能单独调。
 *
 * 左右（`margin`）管的是「一行有多宽」，上下管的是「一页有多满」——
 * 手机上这两件事经常要分开调：栏宽由屏幕决定，上下留白却决定一屏能放多少行。
 * 以前上下是写死的（桌面 28/40、手机 18/48），谁都觉得不对，但谁也改不了。
 */
describe('排版面板', () => {
  it('有「上下边距」这一行', () => {
    const html = typographyFormHtml();
    expect(html).toContain('上下边距');
    expect(html).toContain('data-k="marginY"');
  });

  it('左右页边距还在，两档互不覆盖', () => {
    const html = typographyFormHtml();
    expect(html).toContain('data-k="margin"');
    expect(html).toContain('页边距');
  });

  it('滑块带范围与步长（拖到两端不越界）', () => {
    const html = typographyFormHtml();
    const tag = html.match(/<input[^>]*data-k="marginY"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('type="range"');
    expect(tag).toMatch(/min="\d+"/);
    expect(tag).toMatch(/max="\d+"/);
    expect(tag).toMatch(/step="\d+"/);
  });
});
