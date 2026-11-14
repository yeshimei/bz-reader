/* ============================================================
 * bz-reader · 音色列表的取用与缓存（shell/voice-store.ts）
 *
 * 音色选择弹窗不自己发请求：它只读这里的缓存，缓存没有才去拉。这样
 * 输入搜索、点试听、重画弹窗都不会重复打服务（本地模型回一个列表
 * 也要几百毫秒）。
 *
 * 缓存键是「地址 + 模型」（core/tts-voices.voiceKeyOf）：换了任何一头，
 * 旧列表自然不再命中——不用手写失效逻辑，也就不会漏。
 * ============================================================ */

import { fetchLocalVoices } from '../core/tts-local';
import { builtinVoicesOf, voiceKeyOf } from '../core/tts-voices';
import { localRequester } from '../data/tts-request';
import { getShellSource, shellPrefs, shellSettings } from './source';

export type VoiceStatus = 'loading' | 'ok' | 'fail';

export interface VoiceEntry {
  status: VoiceStatus;
  list: string[];
  at: number;
}

export interface VoiceTarget {
  engine: 'local' | 'online';
  url: string;
  model: string;
  apiKey: string;
}

const cache = new Map<string, VoiceEntry>();

/** 测试用：清空或读内部缓存 */
export function clearVoiceCache(): void {
  cache.clear();
}

export function voiceEntryOf(key: string): VoiceEntry | undefined {
  return cache.get(key);
}

/** 当前引擎连的是哪个服务、用什么模型 */
export function voiceTargetOf(engine: 'local' | 'online'): VoiceTarget {
  const s = shellSettings();
  return engine === 'local'
    ? { engine, url: s.ttsLocal.url, model: s.ttsLocal.model, apiKey: s.ttsLocal.apiKey }
    : { engine, url: s.ttsOnline.url, model: s.ttsOnline.model, apiKey: s.ttsOnline.apiKey };
}

/** 这个引擎现在选中的音色（空 = 服务默认） */
export function currentVoiceOf(engine: 'local' | 'online'): string {
  const p = shellPrefs();
  return engine === 'local' ? p.ttsVoiceLocal : p.ttsVoiceOnline;
}

export function setVoiceOf(engine: 'local' | 'online', voice: string): void {
  getShellSource()?.setPrefs(engine === 'local' ? { ttsVoiceLocal: voice } : { ttsVoiceOnline: voice });
}

/**
 * 拉（或读缓存的）音色列表。
 *
 * DeepSeek 官方不发请求：两把嗓子是内置的，离线也该能选。
 * 地址为空、服务不答、超时，一律落成 `fail`——弹窗据此露出「手填」入口，
 * 而不是转圈转到用户关掉。
 */
export async function loadVoices(engine: 'local' | 'online', force = false): Promise<VoiceEntry> {
  const target = voiceTargetOf(engine);
  const key = voiceKeyOf(target.url, target.model);
  const hit = cache.get(key);
  if (!force && hit && hit.status === 'ok') return hit;

  const builtin = engine === 'online' ? builtinVoicesOf(target.url) : [];
  if (builtin.length) {
    const entry: VoiceEntry = { status: 'ok', list: builtin, at: Date.now() };
    cache.set(key, entry);
    return entry;
  }

  const loading: VoiceEntry = { status: 'loading', list: hit?.list ?? [], at: Date.now() };
  cache.set(key, loading);

  if (!target.url) {
    const fail: VoiceEntry = { status: 'fail', list: [], at: Date.now() };
    cache.set(key, fail);
    return fail;
  }

  const list = await fetchLocalVoices({
    baseUrl: target.url,
    apiKey: target.apiKey,
    model: target.model,
    request: localRequester(),
  });
  const entry: VoiceEntry = { status: list.length ? 'ok' : 'fail', list, at: Date.now() };
  cache.set(key, entry);
  return entry;
}
