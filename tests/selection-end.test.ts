import { describe, expect, it } from 'vitest';
import { endsSelection } from '../src/shell/selection-end';

/**
 * 哪些动作点完就算「这段字用完了」。
 *
 * 划线 / 双链 / 复制 / 存为名词 / 存为段落：结果已经落袋，选区留着只会挡住正文、
 * 在手机上继续挂着系统手柄和菜单。
 *
 * 想法 / 书摘 / AI 不算：面板要对照原文写，选区是参照物（桌面本来就故意留着）。
 * 点已有划线的 hl* 也不算：那一下本来就没有新选区。
 */
describe('endsSelection', () => {
  it('五个落袋动作：要收选区', () => {
    for (const act of ['selpen', 'selbilink', 'selcopy', 'selterm', 'selpassage']) {
      expect(endsSelection(act), act).toBe(true);
    }
  });

  it('开面板的三个：不收（要对照原文）', () => {
    for (const act of ['selidea', 'selquote', 'selai']) {
      expect(endsSelection(act), act).toBe(false);
    }
  });

  it('点已有划线的动作：一律不算', () => {
    for (const act of ['hlidea', 'hlquote', 'hlai', 'hlcopy', 'hlterm', 'hlpassage', 'hldel', 'copylink']) {
      expect(endsSelection(act), act).toBe(false);
    }
  });

  it('没点中 / 空动作：不算', () => {
    expect(endsSelection('')).toBe(false);
    expect(endsSelection(undefined as unknown as string)).toBe(false);
    expect(endsSelection('more')).toBe(false);
  });
});
