/* ============================================================
 * bz-reader · 本地语音服务的请求通道（data/tts-request.ts）
 *
 * 只有一件事：把 `core/tts-local` 定的那次请求，用 Obsidian 的 `requestUrl`
 * 真正发出去。
 *
 * 为什么不用 fetch：本地服务不会给 `app://obsidian.md` 放行跨域头，直接
 * fetch 会被浏览器拦掉。`requestUrl` 走宿主自己的网络栈，没有跨域这回事，
 * 桌面和手机都通。代价是拿不到 AbortSignal——请求发出去收不回来，只能
 * 「不等了」，对免费又快的本地合成可以接受。
 *
 * 单独成文件是为了让阅读视图和设置页的试听共用同一份：两处各写一份，
 * 迟早有一处忘了加 `throw: false`，表现是「服务没启动时弹一屏红字」。
 * ============================================================ */

import { requestUrl } from 'obsidian';
import type { LocalRequester } from '../core/tts-local';

export function localRequester(): LocalRequester {
  return async (req) => {
    const res = await requestUrl({
      url: req.url,
      method: req.method,
      ...(req.headers ? { headers: req.headers } : {}),
      ...(req.body !== undefined ? { body: req.body } : {}),
      /* 由我们自己按状态码分类，不交给宿主抛异常 */
      throw: false,
    });
    return { status: res.status, arrayBuffer: res.arrayBuffer, text: res.text };
  };
}
