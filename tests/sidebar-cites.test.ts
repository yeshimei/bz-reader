import { describe, expect, it } from 'vitest';
import { viewSidebar } from '../src/shell/render/sidebar';

/**
 * 「引用」页签：谁引了这本书的哪一页。
 *
 * 三条规矩：
 *   1. 按页分组，页内按笔记列——用户看见的是页面上的虚线框，问的是「谁引的」；
 *   2. 行标题带笔记里写的别名（引的是哪句话），文件名往后靠；
 *   3. 「只看本页」把厚书的上百组折成一页，页内没引用就明说。
 */
function render(props: Record<string, unknown>): string {
  return viewSidebar({
    book: { id: 'b1', meta: { title: '论文' } },
    tab: 'cites',
    toc: [],
    aiLog: [],
    aiReady: false,
    aiProvider: '',
    ...props,
  } as never);
}

const ROWS = [
  { page: 3, sourcePath: '笔记/甲.md', label: '这段结论很关键' },
  { page: 3, sourcePath: '笔记/乙.md', label: '同上' },
  { page: 12, sourcePath: '笔记/丙.md', label: '方法部分', color: 'var(--bzr-hl-red)' },
];

describe('引用页签', () => {
  it('按页分组，页内列出每一处引用', () => {
    const html = render({ cites: ROWS, activePage: 3 });
    expect(html).toContain('第 3 页');
    expect(html).toContain('第 12 页');
    expect(html).toContain('2 处');
    expect(html).toContain('甲');
    expect(html).toContain('乙');
  });

  it('行里带笔记写的别名，和链接颜色', () => {
    const html = render({ cites: ROWS, activePage: 3 });
    expect(html).toContain('这段结论很关键');
    expect(html).toContain('var(--bzr-hl-red)');
  });

  it('「只看本页」把别的页折掉，开关显示为已打开', () => {
    const html = render({ cites: ROWS, activePage: 12, citesOnlyPage: true });
    expect(html).toContain('第 12 页');
    expect(html).not.toContain('第 3 页');
    expect(html).toContain('bzs-citeonly on');
  });

  it('本页没有被引用时说清楚，而不是退回全书', () => {
    const html = render({ cites: ROWS, activePage: 99, citesOnlyPage: true });
    expect(html).toContain('本页还没有被引用');
    expect(html).not.toContain('第 3 页');
  });

  it('没有当前页时不给开关（EPUB 没有页码）', () => {
    const html = render({ cites: ROWS, activePage: 0 });
    expect(html).not.toContain('bzs-citeonly');
  });

  it('空态只说没人引用，不再教用户在笔记里写 #page=', () => {
    /* 引导语会误导：只有从书里复制出来的定位链接才算引用，
       手写 `#page=` 是 PDF 的语法。 */
    const html = render({ cites: [] });
    expect(html).toContain('还没有笔记引用这本书。');
    expect(html).not.toContain('在笔记里写');
    expect(html).not.toContain('#page=');
  });
});

/**
 * EPUB 没有页码：按「章节」分组，行上带跳转定位（cfi）。
 * 章节名来自链接里的 `c=`，老链接没有就归到「其他位置」。
 */
describe('引用页签 · EPUB', () => {
  it('按章节分组，行上带跳转定位而不是页码', () => {
    const html = render({
      cites: [
        {
          sourcePath: '欢迎.md',
          label: '重印前记',
          chapter: '重印前记',
          locator: 'epubcfi(/6/10!/4/2/4,/1:124,/1:192)',
        },
        { sourcePath: '读书笔记/围城.md', label: '方鸿渐', chapter: '第一章', locator: 'epubcfi(/6/12!/4/2/2)' },
      ],
    });
    expect(html).toContain('重印前记');
    expect(html).toContain('第一章');
    expect(html).toContain('欢迎');
    expect(html).toContain('data-cfi="epubcfi(/6/10!/4/2/4,/1:124,/1:192)"');
    expect(html).not.toContain('data-page="');
    expect(html).not.toContain('bzs-citeonly');
  });

  it('没有章节名的引用归到「其他位置」', () => {
    const html = render({ cites: [{ sourcePath: 'a.md', locator: 'epubcfi(/6/2)' }] });
    expect(html).toContain('其他位置');
  });
});
