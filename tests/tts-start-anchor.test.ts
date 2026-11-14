/* ============================================================
 * bz-reader · 起播定位（2026-11-14）
 *
 * 「从这一页开始念」= 把「屏幕上第一个字」翻译成「整章脚本第几句、句内第几个字」。
 *
 * 以前靠拿页首十几个字去整章正文里搜同一句话，跨页段落、短标题、残句都搜不到，
 * 静默回到第 0 句——真机表现就是「站在第 20 页点朗读，它从第一章开头念」。
 * 现在改成用块序号 + 块内偏移，这里把边界情况逐条钉住。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { buildScript, startFromAnchor } from '../src/core/tts-script';

/** 两段：第一段短，第二段长；原文里带空格，验证 skip 不计空白 */
const BLOCKS = [
  { tag: 'h2', text: '序', raw: '序' },
  {
    tag: 'p',
    text: '在这本书里，我想写现代中国某一部分社会。写这类人，我没忘记他们是人类。',
    raw: '在这本书里，我想写现代中国某一部分社会。写这类人，我没忘记他们是人类。',
  },
  { tag: 'p', text: '角色当然是虚构的。', raw: '角色当然是虚构的。' },
];

const SEGMENTS = buildScript(BLOCKS);

describe('startFromAnchor', () => {
  it('页首在第二段第一句开头：落到该句，不跳字', () => {
    const got = startFromAnchor(SEGMENTS, BLOCKS, { block: 1, offset: 0 });
    expect(got).toEqual({ index: 1, skip: 0 });
  });

  it('页首在段中间：落到这一句，并按字数折出句内跳几个字', () => {
    const raw = BLOCKS[1].raw;
    const at = raw.indexOf('写这类人');
    const got = startFromAnchor(SEGMENTS, BLOCKS, { block: 1, offset: at });
    const index = SEGMENTS.findIndex((s) => s.text.startsWith('写这类人'));
    expect(got).toEqual({ index, skip: 0 });
  });

  it('页首落在句子中间：skip 是「这句话里跳过几个字」，不是原文偏移', () => {
    const raw = BLOCKS[1].raw;
    const at = raw.indexOf('现代中国');
    const got = startFromAnchor(SEGMENTS, BLOCKS, { block: 1, offset: at });
    expect(got?.index).toBe(1);
    /* 「在这本书里，我想写」八个字（含逗号），无空白 */
    expect(got?.skip).toBe('在这本书里，我想写'.length);
  });

  it('页首是第三段：跨块也能对上', () => {
    const got = startFromAnchor(SEGMENTS, BLOCKS, { block: 2, offset: 0 });
    expect(got).toEqual({ index: SEGMENTS.length - 1, skip: 0 });
  });

  it('页首落在句间空隙（引号不在任何句子里）：从下一句开头念', () => {
    const blocks = [{ tag: 'p', text: '「好。」他说。', raw: '「好。」他说。' }];
    const segments = buildScript(blocks);
    /* 下标 0 是「好。」，闭引号「」」不属于任何句子，就是那个空隙 */
    const gap = blocks[0].raw.indexOf('」');
    const got = startFromAnchor(segments, blocks, { block: 0, offset: gap });
    expect(got).toEqual({ index: 1, skip: 0 });
  });

  it('原文带换行与空格：skip 只数非空白字符', () => {
    const raw = '这句 话里 有空 格。第二句话也比较长一些。';
    const blocks = [{ tag: 'p', text: raw, raw }];
    const segments = buildScript(blocks);
    const at = raw.indexOf('格');
    const got = startFromAnchor(segments, blocks, { block: 0, offset: at });
    /* 原文走了 9 个字符，其中 3 个空格：按字数折时长只能算 6 */
    expect(got).toEqual({ index: 0, skip: 6 });
  });

  it('块序号对不上（正文改过 / 不是同一份块）：返回 null，交给调用方兜底', () => {
    expect(startFromAnchor(SEGMENTS, BLOCKS, { block: 9, offset: 0 })).toBeNull();
  });

  it('偏移超出这一块最后一句：返回 null', () => {
    expect(startFromAnchor(SEGMENTS, BLOCKS, { block: 2, offset: 999 })).toBeNull();
  });

  it('偏移为负（取不到位置）：按块首处理', () => {
    expect(startFromAnchor(SEGMENTS, BLOCKS, { block: 1, offset: -1 })).toEqual({ index: 1, skip: 0 });
  });
});
