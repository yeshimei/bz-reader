/**
 * 脚注：判定、定位与正文提取（engine/footnote.ts）。
 *
 * 这几组断言对应真机上「点注释号没反应 / 读不出正文」的几条路：
 *   · EPUB 3 的 `epub:type="noteref"` 在不同解析路径下可能只剩字面属性；
 *   · 中文出版物的序号是「注1」「[1]」「①」；
 *   · 目标 id 常打在 `<li>` / `<aside>` 上，也可能错打在回链 `<sup>` 里；
 *   · 回链（↩）必须从正文里剔掉，否则浮窗里只有一串箭头。
 */
import { describe, it, expect } from 'vitest';
import {
  chooseSectionIndex,
  domToFNode,
  findFragmentTarget,
  isFootnoteRef,
  matchSectionIndex,
  resolveFootnoteText,
  splitFootnoteHref,
  type FNode,
} from '../src/engine/footnote';

/* ── 测试用最小节点树：与 DOM 无关，只保留脚注逻辑需要的那点结构 ── */

function attach(node: FNode, parent: FNode): FNode {
  node.parent = parent;
  for (const child of node.children ?? []) attach(child, node);
  return node;
}

function el(tag: string, attrs: Record<string, string> = {}, ...children: Array<FNode | string>): FNode {
  const node: FNode = { tag, attrs, children: [] };
  for (const child of children) {
    node.children!.push(attach(typeof child === 'string' ? { tag: '#text', text: child } : child, node));
  }
  return node;
}

function anchor(attrs: Record<string, string>, label = '', ancestors: string[] = []): FNode {
  return { tag: 'a', attrs, children: [{ tag: '#text', text: label }], ancestors };
}

describe('isFootnoteRef：点到的这个 <a> 是不是脚注引用', () => {
  it('EPUB 3 规范写法：epub:type="noteref"（字面属性也要认）', () => {
    expect(isFootnoteRef(anchor({ 'epub:type': 'noteref', href: 'notes.xhtml#n1' }, '1'))).toBe(true);
  });

  it('epub:type="footnote"（不带 ref 的写法）', () => {
    expect(isFootnoteRef(anchor({ 'epub:type': 'footnote', href: 'notes.xhtml#n1' }, '1'))).toBe(true);
  });

  it('role="doc-noteref"', () => {
    expect(isFootnoteRef(anchor({ role: 'doc-noteref', href: '#n1' }, '1'))).toBe(true);
  });

  it('链接文字不是序号，但 href 片段是 fn1：仍然认', () => {
    expect(isFootnoteRef(anchor({ href: 'notes.xhtml#fn1' }, '脚注'))).toBe(true);
  });

  it('href 路径里带 notes：仍然认', () => {
    expect(isFootnoteRef(anchor({ href: '../Text/notes.xhtml#n12' }, '脚注'))).toBe(true);
  });

  it('同文件锚点 #n3 + 序号文字', () => {
    expect(isFootnoteRef(anchor({ href: '#n3' }, '3'))).toBe(true);
  });

  it('中文出版物的「注1」', () => {
    expect(isFootnoteRef(anchor({ href: '#zzz' }, '注1'))).toBe(true);
  });

  it('圈号 ①', () => {
    expect(isFootnoteRef(anchor({ href: '#abc' }, '①'))).toBe(true);
  });

  it('被 <sup> 包着的老写法', () => {
    expect(isFootnoteRef(anchor({ href: '#x9' }, '甲', ['sup']))).toBe(true);
  });

  it('片段是 note-1', () => {
    expect(isFootnoteRef(anchor({ href: '#note-1' }, ''))).toBe(true);
  });

  it('章节互链不算脚注', () => {
    expect(isFootnoteRef(anchor({ href: 'chapter2.xhtml#c1' }, '第二章'))).toBe(false);
  });

  it('没有 # 的链接不算脚注', () => {
    expect(isFootnoteRef(anchor({ href: 'chapter2.xhtml' }, '1'))).toBe(false);
  });

  it('外链不算脚注（即使文字是序号）', () => {
    expect(isFootnoteRef(anchor({ href: 'https://example.com/#a' }, '1'))).toBe(false);
    expect(isFootnoteRef(anchor({ href: 'mailto:a@b.c#x' }, '1'))).toBe(false);
  });

  it('没有任何线索的链接不算', () => {
    expect(isFootnoteRef(anchor({ href: '#weird' }, '点击这里'))).toBe(false);
  });

  it('null 安全', () => {
    expect(isFootnoteRef(null)).toBe(false);
  });
});

