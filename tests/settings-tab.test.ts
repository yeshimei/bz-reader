/**
 * 原生设置页门牌（shell/settings-tab）+ 宿主交接（core/ui/host-settings）。
 *
 * 2026-11-26：Obsidian 自带设置 → bz Reader → 「打开设置面板」。宿主设置 Modal
 * 不收起会攥着焦点，移动端书架设置页里的输入框全部失效（iPad 打字进设置搜索框，
 * iPhone / 安卓输不进）。这里锁三件事：
 *   1. 这一页只渲染一行门牌，文案走语言包；
 *   2. 没有宿主 Modal（命令面板等入口）时立即开设置页；
 *   3. 有宿主 Modal 时先关它，等它真的离场再开；迟迟不关最多等一秒照开。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { BzReaderSettingTab } from '../src/shell/settings-tab';

let uninstall: (() => void) | null = null;
let opened = 0;
let lastPage = '';

const host = {
  openStudy: (page: string): void => {
    opened += 1;
    lastPage = page;
  },
};

function makeTab(app: unknown = {}): BzReaderSettingTab {
  return new BzReaderSettingTab(app as never, host as never);
}

/** 取 mock Setting 上那唯一一颗按钮的点击处理 */
function firstControl(tab: BzReaderSettingTab): () => void {
  const list = (tab.containerEl as unknown as {
    __settings?: Array<{ controls?: Array<{ clickHandler?: (() => void) | null }> }>;
  }).__settings;
  const fn = list?.[0]?.controls?.[0]?.clickHandler;
  if (!fn) throw new Error('按钮没有接上点击处理');
  return fn;
}

describe('原生设置页：只有一行门牌', () => {
  beforeEach(() => {
    opened = 0;
    lastPage = '';
    uninstall = installDomStub();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.useRealTimers();
  });

  it('只渲染一行：名字与说明来自语言包，按钮是强调色', () => {
    const tab = makeTab();
    tab.display();
    const list = (tab.containerEl as unknown as {
      __settings: Array<{ name: string; desc: string; controls: Array<{ cta: boolean; text: string }> }>;
    }).__settings;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('打开设置面板');
    expect(list[0].desc).toContain('书架设置页');
    expect(list[0].controls[0].cta).toBe(true);
    expect(list[0].controls[0].text).toBe('打开设置面板');
  });

  it('没有宿主 Modal：点按钮直接开书架设置页', () => {
    const tab = makeTab();
    tab.display();
    firstControl(tab)();
    expect(opened).toBe(1);
    expect(lastPage).toBe('settings');
  });
});

describe('从宿主设置进入：先收宿主再开设置页', () => {
  beforeEach(() => {
    opened = 0;
    lastPage = '';
    /* 先造假定时器再装 DOM 桩：桩里的 window.setTimeout 捕获的是当前全局引用 */
    vi.useFakeTimers();
    uninstall = installDomStub();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.useRealTimers();
  });

  /** 把 tab 挂进一个模拟的宿主设置 Modal（带官方关闭钮） */
  function mountHost(tab: BzReaderSettingTab, onClick: () => void) {
    const doc = (globalThis as unknown as { document: any }).document;
    const modal = doc.createElement('div');
    modal.classList.add('modal-container', 'is-visible');
    const closeBtn = doc.createElement('button');
    closeBtn.classList.add('modal-close-button');
    closeBtn.addEventListener('click', onClick);
    modal.appendChild(closeBtn);
    modal.appendChild(tab.containerEl);
    doc.body.appendChild(modal);
    return { modal, closeBtn };
  }

  it('宿主真正离场后才开设置页', () => {
    const tab = makeTab();
    tab.display();
    const onClose = vi.fn();
    const { modal } = mountHost(tab, onClose);

    firstControl(tab)();

    // 宿主先收，书架设置页还不能开——否则焦点仍被宿主 Modal 攥着
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opened).toBe(0);

    // 关闭动画结束、容器摘除后下一拍再开
    modal.remove();
    vi.advanceTimersByTime(60);
    expect(opened).toBe(1);
    expect(lastPage).toBe('settings');
  });

  it('宿主迟迟不收起：最多等一秒，超时照开（不让人点了没反应）', () => {
    const tab = makeTab();
    tab.display();
    const { modal } = mountHost(tab, () => undefined);

    firstControl(tab)();
    vi.advanceTimersByTime(600);
    expect(opened).toBe(0);

    vi.advanceTimersByTime(500);
    expect(opened).toBe(1);
    expect(lastPage).toBe('settings');
    // 宿主还挂着也不再等（超时兜底只跑一次）
    vi.advanceTimersByTime(1000);
    expect(opened).toBe(1);
    void modal;
  });
});
