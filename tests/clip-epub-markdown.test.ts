// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { collectImageRefs, escXhtml, markdownToXhtml } from '../src/data/clip-epub/markdown';

const render = (md: string, assets = {}) => markdownToXhtml(md, assets);

describe('markdownToXhtml · 块级', () => {
  it('标题、段落、转义', () => {
    expect(render('# 标题 & <x>')).toContain('<h1>标题 &amp; &lt;x&gt;</h1>');
    expect(render('两行\n同一段')).toBe('<p>两行\n同一段</p>');
    expect(render('第一段\n\n第二段')).toBe('<p>第一段</p>\n<p>第二段</p>');
  });

  it('无序与有序列表', () => {
    expect(render('- 一\n- 二')).toBe('<ul><li>一</li><li>二</li></ul>');
    expect(render('1. 一\n2. 二')).toBe('<ol><li>一</li><li>二</li></ol>');
  });

  it('引用递归渲染，代码块保留原文', () => {
    expect(render('> 引用 **粗**')).toBe('<blockquote><p>引用 <strong>粗</strong></p></blockquote>');
    expect(render('```ts\nconst a = 1 < 2;\n```')).toBe(
      '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
    );
  });

  it('分隔线与硬换行', () => {
    expect(render('---')).toBe('<hr/>');
    expect(render('上  \n下')).toContain('<br/>');
  });
});

describe('markdownToXhtml · 行内', () => {
  it('加粗、斜体、删除线、行内代码', () => {
    expect(render('**粗** *斜* ~~删~~ `代`')).toBe(
      '<p><strong>粗</strong> <em>斜</em> <del>删</del> <code>代</code></p>',
    );
  });

  it('链接只放行安全协议', () => {
    expect(render('[例](https://a.com/x)')).toBe('<p><a href="https://a.com/x">例</a></p>');
    expect(render('[坏](javascript:alert(1))')).toBe('<p>[坏](javascript:alert(1))</p>');
  });

  it('自动链接', () => {
    expect(render('<https://a.com>')).toBe('<p><a href="https://a.com">https://a.com</a></p>');
  });

  it('wikilink 退成可读文字', () => {
    expect(render('[[笔记/路径|别名]]')).toBe('<p>别名</p>');
    expect(render('[[笔记/路径]]')).toBe('<p>路径</p>');
  });
});

describe('markdownToXhtml · 图片', () => {
  it('外链图默认保留地址', () => {
    expect(render('![图](https://a.com/x.png)')).toBe('<p><img src="https://a.com/x.png" alt="图" /></p>');
  });

  it('外链图映射失败给文字占位，不留死链', () => {
    expect(render('![图](https://a.com/x.png)', { externalImage: () => null })).toContain(
      '<span class="bzr-img-missing">图</span>',
    );
  });

  it('本地 wikilink 图走映射；缺图占位', () => {
    expect(render('![[附件/a.png]]', { localImage: () => 'images/a.png' })).toBe(
      '<p><img src="images/a.png" alt="" /></p>',
    );
    expect(render('![[附件/a.png]]', { localImage: () => null })).toContain('bzr-img-missing');
  });

  it('collectImageRefs 去重收集两类图', () => {
    const refs = collectImageRefs('![a](https://a/1.png) ![a](https://a/1.png) ![[x.png]] ![[y.png]]');
    expect(refs.external).toEqual(['https://a/1.png']);
    expect(refs.local).toEqual(['x.png', 'y.png']);
  });
});

describe('escXhtml', () => {
  it('五个字符全转义', () => {
    expect(escXhtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
