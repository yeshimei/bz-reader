/* ============================================================
 * bz-reader · 让没有 signal 参数的异步接口也能被掐断（core/with-signal.ts）
 *
 * 外部门面（bz 的 `searchNotes`、部分宿主接口）签名里没有 AbortSignal，
 * 但调用方需要一个统一的取消出口：一次提问的取证阶段由同一个 controller
 * 管着，超时或换书就一起停，不然界面已经换了一本书，旧检索还在后台跑。
 *
 * 只在「真的传了 signal」时包一层；没传就是原 promise，零成本。
 * ============================================================ */

/**
 * 把 `signal` 映射成 promise 的一次 reject。
 *
 * 不接管原 promise 的清理：它该跑完还是跑完，这里只是不再等它。
 * 拒绝理由用普通 Error（`name` 标成 AbortError），与 fetch 的取消同口径。
 */
export function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    return Promise.reject(err);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        /* 外部接口 reject 的东西不保证是 Error（有的写字符串/对象）：
           交给调用方之前统一成 Error，否则 Promise 链上的 catch 拿不到栈。 */
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
