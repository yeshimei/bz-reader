import { describe, expect, it } from 'vitest';
import { wrapText } from '../src/shell/card-image';

/**
 * 书摘卡转图片是 canvas 手绘的——项目里没有任何 DOM 截图库
 * （poster 那张年报到今天也只有「复制文字版」）。
 *
 * 手绘唯一麻烦的地方是断行：中文没有空格，不能按 word 切。
 * 这里把断行抽成纯函数，画布只负责量宽度。
 */
describe('wrapText', () => {
  /** 每个字符固定 10px，方便算出「一行几个字」 */
  const measure = (s: string): number => s.length * 10;

  it('短句不拆行', () => {
    expect(wrapText('假作真时真亦假', 200, measure)).toEqual(['假作真时真亦假']);
  });

  it('中文按字断行，不留下超宽的一行', () => {
    /* 每字 10px、行宽 60px → 一行六个字 */
    const lines = wrapText('假作真时真亦假无为有处有还无', 60, measure);
    expect(lines).toEqual(['假作真时真亦', '假无为有处有', '还无']);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(60);
  });

  it('按段落断开，空行保留', () => {
    expect(wrapText('一\n\n二', 100, measure)).toEqual(['一', '', '二']);
  });

  it('全是空白时给一个空行（不能返回空数组，画布会除零）', () => {
    expect(wrapText('   ', 100, measure)).toEqual(['']);
  });

  it('单个字符比一行还宽时也要有输出（不丢字）', () => {
    expect(wrapText('长', 0, measure)).toEqual(['长']);
  });
});
