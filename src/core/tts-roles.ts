/* ============================================================
 * bz-reader · 朗读角色标注（core/tts-roles.ts）
 *
 * 引号规则只能分出「旁白 / 对白」两类，分不出对白是谁说的。这一层让
 * `deepseek-flash` 读一页正文，给每段的对白标一个性别：m 男 / f 女 /
 * u 不确定。播放时男声用 tide、女声用 stella——只有两把嗓子，做到
 * 「男角色女角色不同声」为止；再多的角色，接口也没有更多音色。
 *
 * 纯函数：拼 prompt、解析模型回答、把标注并回段。网络调用在调用方。
 * ============================================================ */

import type { AiMessage } from '../data/ai';
import type { ScriptBlock, ScriptSegment } from './tts-script';

export type Gender = 'm' | 'f' | 'u';

export type SegmentWithGender = ScriptSegment & { gender?: Gender };

/** 一页最多送多少段给模型：再多就只标前这些，超出的按「不确定」处理 */
export const ROLE_MAX_BLOCKS = 80;

export function buildRoleMessages(blocks: readonly ScriptBlock[]): AiMessage[] {
  const list = blocks.slice(0, ROLE_MAX_BLOCKS);
  const system =
    '你是小说朗读的角色标注器。用户给出一页正文，每段前面有编号。' +
    '只判断引号里的对白是谁说的、性别是男还是女：m 男 / f 女 / u 无法判断。' +
    '旁白段落不要输出。只输出 JSON 数组，形如 [{"i":2,"gender":"f"}]，不要解释、不要代码块。';
  const body = list.map((b, i) => `[${i}] ${b.text}`).join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: body },
  ];
}

/**
 * 解析模型回答。
 *
 * 模型偶尔会包一层 ```json 或加一句「好的」。先找最外层的 `[` … `]`
 * 再 JSON.parse；解析失败就用正则逐条捞，捞不到就当没标（null）。
 */
export function parseRoleGenders(text: string, count: number): Array<Gender | null> {
  const out: Array<Gender | null> = new Array(Math.max(0, count)).fill(null);
  const raw = String(text ?? '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    const arr = JSON.parse(slice) as unknown;
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const i = Number((item as { i?: unknown }).i);
        const g = (item as { gender?: unknown }).gender;
        if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
        if (g === 'm' || g === 'f' || g === 'u') out[i] = g;
      }
      return out;
    }
  } catch {
    /* 落到下面的正则兜底 */
  }
  for (const m of raw.matchAll(/"i"\s*:\s*(\d+)\s*,\s*"gender"\s*:\s*"(m|f|u)"/g)) {
    const i = Number(m[1]);
    if (i >= 0 && i < out.length) out[i] = m[2] as Gender;
  }
  return out;
}

/** 段落在第几个 block 上有标注就用它；合并过的段取第一段 */
export function applyGenders(
  segments: readonly ScriptSegment[],
  byBlock: ReadonlyArray<Gender | null>,
): SegmentWithGender[] {
  return segments.map((seg) => {
    /* 旁白没有性别，别让模型把叙述句也标成男/女 */
    if (seg.kind !== 'dialogue') return { ...seg };
    let gender: Gender | undefined;
    for (const b of seg.blocks) {
      const g = byBlock[b];
      if (g && g !== 'u') {
        gender = g;
        break;
      }
    }
    return gender ? { ...seg, gender } : { ...seg };
  });
}
