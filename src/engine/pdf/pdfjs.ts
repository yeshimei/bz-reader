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
 * 第一次调用时才真正加载 pdf.js，并把 worker handler 挂到主线程。
 * 失败不缓存（网络/模块损坏之后重试还有机会）。
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  installPromiseWithResolvers();
  if (!loaded) {
    loaded = (async () => {
      const lib = (await import('pdfjs-dist/build/pdf.mjs')) as unknown as PdfjsModule;
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs')) as unknown as {
        WorkerMessageHandler: unknown;
      };
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
      return lib;
    })().catch((err: unknown) => {
      loaded = null;
      throw err;
    });
  }
  return loaded;
}
