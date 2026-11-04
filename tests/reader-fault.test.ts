import { describe, expect, it } from 'vitest';
import { faultHtml, loadingHtml } from '../src/view/reader-fault';

/**
 * 阅读页失败态（S13 定稿）。
 *
 * 读法固定：标题说结论，第二行说原因，动作最多三个；
 * 诊断信息收在下面，不抢视线；加载中不编造百分比。
 */

describe('faultHtml · 三种失败', () => {
  it('不在书架上：一句话 + 一颗「回书架」', () => {
    const html = faultHtml({
      icon: 'book',
      title: '这本书不在书架上',
      desc: '它可能被移出书架了。回书架重新打开一次。',
      actions: [{ label: '回书架', act: 'back' }],
    });
    expect(html).toContain('bzs-fault');
    expect(html).toContain('<b>这本书不在书架上</b>');
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('回书架');
  });

  it('找不到文件：「重新定位文件…」是主按钮，排在回书架/重试前面', () => {
    const html = faultHtml({
      icon: 'folder',
      title: '找不到这本书的文件',
      desc: '书架记录还在，但 Books/红楼梦.epub 已经不在了。',
      actions: [
        { label: '重新定位文件…', act: 'relocate', primary: true },
        { label: '回书架', act: 'back' },
        { label: '重试', act: 'retry' },
      ],
    });
    expect(html.indexOf('重新定位文件…')).toBeLessThan(html.indexOf('回书架'));
    expect(html.indexOf('回书架')).toBeLessThan(html.indexOf('重试'));
    expect(html).toContain('bzs-btn pri');
  });

  it('打不开：自检信息按「键 — 值」逐行列，不是一坨文字', () => {
    const html = faultHtml({
      icon: 'alert',
      title: '这本书打不开',
      desc: '这本书打不开：EPUB 的 container.xml 缺失或损坏。',
      diag: [
        { k: '平台', v: 'Windows · Obsidian 1.13.4' },
        { k: '阶段', v: 'unpack' },
        { k: 'iframe·blob', v: '可用' },
      ],
      actions: [
        { label: '重试', act: 'retry', primary: true },
        { label: '回书架', act: 'back' },
        { label: '复制自检信息', act: 'copydiag' },
      ],
    });
    expect(html).toContain('bzs-fault-diag');
    expect(html.match(/<span class="k">/g)?.length).toBe(3);
    expect(html).toContain('阶段');
    expect(html).toContain('unpack');
  });

  it('没有自检信息时不渲染空的诊断框', () => {
    const html = faultHtml({ icon: 'book', title: 'x', desc: 'y', actions: [] });
    expect(html).not.toContain('bzs-fault-diag');
  });

  it('标题与说明里的尖括号被转义（书里可能带古怪文件名）', () => {
    const html = faultHtml({ icon: 'book', title: '<b>', desc: 'a<b>c', actions: [] });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b></b>');
  });
});

describe('loadingHtml', () => {
  it('只说正在打开哪本，不编造百分比', () => {
    const html = loadingHtml('红楼梦');
    expect(html).toContain('正在打开《红楼梦》…');
    expect(html).not.toMatch(/\d+%/);
    expect(html).toContain('spin');
  });
});
