import { describe, expect, it } from 'vitest';
import { typographyFormHtml } from '../src/shell/overlay';

/**
 * 排版面板：字号 / 行距 / 页边距。
 *
 * 「上下边距」那一档已经撤掉——留白回到写死值（桌面 28/40、手机 18/48），
 * 面板里不再给滑块。老数据里残留的 marginY 由 normalizePrefs 丢掉。
 */
describe('排版面板', () => {
  it('不再有「上下边距」这一行', () => {
    const html = typographyFormHtml();
    expect(html).not.toContain('上下边距');
    expect(html).not.toContain('data-k="marginY"');
  });

  it('左右页边距还在', () => {
    const html = typographyFormHtml();
    expect(html).toContain('data-k="margin"');
    expect(html).toContain('页边距');
  });

  it('页边距滑块带范围与步长（拖到两端不越界）', () => {
    const html = typographyFormHtml();
    const tag = html.match(/<input[^>]*data-k="margin"[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('type="range"');
    expect(tag).toMatch(/min="\d+"/);
    expect(tag).toMatch(/max="\d+"/);
    expect(tag).toMatch(/step="\d+"/);
  });
});
