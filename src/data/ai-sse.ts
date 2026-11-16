/* ============================================================
 * bz-reader · 流式回复的切分（data/ai-sse.ts）
 *
 * 2026-11-16：本地 14B 答一问 77 秒，这 77 秒侧栏是一片空白——
 * 用户看到的是「点了没反应」，比答得慢更劝退。
 *
 * 流式的难点不在发请求，在**切事件**：`fetch` 的 body 是一串
 * 任意边界的字节，一帧里可能有半个事件、半个汉字。这里只做纯函数
 * 的那一半：给定缓冲，切出能确定的完整事件，剩下不够一帧的留着等
 * 下一次。解码（TextDecoder + stream）与发请求在 data/ai。
 *
 * 三种帧都要认：
 *   · `data: {...}` 正常增量；
 *   · `data: [DONE]` 结束标记；
 *   · 注释行 `: ping`（部分网关保活用）与空行分隔。
 * ============================================================ */

/** 一帧增量里能拿到的东西 */
export interface SseDrain {
  /** 正文增量，按到达顺序 */
  deltas: string[];
  /** 服务端说结束了 */
  done: boolean;
  /** 还没凑成完整一帧的尾巴，下一次接在前面继续切 */
  rest: string;
}

/** 从 `choices[0].delta` 里取正文；取不到返回空串（心跳、只带 role 的帧） */
function deltaOf(payload: string): string {
  const text = String(payload ?? '').trim();
  if (!text || text === '[DONE]') return '';
  try {
    const data = JSON.parse(text) as {
      choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
    };
    const delta = data.choices?.[0]?.delta;
    const content = delta?.content;
    if (typeof content === 'string') return content;
    /* 少数兼容层在流里也回数组分段（与 chatText 同一形状） */
    if (Array.isArray(content)) {
      let out = '';
      for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          out += (part as { text: string }).text;
        }
      }
      return out;
    }
    return '';
  } catch {
    /* 半截 JSON 说明上游没按帧发；丢掉这一帧比抛错有用——
       抛错会让整条回答在中途变成「失败」，而文字其实已经收到一半 */
    return '';
  }
}

/**
 * 切一帧。
 *
 * 只认 `\n\n` 这个分隔（先把 `\r\n` 归一），因为 SSE 的规范就是这么定的；
 * 不按行切——一帧里可以有多行 `data:`，按行切会把一帧拆成好几次渲染。
 */
export function drainSse(buffer: string): SseDrain {
  /* 先把 `\r\n` 归一：不归一的话 `\r\n\r\n` 里没有 `\n\n`，
     整条流会一直被当成「还没凑够一帧」，一个字都不出。 */
  const text = String(buffer ?? '').replace(/\r\n/g, '\n');
  const deltas: string[] = [];
  let done = false;
  let rest = text;
  for (;;) {
    const cut = rest.indexOf('\n\n');
    if (cut < 0) break;
    const frame = rest.slice(0, cut);
    rest = rest.slice(cut + 2);
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5);
      if (payload.trim() === '[DONE]') {
        done = true;
        continue;
      }
      const piece = deltaOf(payload);
      if (piece) deltas.push(piece);
    }
  }
  return { deltas, done, rest };
}
