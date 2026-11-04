import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installBlobSrcdocPatches, uninstallBlobSrcdocPatches } from '../src/engine/blob-srcdoc';

/**
 * A-32：猴补丁的卸载不能「一刀切还原」。
 *
 * 同一页面里可能有别的插件也在包 `URL.createObjectURL` / `iframe.src`。
 * 我们只能还原「自己装的那一层」，否则：
 *   · 对方后装 → 我们卸载时把对方的包装抹掉；
 *   · 我们重装 → 保存的仍是首次的原生函数，卸载时把中间那层一起抹掉。
 */
const nativeCreate = URL.createObjectURL;
const nativeRevoke = URL.revokeObjectURL;

class FakeIframe {
  attrs = new Map<string, string>();
  srcdoc = '';
  get src(): string {
    return this.attrs.get('src') ?? '';
  }
  set src(v: string) {
    this.attrs.set('src', String(v));
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }
}

const nativeSrcDesc = Object.getOwnPropertyDescriptor(FakeIframe.prototype, 'src')!;

function resetIframeSrc(): void {
  Object.defineProperty(FakeIframe.prototype, 'src', nativeSrcDesc);
}

beforeAll(() => {
  (globalThis as unknown as { HTMLIFrameElement: unknown }).HTMLIFrameElement = FakeIframe;
});

afterEach(() => {
  uninstallBlobSrcdocPatches();
  URL.createObjectURL = nativeCreate;
  URL.revokeObjectURL = nativeRevoke;
  resetIframeSrc();
  vi.restoreAllMocks();
});

afterAll(() => {
  delete (globalThis as unknown as { HTMLIFrameElement?: unknown }).HTMLIFrameElement;
});

describe('blob 补丁卸载（A-32）', () => {
  it('别的插件后装的 createObjectURL：卸载时保留对方的包装', () => {
    installBlobSrcdocPatches();
    expect(URL.createObjectURL).not.toBe(nativeCreate);

    const other = (blob: Blob): string => nativeCreate.call(URL, blob);
    URL.createObjectURL = other;

    uninstallBlobSrcdocPatches();
    expect(URL.createObjectURL).toBe(other);
  });

  it('别的插件后改的 iframe src setter：卸载时保留对方的', () => {
    installBlobSrcdocPatches();
    const ours = Object.getOwnPropertyDescriptor(FakeIframe.prototype, 'src')?.set;
    expect(ours).not.toBe(nativeSrcDesc.set);

    const otherSet = vi.fn();
    Object.defineProperty(FakeIframe.prototype, 'src', {
      configurable: true,
      get: () => '',
      set: otherSet,
    });

    uninstallBlobSrcdocPatches();
    expect(Object.getOwnPropertyDescriptor(FakeIframe.prototype, 'src')?.set).toBe(otherSet);
  });

  it('安装时保存的是「安装前的当前函数」：还原到对方那层，不是更早的原生', () => {
    const other = vi.fn((blob: Blob) => nativeCreate.call(URL, blob));
    URL.createObjectURL = other;

    installBlobSrcdocPatches();
    expect(URL.createObjectURL).not.toBe(other);
    URL.createObjectURL(new Blob(['x']));
    expect(other).toHaveBeenCalledTimes(1);

    uninstallBlobSrcdocPatches();
    expect(URL.createObjectURL).toBe(other);
  });

  it('安装时保存的是 iframe 上「安装前的 setter」', () => {
    const otherSet = vi.fn();
    Object.defineProperty(FakeIframe.prototype, 'src', {
      configurable: true,
      get: () => '',
      set: otherSet,
    });

    installBlobSrcdocPatches();
    const ours = Object.getOwnPropertyDescriptor(FakeIframe.prototype, 'src')?.set;
    expect(ours).not.toBe(otherSet);

    uninstallBlobSrcdocPatches();
    expect(Object.getOwnPropertyDescriptor(FakeIframe.prototype, 'src')?.set).toBe(otherSet);
  });

  it('没人插队时卸载还原到原生函数', () => {
    installBlobSrcdocPatches();
    uninstallBlobSrcdocPatches();
    expect(URL.createObjectURL).toBe(nativeCreate);
    expect(URL.revokeObjectURL).toBe(nativeRevoke);
    expect(Object.getOwnPropertyDescriptor(FakeIframe.prototype, 'src')?.set).toBe(nativeSrcDesc.set);
  });
});
