import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import type { FoliateTOCItem } from '../src/types/foliate';
import { viewSidebar, type SidebarView } from '../src/shell/render/sidebar';

/**
 * 侧栏两处真机反馈：
 *   1. 划线列表点一条 → 直接回原文，不再弹「标注」卡（那一层还得再点一次
 *      「回到原文」，等于把一步拆成两步）；
 *   2. 目录行右边的百分比是「第几项 / 共几项」估出来的，不是真实进度，
 *      放在每一行反而让人以为翻页有误差。
 */
function book(): ReaderBook {
  return {
    id: 'b1',
    meta: { title: '红楼梦', author: '曹雪芹' },
    fileRef: { vaultPath: 'Books/a.epub', format: 'epub' },
    reading: { position: { percent: 0.1 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: {
      highlights: [
        {
          id: 'm1',
          text: '假作真时真亦假',
          cfiRange: 'epubcfi(/6/4!/2/2,/1:0,/1:6)',
          chapterTitle: '第一回',
          color: 'amber',
          createdAt: 1,
        },
      ],
      excerpts: [],
      bookmarks: [],
    },
    addedAt: 1,
    updatedAt: 1,
  };
}

const toc: FoliateTOCItem[] = [
  { label: '第一回', href: 'a#1' },
  { label: '第二回', href: 'a#2' },
];

function view(patch: Partial<SidebarView> = {}, b: ReaderBook = book()): string {
  return viewSidebar({
    book: b,
    tab: 'toc',
    toc,
    activeLabel: '第一回',
    activeHref: 'a#1',
    aiLog: [],
    aiReady: false,
    aiProvider: '未配置',
    ...patch,
  });
}

describe('划线列表', () => {
  it('点一条直接跳原文（data-act 是 hljump，不是 hlcard）', () => {
    const html = view({ tab: 'highlights' });
    expect(html).toContain('data-act="hljump"');
    expect(html).not.toContain('data-act="hlcard"');
  });

  it('仍保留行内的删除按钮（带二次确认由 actions 负责）', () => {
    expect(view({ tab: 'highlights' })).toContain('data-act="delmark"');
  });
});

describe('页签 · 纯图标', () => {
  /* 定稿：页签不写字，四颗图标等分居中，名字靠 title / aria-label。
     文字+图标并排在 300px 的侧栏里要占掉一半宽度，图标反而变小。 */
  it('只画图标，不画文字标签', () => {
    const html = view();
    expect(html).toContain('data-tab="toc"');
    expect(html).not.toContain('>目录<');
    expect(html).not.toContain('>书签<');
  });

  it('图标用 Obsidian 原生那套（bzs-ico-native）', () => {
    expect(view()).toContain('bzs-ico-native');
  });

  it('名字仍然留在 title / aria-label 上', () => {
    const html = view();
    expect(html).toContain('title="目录"');
    expect(html).toContain('aria-label="目录"');
  });
});

describe('AI 页签', () => {
  /* 入口平权：基础版也保留 AI 页签，点进去是高级版说明/解锁，
     而不是让页签整个消失。 */
  it('页签始终包含 AI，不按版本过滤', () => {
    const html = view();
    expect(html).toContain('data-tab="ai"');
  });
});

describe('目录行', () => {
  it('不再画百分比', () => {
    const html = view();
    expect(html).not.toContain('class="pc"');
    expect(html).not.toContain('%');
  });

  it('当前章仍然只有一行高亮', () => {
    const html = view();
    expect(html.match(/bzs-chaprow on/g)?.length).toBe(1);
  });

  it('章节标题照常显示（剥掉书自带的序号）', () => {
    const html = view({ toc: [{ label: '第一章 甄士隐梦幻识通灵', href: 'a#1' }] });
    expect(html).toContain('甄士隐梦幻识通灵');
  });
});

describe('目录折叠', () => {
  const tree: FoliateTOCItem[] = [
    {
      label: '第一卷',
      href: 'a#1',
      subitems: [
        { label: '第一章 甄士隐梦幻识通灵', href: 'a#1-1' },
        { label: '第二章 贾夫人仙逝扬州城', href: 'a#1-2' },
      ],
    },
    { label: '第二卷', href: 'a#2' },
  ];

  it('有子目录的行带折叠按钮', () => {
    expect(view({ toc: tree })).toContain('data-act="toctoggle"');
  });

  it('没有子目录的行不显示折叠按钮（不留空位）', () => {
    expect(view({ toc: [{ label: '单章', href: 'a#9' }] })).not.toContain('data-act="toctoggle"');
  });

  /* 真机反馈：整本书的目录是一层平铺（没有任何可折叠项）时，每行左边还空着
     一枚隐藏的箭头位，标题整体往右缩，跟上面「共 N 节」的左边对不上。
     没有可折叠项就不画占位；目录真有两级时仍画——同级标题左边缘靠它对齐。 */
  it('目录没有任何子项时不画折叠占位（标题与「共 N 节」左对齐）', () => {
    expect(view({ toc })).not.toContain('class="tw');
  });

  it('目录里有子项时，无子项的行仍留同宽占位（同级标题左对齐）', () => {
    expect(view({ toc: tree })).toContain('class="tw is-empty"');
  });

  it('默认展开：子章节都渲染出来', () => {
    const html = view({ toc: tree });
    expect(html).toContain('第一章 甄士隐梦幻识通灵');
    expect(html).toContain('第二章 贾夫人仙逝扬州城');
  });

  it('折叠后只藏子项，父项还在（还能点回去）', () => {
    const html = view({ toc: tree, collapsed: new Set(['a#1']) });
    expect(html).not.toContain('第一章 甄士隐梦幻识通灵');
    expect(html).toContain('第一卷');
  });

  it('折叠状态跟着 href 走，不误伤同名章节', () => {
    const html = view({ toc: tree, collapsed: new Set(['a#2']) });
    expect(html).toContain('第一章 甄士隐梦幻识通灵');
  });
});

describe('页签计数', () => {
  /* 真机反馈（2026-11-09）：目录页签右上角的数字没有意义——它是「这本书
     有多少节」，跟「我要去哪一章」无关，还和图标抢地方。去掉之后只留书签
     与划线两个数：那两个是「我在这本书里留过多少东西」，值得看。
     样式改成实心铜点（见 sidebar.css），超过 99 收成 99+。 */

  function tabBtn(html: string, tab: string): string {
    const at = html.indexOf(`data-tab="${tab}"`);
    expect(at).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<button', at);
    return html.slice(start, html.indexOf('</button>', at));
  }

  function withHighlights(n: number): ReaderBook {
    const b = book();
    b.notes.highlights = Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      text: `划线 ${i}`,
      cfiRange: 'epubcfi(/6/4!/2/2,/1:0,/1:6)',
      chapterTitle: '第一回',
      color: 'amber',
      createdAt: i,
    }));
    return b;
  }

  it('目录页签不画数字', () => {
    expect(tabBtn(view({ tab: 'toc' }), 'toc')).not.toContain('class="n"');
  });

  it('书签与划线照常显示条数', () => {
    const html = view({ tab: 'highlights' }, withHighlights(3));
    expect(tabBtn(html, 'highlights')).toContain('<span class="n">3</span>');
  });

  it('超过 99 收成 99+，不然三位数会把页签挤歪', () => {
    const html = view({ tab: 'highlights' }, withHighlights(137));
    expect(tabBtn(html, 'highlights')).toContain('<span class="n">99+</span>');
    expect(tabBtn(html, 'highlights')).not.toContain('137');
  });
});