describe('splitFootnoteHref：href 拆路径与片段', () => {
  it('普通拆分', () => {
    expect(splitFootnoteHref('Text/notes.xhtml#fn1')).toEqual({ path: 'Text/notes.xhtml', fragment: 'fn1' });
  });

  it('没有 # 时片段为空', () => {
    expect(splitFootnoteHref('Text/notes.xhtml')).toEqual({ path: 'Text/notes.xhtml', fragment: '' });
  });

  it('片段做 URL 解码', () => {
    expect(splitFootnoteHref('#%E6%B3%A8%E4%B8%80')).toEqual({ path: '', fragment: '注一' });
  });

  it('坏编码不抛异常', () => {
    expect(() => splitFootnoteHref('#%E6%B3')).not.toThrow();
  });
});

describe('findFragmentTarget：在文档里找 fragment 指向的元素', () => {
  const byIdDoc = {
    getElementById: (id: string) => (id === 'fn1' ? { id: 'fn1' } : null),
    getElementsByTagName: () => [],
  };

  it('先查 id', () => {
    expect(findFragmentTarget(byIdDoc, 'fn1')).toEqual({ id: 'fn1' });
  });

  it('查不到 id 时按 name / xml:id 遍历', () => {
    const named = {
      getElementById: () => null,
      getElementsByTagName: () => [
        { getAttribute: (k: string) => (k === 'name' ? 'n7' : null) },
        { getAttribute: (k: string) => (k === 'xml:id' ? 'x8' : null) },
      ],
    };
    expect(findFragmentTarget(named, 'n7')).toEqual({ getAttribute: expect.any(Function) });
    expect(findFragmentTarget(named, 'x8')).not.toBeNull();
  });

  it('空片段 / 找不到 → null', () => {
    expect(findFragmentTarget(byIdDoc, '')).toBeNull();
    expect(findFragmentTarget(byIdDoc, 'missing')).toBeNull();
  });
});

describe('matchSectionIndex：href 与章节对位', () => {
  const sections = [{ id: 'Text/ch1.xhtml' }, { id: 'Text/notes.xhtml' }, { id: 'Text/ch3.xhtml' }];

  it('精确匹配', () => {
    expect(matchSectionIndex(sections, 'Text/notes.xhtml')).toBe(1);
  });

  it('相对路径按文件名对上', () => {
    expect(matchSectionIndex(sections, '../Text/notes.xhtml')).toBe(1);
  });

  it('带前导 ./ 也能对', () => {
    expect(matchSectionIndex(sections, './Text/notes.xhtml')).toBe(1);
  });

  it('找不到时 -1', () => {
    expect(matchSectionIndex(sections, 'Text/missing.xhtml')).toBe(-1);
    expect(matchSectionIndex(sections, '')).toBe(-1);
  });

  it('URL 编码的路径也能对上', () => {
    const coded = [{ id: 'Text/注释.xhtml' }];
    expect(matchSectionIndex(coded, 'Text/%E6%B3%A8%E9%87%8A.xhtml')).toBe(0);
  });
});

describe('chooseSectionIndex：先按 href 对，再当前章，最后 foliate 的下标', () => {
  const sections = [{ id: 'Text/ch1.xhtml' }, { id: 'Text/ch2.xhtml' }, { id: 'Text/notes.xhtml' }];

  it('href 带路径：按 section.id 对上', () => {
    expect(
      chooseSectionIndex({ sections, path: 'Text/notes.xhtml', currentIndex: 0, resolvedIndex: -1 }),
    ).toBe(2);
  });

  it('只有 #fragment：在当前章节找，别全书乱扫', () => {
    expect(chooseSectionIndex({ sections, path: '', currentIndex: 1, resolvedIndex: -1 })).toBe(1);
  });

  it('路径对不上时退回 foliate 的 spine 下标', () => {
    expect(
      chooseSectionIndex({ sections, path: 'OEBPS/Text/x.xhtml', currentIndex: -1, resolvedIndex: 2 }),
    ).toBe(2);
  });

  it('都对不上 → -1', () => {
    expect(chooseSectionIndex({ sections, path: 'Text/missing.xhtml', currentIndex: -1, resolvedIndex: -1 })).toBe(-1);
  });
});

