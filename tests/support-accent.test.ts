import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { setLocale } from '../src/i18n';
import { REWARD_NAMES } from '../src/data/reward';
import { ACCENT_VAR, shellAccentColor } from '../src/shell/theme-accent';
import { openSupportDialog, supportDialogHtml } from '../src/shell/support-dialog';

/* ============================================================
 * 弹窗跟随壳层强调色（tests/support-accent.test.ts）
 *
 * 弹窗挂在 body 上，不在 .bzs-shell 里：它只能读到宿主的 --interactive-accent，
 * 于是「设置里选了朱砂 / 靛蓝，弹窗还是主题紫」。这条测试钉住补上的那一半：
 * 打开时把壳层算好的颜色挂到 popup 的 --bzs-accent 上。
 * ============================================================ */

let uninstall = () => undefined as void;

/** DOM 桩的 document 只有一个返回 null 的 querySelector；这里换成返回壳层 */
function stubShell(accent: string | null): void {
  const doc = document as unknown as { querySelector: (sel: string) => unknown };
  doc.querySelector = (sel: string) => {
    if (sel !== '.bzs-shell') return null;
    return accent === null ? null : ({ tagName: 'DIV' } as unknown as HTMLElement);
  };
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => (name === '--copper' && accent !== null ? accent : ''),
  }));
}

/** 最后挂上去的那层遮罩里的弹窗 */
function lastPopup(): HTMLElement {
  const mask = document.body.children[document.body.children.length - 1] as unknown as {
    children: Array<{ style: Record<string, string> }>;
  };
  return mask.children[0] as unknown as HTMLElement;
}

beforeAll(() => {
  uninstall = installDomStub();
});

afterAll(() => {
  uninstall();
});

afterEach(() => {
  setLocale('zh');
  vi.unstubAllGlobals();
});

describe('从壳层读强调色', () => {
  it('壳层在：拿到它算出来的那个值', () => {
    stubShell('#9a7434');
    expect(shellAccentColor()).toBe('#9a7434');
  });

  it('壳层不在：给空串，由样式回退到宿主 accent（不在 JS 里猜颜色）', () => {
    stubShell(null);
    expect(shellAccentColor()).toBe('');
  });

  it('样式引擎读不到值：同样给空串，不抛错', () => {
    stubShell(null);
    vi.stubGlobal('getComputedStyle', () => {
      throw new Error('style engine not ready');
    });
    expect(() => shellAccentColor()).not.toThrow();
    expect(shellAccentColor()).toBe('');
  });
});

describe('弹窗把强调色带过去', () => {
  it('打开时把 --bzs-accent 写在这个弹窗自己身上', () => {
    stubShell('#b0452f');
    const handle = openSupportDialog();

    expect(lastPopup().style[ACCENT_VAR]).toBe('#b0452f');
    handle.close();
  });

  /* 读不到时什么都不写：写了空值会让 color-mix 算出透明，整窗没颜色 */
  it('读不到壳层颜色：不写这个变量（留空让 CSS 回退）', () => {
    stubShell(null);
    const handle = openSupportDialog();

    expect(lastPopup().style[ACCENT_VAR]).toBeUndefined();
    handle.close();
  });

  it('弹窗正文本身不写死颜色：颜色只从变量来', () => {
    const html = supportDialogHtml(REWARD_NAMES);
    expect(html).not.toMatch(/#9a7434|#b0452f|#7856d6/i);
  });
});
