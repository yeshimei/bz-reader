/**
 * 划词动作的接线契约（真机回归，2026-11-10）。
 *
 * 背景：划词条上的「复习」曾经必失败——`autoMarkSelection` 会把刚选的那段
 * 落成一条划线并**返回它的 id**，但这条分支把返回值丢了，转而读一个在换
 * 选区时就被清空的旧字段。结果点下去只弹一句「没找到划线」，卡片与排期都
 * 不会出现；而旁边的「存为名词 / 存为段落」写法是对的，所以单测一直没发现。
 *
 * 这类错不在纯函数里，也不在渲染里，而在「动作分发有没有把 id 递下去」这一层。
 * 单测打不到 dispatch（它要一整套 shell 源），所以这里直接钉源码形状：
 * 凡自动落线的动作，**必须**接住返回值。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(join(process.cwd(), 'src/shell/actions.ts'), 'utf8');

/** 这三个动作落完线还要拿 id 继续干活（录入名词 / 录入段落 / 生成复习卡）。
    `selbilink` 不在内：它只把链接复制进剪贴板，返回值本来就不用。 */
const NEEDS_ID = ['selterm', 'selpassage', 'selreview'] as const;

describe('划词动作的落线 id 接线', () => {
  it('三个动作都接住返回值', () => {
    for (const act of NEEDS_ID) {
      expect(SRC, `${act} 丢了落线 id`).toContain(`const id = autoMarkSelection('${act}')`);
    }
  });

  it('不存在「调用完又把返回值丢掉」的写法', () => {
    for (const act of NEEDS_ID) {
      const bare = new RegExp(`^[ \\t]*autoMarkSelection\\('${act}'\\);`, 'm');
      expect(bare.test(SRC), `${act} 有裸调用`).toBe(false);
    }
  });

  it('复习分支把 id 交给 addToReview', () => {
    /* 取到下一个 case 为止：块里第一句 `if (!requireCap) break;` 会提前截断 */
    const block = SRC.match(/case 'selreview': \{[\s\S]*?case 'selbilink'/);
    expect(block, '找不到 selreview 分支').not.toBeNull();
    expect(block![0]).toContain("const id = autoMarkSelection('selreview')");
    expect(block![0]).toMatch(/addToReview\(id \?\?/);
  });
});
