import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { addHighlight } from '../src/data/notes';
import {
  escapeForWikilink,
  parseWikilinkHref,
  subpathOf,
  unescapeForWikilink,
  wikilinkOf,
  wikilinkOfMark,
} from '../src/data/wikilink';

/**
 * 双链：`[[书.epub#bzr-cfi=epubcfi(…)|划线文字]]`。
 *
 * 书是 vault 里的真实文件，`[[]]` 能解析到它（不要求是 .md），
 * 所以不需要占位笔记。`#` 后面挂定位串，点击由 post-processor 拦下来
 * 交给阅读器——这一步是 obsidian:// 那条路拿不到的反链收益。
 */

function bookWithHighlight(text: string, chapterTitle?: string, cfi = 'epubcfi(/6/4)') {
  const book = makeBook('书/测试书.epub', 'epub');
  book.meta.title = '测试书';
  const h = addHighlight(book, { text, cfiRange: cfi, chapterTitle });
  return { book, h };
}

/** 从 `[[路径#子路径|别名]]` 里拆出三段，顺便验证结构完整 */
function partsOf(link: string): { path: string; subpath: string; alias: string } {
  const m = link.match(/^\[\[([^#\]]+)#([^\]|]+)\|(.+)\]\]$/);
  expect(m, `不是合法的双链：${link}`).not.toBeNull();
  return { path: m![1], subpath: m![2], alias: m![3] };
}

describe('wikilinkOf · 划线双链', () => {
  it('路径是书的 vault 路径，别名是划线原文', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    const { path, alias } = partsOf(wikilinkOfMark(book, h));
    expect(path).toBe('书/测试书.epub');
    expect(alias).toBe('她转过身，没有回头');
  });

  it('subpath 带 cfi / 原文片段 / 章节，供三级降级使用', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    const { subpath } = partsOf(wikilinkOfMark(book, h));
    const params = new URLSearchParams(subpath.replace(/^bzr-/, '').replace(/&/g, '&'));
    expect(params.get('cfi')).toBe('epubcfi(/6/4)');
    expect(params.get('t')).toBe('她转过身，没有回头');
    expect(params.get('c')).toBe('第一章');
  });

  it('CFI 里的方括号与竖线被转义，链接不会被提前闭合', () => {
    const { book, h } = bookWithHighlight('一句话', undefined, 'epubcfi(/6/4[chap|01])');
    const link = wikilinkOfMark(book, h);
    expect(link).not.toContain('[chap');
    expect(link).not.toContain('|01');
    expect(partsOf(link).subpath).toContain('%5B');
  });

  it('别名里的竖线转义成 \\|，不会被当成别名分隔符', () => {
    const { book, h } = bookWithHighlight('A|B', '第一章');
    expect(partsOf(wikilinkOfMark(book, h)).alias).toBe('A\\|B');
  });

  it('多行划线压成一行，中文之间不额外留空格', () => {
    const { book, h } = bookWithHighlight('她转过身，\n没有回头', '第一章');
    expect(partsOf(wikilinkOfMark(book, h)).alias).toBe('她转过身，没有回头');
  });

  it('划线文字为空时用书名当别名', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    h.text = '   ';
    expect(partsOf(wikilinkOfMark(book, h)).alias).toBe('《测试书》');
  });

  it('没有 cfi 也能生成双链（只带原文片段，靠搜索降级）', () => {
    const book = makeBook('书/无定位.epub', 'epub');
    const h = addHighlight(book, { text: '没有定位的划线' });
    const { subpath } = partsOf(wikilinkOfMark(book, h));
    expect(subpath).not.toContain('cfi=');
    expect(subpath).toContain('t=');
  });
});

describe('parseWikilinkHref · 从链接地址还原定位', () => {
  it('解析自家双链：拿回 vault 路径与 CFI', () => {
    const { book, h } = bookWithHighlight('她转过身，没有回头', '第一章');
    const { path, subpath } = partsOf(wikilinkOfMark(book, h));
    const parsed = parseWikilinkHref(`${path}#${subpath}`);
    expect(parsed).not.toBeNull();
    expect(parsed!.vaultPath).toBe('书/测试书.epub');
    expect(parsed!.target.cfi).toBe('epubcfi(/6/4)');
    expect(parsed!.target.text).toBe('她转过身，没有回头');
    expect(parsed!.target.chapter).toBe('第一章');
  });

  it('往返：生成的链接解回来与原始定位一致', () => {
    const { book, h } = bookWithHighlight('A]B|C[D', '第三章', 'epubcfi(/6/8[ch|3])');
    const { path, subpath } = partsOf(wikilinkOfMark(book, h));
    const parsed = parseWikilinkHref(`${path}#${subpath}`);
    expect(parsed!.target.cfi).toBe('epubcfi(/6/8[ch|3])');
    expect(parsed!.target.text).toBe('A]B|C[D');
  });

  it('普通笔记链接不算：没有 # 或不是书文件', () => {
    expect(parseWikilinkHref('笔记/某条.md')).toBeNull();
    expect(parseWikilinkHref('笔记/某条.md#标题')).toBeNull();
    expect(parseWikilinkHref('书/测试书.epub#某个不认识的锚点')).toBeNull();
  });

  it('obsidian:// 老链接不走这条路', () => {
    expect(parseWikilinkHref('obsidian://bz-reader?book=x&cfi=y')).toBeNull();
  });

  it('空值不抛错', () => {
    expect(parseWikilinkHref('')).toBeNull();
    expect(parseWikilinkHref('#')).toBeNull();
    expect(parseWikilinkHref('#bzr-cfi=')).toBeNull();
  });

  it('Obsidian 把 # 编码成 %23 时也能解析（app:// 形式的 href）', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    const { path, subpath } = partsOf(wikilinkOfMark(book, h));
    const parsed = parseWikilinkHref(`${path}%23${subpath}`);
    expect(parsed).not.toBeNull();
    expect(parsed!.vaultPath).toBe('书/测试书.epub');
    expect(parsed!.target.cfi).toBe('epubcfi(/6/4)');
  });

  it('路径被 URL 编码时先解码再查书', () => {
    const { book, h } = bookWithHighlight('一句话', '第一章');
    const { path, subpath } = partsOf(wikilinkOfMark(book, h));
    const parsed = parseWikilinkHref(`${encodeURIComponent(path)}#${subpath}`);
    expect(parsed!.vaultPath).toBe('书/测试书.epub');
  });
});

describe('wikilink 转义', () => {
  it('只动会撑破语法的三个字符', () => {
    expect(escapeForWikilink('a[b]c|d')).toBe('a%5Bb%5Dc%7Cd');
    expect(escapeForWikilink('普通文字')).toBe('普通文字');
  });

  it('反转义能还原', () => {
    const raw = 'epubcfi(/6/4[chap|01])';
    expect(unescapeForWikilink(escapeForWikilink(raw))).toBe(raw);
  });
});

describe('subpathOf · 子路径拼装', () => {
  it('有 cfi 时以 bzr-cfi 开头', () => {
    expect(subpathOf({ cfi: 'epubcfi(/6/4)' }).startsWith('bzr-cfi=')).toBe(true);
  });

  it('没有 cfi 时以 bzr-t 开头', () => {
    expect(subpathOf({ text: '片段' }).startsWith('bzr-t=')).toBe(true);
  });

  it('参数值里的 & 与 = 被编码，不会串味', () => {
    const s = subpathOf({ cfi: 'epubcfi(/6/4)', text: 'a&b=c' });
    expect(s).not.toContain('a&b=c');
  });
});

describe('wikilinkOf · 划词双链', () => {
  it('拿选区文字与 cfi 拼双链', () => {
    const book = makeBook('书/测试书.epub', 'epub');
    const link = wikilinkOf(book, { text: '选中文字', cfiRange: 'epubcfi(/6/8)', chapterTitle: '第一章' });
    const { path, alias } = partsOf(link);
    expect(path).toBe('书/测试书.epub');
    expect(alias).toBe('选中文字');
    expect(parseWikilinkHref(`${path}#${partsOf(link).subpath}`)!.target.cfi).toBe('epubcfi(/6/8)');
  });
});
