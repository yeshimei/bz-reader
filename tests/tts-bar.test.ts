import { describe, expect, it } from 'vitest';
import { ttsBarHtml } from '../src/view/tts-bar';

describe('ttsBarHtml', () => {
  const html = ttsBarHtml({ paused: false });

  it('只有一排按钮，不再显示旁白/页数/费用/正在念的原文', () => {
    expect(html).not.toContain('bzr-ttsbar-head');
    expect(html).not.toContain('bzr-ttsbar-pos');
    expect(html).not.toContain('bzr-ttsbar-cost');
    expect(html).not.toContain('bzr-ttsbar-text');
    expect(html).not.toContain('元');
  });

  it('七个动作都在：上一段、暂停、停止、下一段、预生成、导出、朗读设置', () => {
    for (const act of ['ttsprev', 'ttstoggle', 'ttsstop', 'ttsnext', 'ttsprefetch', 'ttsexport', 'ttstune']) {
      expect(html).toContain(`data-act="${act}"`);
    }
  });

  it('图标走 data-icon 占位，交给 Obsidian 的 setIcon，不用 emoji 字符', () => {
    expect(html).toContain('data-icon="skip-back"');
    expect(html).toContain('data-icon="pause"');
    expect(html).toContain('data-icon="square"');
    expect(html).toContain('data-icon="skip-forward"');
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
});
