/**
 * 强调色档位一致性（tests/accent-tiers.test.ts）
 *
 * ACCENT_OPTIONS 是设置面板的档位表，tokens.css 是壳层 `--copper` 的实际来源：
 * 两边必须一档对一条地同时存在，明暗各一条，颜色逐字一致。
 *
 * 漏一条的表现不是报错，而是「看起来没生效」：设置面板里三颗圆点明明不同色，
 * 选中后壳层的选中态、侧栏短线、滑杆还是宿主的 accent——三档看起来一模一样
 * （2026-11-05 用户实拍：墨色 / 绛紫 / 天青全成了铜金）。
 *
 * 同理，颜色也不能只在 CSS 里改：圆点取的是 ACCENT_OPTIONS.css，改一边就漂了。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENT_OPTIONS } from '../src/data/prefs';

const CSS = readFileSync(join('src', 'shell', 'styles', 'tokens.css'), 'utf8');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 取某条 `--copper` 覆盖的值；选择器前缀用来区分亮色 / body.theme-dark 暗色 */
function copperRule(prefix: string, value: string): string | undefined {
  const re = new RegExp(
    `${escapeRe(prefix)}\\.bzs-shell\\[data-bzaccent="${escapeRe(value)}"\\]\\s*\\{\\s*--copper:\\s*([^;]+);`,
  );
  return re.exec(CSS)?.[1]?.trim();
}

describe('强调色档位', () => {
  // auto 不写死颜色（读宿主 --interactive-accent），不参与覆盖检查
  const owned = ACCENT_OPTIONS.filter((a) => a.value !== 'auto');

  it('每一档都有亮色 --copper 覆盖，且与 ACCENT_OPTIONS 一致', () => {
    for (const a of owned) {
      expect(copperRule('', a.value), `${a.label}（${a.value}）缺亮色档`).toBe(a.css);
    }
  });

  it('每一档都有暗色 --copper 覆盖，且与 ACCENT_OPTIONS 一致', () => {
    for (const a of owned) {
      expect(copperRule('body.theme-dark ', a.value), `${a.label}（${a.value}）缺暗色档`).toBe(a.dark);
    }
  });
});
