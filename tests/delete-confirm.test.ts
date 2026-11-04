import { describe, expect, it } from 'vitest';
import { bookmarkDeleteHtml } from '../src/shell/reader-cards';

/**
 * 删除书签改成和删除划线同一套：先出一张小卡，把要删的东西摊开写清楚。
 *
 * 以前是「再点一次才删」——侧栏里连点两下和「一次没点准又补一下」
 * 几乎分不出来，而删除不可撤销。
 */
describe('删除书签确认卡', () => {
  const input = { id: 'k1', bookId: 'b1', label: '葬花', chapter: '第一回', bookTitle: '红楼梦' };

  it('把书签名、目录名、书名都写出来', () => {
    const { body } = bookmarkDeleteHtml(input);
    expect(body).toContain('葬花');
    expect(body).toContain('第一回');
    expect(body).toContain('红楼梦');
  });

  it('说明删除不可撤销', () => {
    expect(bookmarkDeleteHtml(input).body).toContain('不能撤销');
  });

  it('确认按钮是 delbmkdo，带上书签与书的 id', () => {
    const { foot } = bookmarkDeleteHtml(input);
    expect(foot).toContain('data-act="delbmkdo"');
    expect(foot).toContain('data-id="k1"');
    expect(foot).toContain('data-book="b1"');
  });

  it('取消按钮只是关掉卡片', () => {
    expect(bookmarkDeleteHtml(input).foot).toContain('data-act="close"');
  });

  it('没有目录名时不留下多余的间隔', () => {
    const { body } = bookmarkDeleteHtml({ ...input, chapter: '' });
    expect(body).not.toContain('·  ');
  });
});
