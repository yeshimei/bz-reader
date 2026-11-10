/* ============================================================
 * bz-reader · pdf.js 懒加载门面（engine/pdf/pdfjs.ts）
 *
 * 为什么不在模块顶层 `import 'pdfjs-dist/build/pdf.mjs'`：
 *   · 它 800KB 未压缩，顶层执行要定义几十个类；EPUB 用户不该为 PDF 付这笔启动钱；
 *   · 它默认拉起 Web Worker，而 Obsidian（尤其移动端）的 CSP 不认 blob: /
 *     data: 脚本，worker 建不起来就是白屏。
 *
 * 解法是把 worker 模块也静态 import 进来，挂到 `globalThis.pdfjsWorker`。
 * pdf.js 的 `PDFWorker.#mainThreadWorkerMessageHandler` 会优先读它，于是
 * 整个解析在**主线程**跑：不建 Worker、不碰 CSP、不加载额外文件。
 * 代价是大 PDF 的解析会占主线程——所以视图层必须分页渲染、按需排队。
 *
 * `Promise.withResolvers` 是 pdf.js 5.x 的硬依赖（iOS 17.4 / Chrome 119 起
 * 才有），插件启动时就要补上，不能等打开 PDF 才补。
 * ============================================================ */

import type * as PdfjsDist from 'pdfjs-dist';

type PdfjsModule = typeof PdfjsDist;

let loaded: Promise<PdfjsModule> | null = null;

/** iOS 17.4 以下没有 Promise.withResolvers；pdf.js 5.x 用它建内部能力对象 */
export function installPromiseWithResolvers(): void {
  const proto = Promise as unknown as {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof proto.withResolvers === 'function') return;
  proto.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

/**
 * pdf.js 5.5 用了一批「Chrome 130+ 才有」的内建 API。Obsidian 1.8.x 的
 * Electron 内核比它旧，缺任何一个都会在 render 中途抛
 * `x is not a function`（真机报错：`getOrInsertComputed is not a function`），
 * 表现是整页白屏。
 *
 * 这里按 TC39 proposal 的语义补齐，全部幂等：已有就跳过。
 */
export function installModernBuiltins(): void {
  installPromiseWithResolvers();

  /* Map.prototype.getOrInsert / getOrInsertComputed（Chrome 133）
     注意两者语义不同：前者第二个参数是「值」，后者是「回调」。 */
  const mapProto = Map.prototype as unknown as {
    getOrInsert?: (key: unknown, value: unknown) => unknown;
    getOrInsertComputed?: (key: unknown, compute: (key: unknown) => unknown) => unknown;
  };
  if (typeof mapProto.getOrInsert !== 'function') {
    mapProto.getOrInsert = function getOrInsert(
      this: Map<unknown, unknown>,
      key: unknown,
      value: unknown,
    ): unknown {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    };
  }
  if (typeof mapProto.getOrInsertComputed !== 'function') {
    mapProto.getOrInsertComputed = function getOrInsertComputed(
      this: Map<unknown, unknown>,
      key: unknown,
      compute: (key: unknown) => unknown,
    ): unknown {
      if (this.has(key)) return this.get(key);
      const value = compute(key);
      this.set(key, value);
      return value;
    };
  }

  /* Promise.try（Chrome 128）：同步异常要转成 rejection */
  const promiseCtor = Promise as unknown as {
    try?: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;
  };
  if (typeof promiseCtor.try !== 'function') {
    promiseCtor.try = function promTry(fn: (...args: unknown[]) => unknown, ...args: unknown[]) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
  }

  /* Uint8Array 的 base64 / hex 编解码（Chrome 130）。pdf.js 在图像与
     ID 序列化里用；不补的话会在某些页才炸，更难查。 */
  const u8Proto = Uint8Array.prototype as unknown as {
    toBase64?: () => string;
    toHex?: () => string;
  };
  if (typeof u8Proto.toHex !== 'function') {
    u8Proto.toHex = function toHex(this: Uint8Array): string {
      let out = '';
      for (const byte of this) out += byte.toString(16).padStart(2, '0');
      return out;
    };
  }
  if (typeof u8Proto.toBase64 !== 'function') {
    u8Proto.toBase64 = function toBase64(this: Uint8Array): string {
      /* 一次 fromCharCode 太多参数会爆栈，按 32K 分块 */
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < this.length; i += chunk) {
        binary += String.fromCharCode(...this.subarray(i, i + chunk));
      }
      return btoa(binary);
    };
  }
  const u8Ctor = Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array };
  if (typeof u8Ctor.fromBase64 !== 'function') {
    u8Ctor.fromBase64 = function fromBase64(value: string): Uint8Array {
      const binary = atob(value);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out;
    };
  }
}

/**
 * 第一次调用时才真正加载 pdf.js，并把 worker handler 挂到主线程。
 * 失败不缓存（网络/模块损坏之后重试还有机会）。
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  installModernBuiltins();
  if (!loaded) {
    loaded = (async () => {
      const lib = (await import('pdfjs-dist/build/pdf.mjs')) as unknown as PdfjsModule;
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs')) as unknown as {
        WorkerMessageHandler: unknown;
      };
      (window as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
      return lib;
    })().catch((err: unknown) => {
      loaded = null;
      throw err;
    });
  }
  return loaded;
}