describe('resolveFootnoteText：从目标元素里抠出注文', () => {
  it('标准 <li>：取正文、剔掉回链', () => {
    const li = el(
      'li',
      { id: 'fn1' },
      el('p', {}, '这是注释正文。'),
      el('a', { class: 'footnote-backref', href: '#fnref1' }, '↩'),
    );
    expect(resolveFootnoteText(li, '1')).toBe('这是注释正文。');
  });

  it('id 错打在回链上：向上找 <li>，不能只返回箭头', () => {
    const li = el(
      'li',
      {},
      el('a', { id: 'fn5', class: 'footnote-backref', href: '#fnref5' }, '↩'),
      el('p', {}, '回链先出现，正文在后面。'),
    );
    expect(resolveFootnoteText(li.children![0], '5')).toBe('回链先出现，正文在后面。');
  });

  it('id 打在整页容器上：只取一条，不能把整章注文都塞进浮窗', () => {
    const notes = el(
      'section',
      { id: 'notes', class: 'notes' },
      el('li', { id: 'fn1' }, '1 注文一。', el('a', { href: '#fnref1' }, '↩')),
      el('li', { id: 'fn2' }, '2 注文二。', el('a', { href: '#fnref2' }, '↩')),
      el('li', { id: 'fn3' }, '3 注文三。', el('a', { href: '#fnref3' }, '↩')),
    );
    const text = resolveFootnoteText(notes, '1');
    expect(text).toBe('注文一。');
    expect(text).not.toContain('注文二');
  });

  it('红楼梦式结构：空锚点 <a id="m42"> + [42] 回链 + 注文（真机回归）', () => {
    const note = el(
      'p',
      { class: 'note' },
      el('a', { id: 'm42' }),
      el('a', { href: 'part0011.xhtml#w42' }, '[42]'),
      ' 运隆祚永——国运兴隆，皇位传世久远。',
    );
    const target = note.children![0];
    expect(resolveFootnoteText(target, '[42]')).toBe('运隆祚永——国运兴隆，皇位传世久远。');
  });

  it('去掉注文前面的序号（含括号与点号）', () => {
    const li = el('li', {}, el('p', {}, '1. 注文内容'));
    expect(resolveFootnoteText(li, '1')).toBe('注文内容');

    const li2 = el('li', {}, el('p', {}, '[12] 另一条'));
    expect(resolveFootnoteText(li2, '[12]')).toBe('另一条');
  });

  it('只剩回链 → null', () => {
    const li = el('li', {}, el('a', { href: '#fnref3' }, '↩'));
    expect(resolveFootnoteText(li, '3')).toBeNull();
  });

  it('空容器 → null', () => {
    expect(resolveFootnoteText(el('li', {}), '1')).toBeNull();
  });

  it('多段落之间留空格，不黏成一串', () => {
    const li = el('li', {}, el('p', {}, '第一段'), el('p', {}, '第二段'));
    expect(resolveFootnoteText(li, '1')).toBe('第一段 第二段');
  });

  it('语义容器 <aside epub:type="footnote"> 优先于外层 div', () => {
    const wrap = el(
      'div',
      { id: 'fn4' },
      el('aside', { 'epub:type': 'footnote' }, el('p', {}, '旁注正文')),
      el('p', {}, '同层的别的内容'),
    );
    expect(resolveFootnoteText(wrap, '4')).toBe('旁注正文');
  });

  it('超长注文截断到 220 字并加省略号', () => {
    const long = '注'.repeat(300);
    const li = el('li', {}, el('p', {}, long));
    const text = resolveFootnoteText(li, '1')!;
    expect(text.length).toBe(221);
    expect(text.endsWith('…')).toBe(true);
  });

  it('空白归一：换行与连续空格压成一个空格', () => {
    const li = el('li', {}, el('p', {}, '第一行\n\n第二行   第三行'));
    expect(resolveFootnoteText(li, '1')).toBe('第一行 第二行 第三行');
  });
});

