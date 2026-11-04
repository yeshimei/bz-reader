import { describe, expect, it } from 'vitest';
import { bookmarkDeleteHtml, markDeleteBarHtml } from '../src/shell/reader-cards';

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

/**
 * 桌面端从文字工具框点「删除」：和想法 / 书摘同一列——一条确认条贴在
 * 工具条上方，不再压一层遮罩、弹一张带标题的大卡。
 *
 * 这条形状定下来之后，工具条位置不动（整块底边仍贴着划线），
 * 用户点完删除不用重新找按钮。
 */
describe('桌面删除划线的确认条', () => {
  const input = { id: 'm1', bookId: 'b1', hasIdea: true };

  it('是一行条，不是一张卡', () => {
    const html = markDeleteBarHtml(input);
    expect(html).toContain('bzs-del-bar');
    expect(html).not.toContain('bzs-qcard');
  });

  it('说清楚删的是划线、想法会一起删掉', () => {
    expect(markDeleteBarHtml(input)).toContain('删除这条划线？想法会一起删掉。');
  });

  it('没有想法时不提想法', () => {
    const html = markDeleteBarHtml({ ...input, hasIdea: false });
    expect(html).toContain('删除这条划线？');
    expect(html).not.toContain('想法');
  });

  it('取消只是关掉，删除带 delmarkdo 与这条划线的 id', () => {
    const html = markDeleteBarHtml(input);
    expect(html).toContain('data-act="close"');
    expect(html).toContain('data-act="delmarkdo"');
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
  });

  it('删除用危险色、排在最后', () => {
    const html = markDeleteBarHtml(input);
    expect(html).toContain('class="danger" data-act="delmarkdo"');
    expect(html.indexOf('data-act="close"')).toBeLessThan(html.indexOf('data-act="delmarkdo"'));
  });
});
