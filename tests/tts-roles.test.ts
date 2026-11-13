import { describe, expect, it } from 'vitest';
import { applyGenders, buildRoleMessages, parseRoleGenders } from '../src/core/tts-roles';
import type { ScriptSegment } from '../src/core/tts-script';

describe('角色标注 prompt', () => {
  it('段落带编号，system 要求只输出 JSON', () => {
    const msgs = buildRoleMessages([{ text: '他推开门。' }, { text: '“谁？”' }]);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('JSON');
    expect(msgs[1].content).toContain('[0] 他推开门。');
    expect(msgs[1].content).toContain('[1] “谁？”');
  });
});

describe('解析模型回答', () => {
  it('标准 JSON 数组', () => {
    expect(parseRoleGenders('[{"i":1,"gender":"f"}]', 3)).toEqual([null, 'f', null]);
  });

  it('包了代码块 / 多说一句也能解析', () => {
    const text = '好的：\n```json\n[{"i":0,"gender":"m"}]\n```';
    expect(parseRoleGenders(text, 2)).toEqual(['m', null]);
  });

  it('JSON 坏了就用正则逐条捞', () => {
    const text = '[{"i":0,"gender":"m"}, {"i":1,"gender":}]';
    expect(parseRoleGenders(text, 2)).toEqual(['m', null]);
  });

  it('越界编号、非法性别一律忽略', () => {
    expect(parseRoleGenders('[{"i":9,"gender":"f"},{"i":0,"gender":"x"}]', 2)).toEqual([null, null]);
  });
});

describe('把标注并回段', () => {
  const seg = (kind: 'narration' | 'dialogue', blocks: number[]): ScriptSegment => ({
    kind,
    text: 'x',
    blocks,
  });

  it('合并过的段取第一个有标注的 block', () => {
    const out = applyGenders([seg('dialogue', [0, 2])], [null, null, 'f']);
    expect(out[0].gender).toBe('f');
  });

  it('u（不确定）不写进段，播放时按默认对白音色', () => {
    const out = applyGenders([seg('dialogue', [0])], ['u']);
    expect(out[0].gender).toBeUndefined();
  });

  it('旁白段不会被标性别', () => {
    const out = applyGenders([seg('narration', [0])], ['m']);
    expect(out[0].gender).toBeUndefined();
  });
});
