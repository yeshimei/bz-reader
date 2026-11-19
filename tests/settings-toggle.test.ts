import { describe, expect, it } from 'vitest';
import { flipSetting } from '../src/shell/settings-toggle';

describe('flipSetting', () => {
  it('已知开关被翻转', () => {
    expect(flipSetting({ exportComments: false }, 'exportComments')).toEqual({ exportComments: true });
    expect(flipSetting({ exportComments: true }, 'exportComments')).toEqual({ exportComments: false });
  });

  it('未知 key 返回 null：不写盘也不重绘', () => {
    expect(flipSetting({ exportComments: false }, 'nope')).toBeNull();
  });

  it('「加入复习先选方式」也能翻：勾掉之后靠它恢复', () => {
    expect(flipSetting({ reviewAskMode: true }, 'reviewAskMode')).toEqual({ reviewAskMode: false });
    expect(flipSetting({ reviewAskMode: false }, 'reviewAskMode')).toEqual({ reviewAskMode: true });
  });

  it('不修改入参', () => {
    const s = { exportComments: false };
    flipSetting(s, 'exportComments');
    expect(s.exportComments).toBe(false);
  });
});
