/**
 * 1f0bacc 回归：朗读条在「准备中还没有播放器」那一档也要收掉。
 *
 * stopTts 先把 ttsOpening 置 false，haltTts 的守卫又看 ttsOpening，于是
 * hideTtsBar 走不到；真机症状是停在封面点朗读，「这一页没有可朗读的文字」
 * 弹出来了，底下那条浮条还在。现在 stopTts 补一次 hideTtsBar 兜底。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { makeApp, makeReaderView } from './helpers/plugin-harness';

interface ReaderTtsHooks {
  ttsOpening: boolean;
  ttsBarEl: HTMLElement | null;
  stopTts(opts?: { resume?: boolean }): void;
}

let uninstall: () => void = () => undefined;

beforeEach(() => {
  uninstall = installDomStub();
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe('停止朗读时浮条一定收掉（1f0bacc 回归）', () => {
  it('准备中（ttsOpening）还没有播放器：stopTts 也要把浮条摘掉', () => {
    const app = makeApp();
    const { view } = makeReaderView(app);
    const v = view as unknown as ReaderTtsHooks;
    const bar = document.createElement('div');
    document.body.appendChild(bar);
    const remove = vi.spyOn(bar, 'remove');
    v.ttsOpening = true;
    v.ttsBarEl = bar;

    v.stopTts();

    expect(v.ttsOpening).toBe(false);
    expect(v.ttsBarEl).toBeNull();
    /* 浮条节点被要求从宿主上摘掉——不是只把引用置空 */
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
