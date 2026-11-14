import { describe, expect, it } from 'vitest';
import { ttsBarHtml, ttsSourceLabel } from '../src/view/tts-bar';

describe('ttsBarHtml', () => {
  const html = ttsBarHtml({ paused: false });

  it('只有一排按钮，不再显示旁白/页数/费用/正在念的原文', () => {
    expect(html).not.toContain('bzr-ttsbar-head');
    expect(html).not.toContain('bzr-ttsbar-pos');
    expect(html).not.toContain('bzr-ttsbar-cost');
    expect(html).not.toContain('bzr-ttsbar-text');
    expect(html).not.toContain('元');
  });

  /* 2026-11-14 收敛入口：常驻只留听得最顺手的四个，其余收进「更多」 */
  it('常驻只有四个：上一段、暂停、下一段、停止，外加一个「更多」', () => {
    for (const act of ['ttsprev', 'ttstoggle', 'ttsnext', 'ttsstop', 'ttsmore']) {
      expect(html).toContain(`data-act="${act}"`);
    }
  });

  it('预生成 / 导出 / 朗读设置收在「更多」里，默认收起', () => {
    for (const act of ['ttsprefetch', 'ttsexport', 'ttstune']) {
      expect(html).toContain(`data-act="${act}"`);
    }
    expect(html).toMatch(/data-role="ttsmore"[^>]*hidden/);
  });

  it('点开「更多」后面板展开，按钮本体还在', () => {
    const open = ttsBarHtml({ paused: false, more: true });
    expect(open).not.toMatch(/data-role="ttsmore"[^>]*hidden/);
    for (const act of ['ttsprefetch', 'ttsexport', 'ttstune']) {
      expect(open).toContain(`data-act="${act}"`);
    }
  });

  it('图标走 data-icon 占位，交给 Obsidian 的 setIcon，不用 emoji 字符', () => {
    expect(html).toContain('data-icon="skip-back"');
    expect(html).toContain('data-icon="pause"');
    expect(html).toContain('data-icon="square"');
    expect(html).toContain('data-icon="skip-forward"');
    expect(html).toContain('data-icon="more-horizontal"');
    for (const emoji of ['⏮', '⏸', '⏭', '■', '⤓', '⭳', '▶']) {
      expect(html).not.toContain(emoji);
    }
  });

  it('暂停时主按钮换成「继续」（播放图标）', () => {
    const paused = ttsBarHtml({ paused: true });
    expect(paused).toContain('data-icon="play"');
    expect(paused).not.toContain('data-icon="pause"');
    expect(paused).toContain('is-main');
  });

  it('等待音频时主按钮转圈，不再是暂停图标', () => {
    const loading = ttsBarHtml({ paused: false, loading: true });
    expect(loading).toContain('is-loading');
    expect(loading).toContain('bzr-ttsspin');
    expect(loading).not.toContain('data-icon="pause"');
    expect(loading).not.toContain('data-icon="play"');
  });

  /* 来源徽标：缓存 / 离线 / 实时，可能混着来（一章里一半命中一半要现合） */
  it('有来源说明时把它画在最左边，没有就整块不出现', () => {
    const withSrc = ttsBarHtml({ paused: false, source: '缓存 12 · 实时 3' });
    expect(withSrc).toContain('bzr-ttssrc');
    expect(withSrc).toContain('缓存 12 · 实时 3');
    expect(html).not.toContain('bzr-ttssrc');
  });

  it('来源说明里的尖括号被转义，不会被当成标签', () => {
    const bad = ttsBarHtml({ paused: false, source: '<img src=x>' });
    expect(bad).not.toContain('<img');
    expect(bad).toContain('&lt;img');
  });
});

/* 用户要知道「这段声音是存的还是刚花钱合的」 */
describe('ttsSourceLabel', () => {
  it('离线包：只说离线，不混缓存/实时', () => {
    expect(ttsSourceLabel({ cached: 9, live: 4, offline: 1 })).toBe('离线');
  });

  it('全命中缓存：只报缓存多少段', () => {
    expect(ttsSourceLabel({ cached: 12, live: 0, offline: 0 })).toBe('缓存 12');
  });

  it('全现合：只报实时多少段', () => {
    expect(ttsSourceLabel({ cached: 0, live: 3, offline: 0 })).toBe('实时 3');
  });

  it('一半缓存一半现合：两条都写，用间隔点分开', () => {
    expect(ttsSourceLabel({ cached: 12, live: 3, offline: 0 })).toBe('缓存 12 · 实时 3');
  });

  it('还没开始：空串，浮条上不留空壳', () => {
    expect(ttsSourceLabel({ cached: 0, live: 0, offline: 0 })).toBe('');
  });
});
