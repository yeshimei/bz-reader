/* ============================================================
 * bz-reader · 音色属于模型（core/tts-voices.ts）
 *
 * 用户 2026-11-14 指出：音色是模型给的，换了模型还沿用旧音色就是错的。
 * 所以音色列表必须按「服务地址 + 模型」缓存，模型一改就作废重拉；原来
 * 选中的音色如果不在新列表里，就退回「用服务默认」，别拿一个这个模型
 * 根本没有的名字去请求（那只会得到 400）。
 *
 * 两处例外要留：
 *   · 服务不提供音色列表（返回空）：用户的音色名照旧用，不能因为拉不到
 *     列表就把人家配好的名字清掉；
 *   · DeepSeek 官方：两把嗓子是内置的，永远不依赖列表接口。
 * ============================================================ */

import { isDeepseekTtsUrl } from './tts-protocol';

/** DeepSeek 的两把嗓子：只有官方地址才有，别的服务不认这两个名字 */
export const DEEPSEEK_VOICES: readonly string[] = ['stella', 'tide'];

/**
 * 音色列表的缓存键。
 *
 * 地址去尾斜杠、主机大小写不敏感；模型原样（模型名区分大小写）。
 * 任何一头变了都得重新拉——同一个地址换模型，音色集合可以完全不同。
 */
export function voiceKeyOf(url: string | null | undefined, model: string | null | undefined): string {
  const base = String(url ?? '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
  return `${base}|${String(model ?? '').trim()}`;
}

/** 在线服务的「内置音色」：只有 DeepSeek 官方有 */
export function builtinVoicesOf(url: string | null | undefined): string[] {
  return isDeepseekTtsUrl(url) ? [...DEEPSEEK_VOICES] : [];
}

/**
 * 换模型 / 换地址之后，旧音色还算不算数。
 *
 * 拉得到列表：不在列表里就清空（落回服务默认）；拉不到列表：保留原值，
 * 服务自己认不认由合成时的报错说，别在设置页替它判。
 */
export function reconcileVoice(list: readonly string[], current: string | null | undefined): string {
  const cur = String(current ?? '').trim();
  if (!list.length) return cur;
  return list.includes(cur) ? cur : '';
}