describe('书签列表', () => {
  function withBookmark(percent = 0.42): ReaderBook {
    const b = book();
    b.notes.bookmarks.push({
      id: 'k1',
      cfi: 'epubcfi(/6/4!/2/2,/1:0,/1:6)',
      percent,
      chapterTitle: '第一回',
      label: '葬花',
      createdAt: 1,
    });
    return b;
  }

  it('书签的百分比保留（书签是「读到这里」的坐标，有用）', () => {
    const html = view({ tab: 'bookmarks' }, withBookmark());
    expect(html).toContain('42%');
  });

  /* 真机反馈：书名、百分比、目录名挤在同一行，300px 的侧栏里三个都被截。
     目录名挪到第二行，第一行只留「书签名 + 百分比 + 删除」。 */
  it('目录名单独一行：第一行闭合的 .hd 之后才是 em', () => {
    const html = view({ tab: 'bookmarks' }, withBookmark());
    const row = html.slice(html.indexOf('class="bzs-mkrow"'));
    expect(row).toMatch(/class="hd"[\s\S]*?<\/div>\s*<em>/);
  });

  it('目录名不在第一行里', () => {
    const html = view({ tab: 'bookmarks' }, withBookmark());
    const row = html.slice(html.indexOf('class="bzs-mkrow"'));
    const head = row.slice(0, row.indexOf('</div>'));
    expect(head).not.toContain('第一回');
    expect(head).toContain('葬花');
  });
});
