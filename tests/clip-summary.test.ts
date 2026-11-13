/**
 * 剪藏成书 · 摘要失败文案（2026-11-13 真机回归）。
 *
 * 真机：对一篇**已经存进剪藏本**的文章点「生成摘要」，弹出「这一篇没有
 * 可用的正文，生成不了摘要」——用户以为正文丢了。实际是门面只给订阅
 * 文章生成摘要，剪藏笔记的摘要在它自己的 frontmatter 里；门面返回
 * notFound，阅读器把 notFound 直接翻成了「没有正文」。
 *
 * 这里钉住两件事：
 *   · notFound 说的是「找不到这篇文章」，不再暗示正文丢失；
 *   · 剪藏笔记有准确的出口——去剪藏本里更新摘要。
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import { clipSummaryText } from '../src/data/clip-book';

afterEach(() => setLocale('zh'));

describe('剪藏成书 · 摘要失败文案', () => {
  it('notFound 说找不到这篇文章，不再说没有正文', () => {
    const text = clipSummaryText('notFound');
    expect(text).toContain('找不到');
    expect(text).not.toContain('没有可用的正文');
  });

  it('剪藏笔记有准确出口：摘要去剪藏本里更新', () => {
    const text = clipSummaryText('clipNote');
    expect(text).toContain('剪藏本');
    expect(text).toContain('摘要');
  });

  it('切到英文，剪藏笔记的出口也跟着换', () => {
    setLocale('en');
    expect(clipSummaryText('clipNote')).toMatch(/clipbook/i);
    setLocale('zh');
  });
});
