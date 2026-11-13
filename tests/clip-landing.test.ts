/**
 * 换书后落到哪（data/clip-epub/sidecar.ts 的 clipLanding，纯函数）。
 *
 * 位置迁移只有两种：能信 CFI 就换脊柱段接着读；正文本身变了（生成摘要在
 * 章首插了导语）就丢掉 CFI，落到这一篇第一页——旧偏移在新正文里对不上，
 * foliate 解析时会抛 setEnd 越界，整本书都打不开。
 */
import { describe, expect, it } from 'vitest';
import { clipLanding } from '../src/data/clip-epub/sidecar';

describe('clipLanding', () => {
  it('摘要这种改过正文的刷新：不用旧 CFI，直接落这一篇第一页', () => {
    expect(
      clipLanding({
        oldCfi: 'epubcfi(/6/4!/4/10/1:128)',
        oldIndex: 1,
        newIndex: 1,
        oldPct: 0.42,
        chapterStart: true,
      }),
    ).toEqual({ cfi: '', section: 1, fraction: 0 });
  });

  it('普通刷新：CFI 只换脊柱段，百分比照旧', () => {
    expect(
      clipLanding({
        oldCfi: 'epubcfi(/6/4!/4/10/1:128)',
        oldIndex: 1,
        newIndex: 3,
        oldPct: 0.42,
      }),
    ).toEqual({ cfi: 'epubcfi(/6/8!/4/10/1:128)', section: -1, fraction: 0.42 });
  });

  it('这一篇在新书里没了：丢掉 CFI，退回百分比', () => {
    expect(
      clipLanding({
        oldCfi: 'epubcfi(/6/4!/4/10/1:128)',
        oldIndex: 1,
        newIndex: -1,
        oldPct: 0.42,
      }),
    ).toEqual({ cfi: '', section: -1, fraction: 0.42 });
  });

  it('要跳章首但找不到这一篇：退回百分比，不硬跳第一章', () => {
    expect(
      clipLanding({ oldCfi: '', oldIndex: 1, newIndex: -1, oldPct: 0.3, chapterStart: true }),
    ).toEqual({ cfi: '', section: -1, fraction: 0.3 });
  });
});