describe('domToFNode：真实元素转成可测的节点树', () => {
  type FakeDomEl = {
    nodeType: number;
    tagName: string;
    parentElement: FakeDomEl | null;
    childNodes: unknown[];
    attributes: Array<{ name: string; value: string }>;
    getAttribute(name: string): string | null;
    getAttributeNS(): string | null;
  };

  function fakeEl(tag: string, attrs: Record<string, string>, children: unknown[] = []): unknown {
    return {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
      childNodes: children,
      getAttribute(tag: string) {
        return attrs[tag] ?? null;
      },
      getAttributeNS() {
        return null;
      },
    };
  }

  function domEl(tag: string, attrs: Record<string, string> = {}, ...children: Array<FakeDomEl | string>): FakeDomEl {
    const el: FakeDomEl = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      parentElement: null,
      childNodes: [],
      attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      getAttributeNS() {
        return null;
      },
    };
    for (const child of children) {
      if (typeof child === 'string') {
        el.childNodes.push({ nodeType: 3, nodeValue: child, parentElement: el });
      } else {
        child.parentElement = el;
        el.childNodes.push(child);
      }
    }
    return el;
  }

  it('保留属性（小写）、文本子节点与结构', () => {
    const textNode = { nodeType: 3, nodeValue: '1' };
    const dom = fakeEl('A', { HREF: 'notes.xhtml#fn1' }, [textNode]);
    const node = domToFNode(dom as Element);
    expect(node.tag).toBe('a');
    expect(node.attrs?.href).toBe('notes.xhtml#fn1');
    expect(node.children?.[0]).toEqual(expect.objectContaining({ tag: '#text', text: '1' }));
  });

  it('带上祖先标签（判断 sup 包裹用）', () => {
    const dom = fakeEl('A', { href: '#x' }, [{ nodeType: 3, nodeValue: '甲' }]);
    const node = domToFNode(dom as Element, { ancestors: ['sup'] });
    expect(node.ancestors).toEqual(['sup']);
  });

  it('不传 context 时只有目标自己的子树——空锚点抠不出正文（真机 bug 的形态）', () => {
    const anchorEl = domEl('a', { id: 'm42' });
    const note = domEl(
      'p',
      { class: 'note' },
      anchorEl,
      domEl('a', { href: 'part0011.xhtml#w42' }, '[42]'),
      ' 运隆祚永——国运兴隆，皇位传世久远。',
    );
    domEl('div', { class: 'notes' }, note);
    const lone = domToFNode(anchorEl as unknown as Element);
    expect(resolveFootnoteText(lone, '[42]')).toBeNull();
  });

  it('context 模式：向上带上注文容器与兄弟，正文抠得出来（红楼梦中点 [42]）', () => {
    const anchorEl = domEl('a', { id: 'm42' });
    const note = domEl(
      'p',
      { class: 'note' },
      anchorEl,
      domEl('a', { href: 'part0011.xhtml#w42' }, '[42]'),
      ' 运隆祚永——国运兴隆，皇位传世久远。',
    );
    const wrap = domEl('div', { class: 'notes' }, note);
    domEl('body', {}, wrap);

    const node = domToFNode(anchorEl as unknown as Element, { context: true });
    expect(node.parent?.tag).toBe('p');
    expect(resolveFootnoteText(node, '[42]')).toBe('运隆祚永——国运兴隆，皇位传世久远。');
  });

  it('context 模式不越过 body（不会把整章正文当候选）', () => {
    const anchorEl = domEl('a', { id: 'm1' });
    const note = domEl('p', { class: 'note' }, anchorEl, '注文');
    const body = domEl('body', {}, domEl('div', {}, domEl('section', {}, note)));
    const node = domToFNode(anchorEl as unknown as Element, { context: true });
    expect(node.parent?.tag).toBe('p');
    expect(body.parentElement).toBeNull();
  });
});
