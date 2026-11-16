/* ============================================================
 * bz-reader · 外部 OCR 服务（data/ai-vision.ts）
 *
 * 扫描页识别有两条通道（2026-11-15 定稿）：
 *   · **DeepSeek 官方 OCR**（`data/deepseek-ocr.ts`，默认）：按页计价、
 *     自带行坐标，不借用 AI 配置；
 *   · **外部 OCR 服务**（本文件）：用户自己起一个 PaddleOCR / Umi-OCR /
 *     云服务都行，填一个地址，插件把图 POST 过去。
 *
 * 两条都只吐 `ParsedOcr`，后面的落盘、造文字层、划线完全不区分来源。
 *
 * 为什么不再内置「让聊天模型看图」那一档：它要用户配一个多模态模型、
 * 听 prompt 的 JSON 自觉性，还会被思考模式吃掉输出额度；专门 OCR 接口
 * 更准、更便宜、失败原因也更清楚。本地 OCR 引擎依旧不做——模型与 wasm
 * 无法随三件套发布。
 * ============================================================ */

import { postChat, type ChatConfig } from './ai';
import { parseOcrJson, parseOcrValue, type ParsedOcr } from '../engine/pdf/ocr';
import { t } from '../i18n';

/* ─────────── DeepSeek 看图（视觉 OCR） ─────────── */

/**
 * 识别的硬约束。
 *
 * 三条都不能省：
 *  · **0 到 1 的小数**：模型最常犯的错就是回像素；坐标量纲错了整页划线都会偏，
 *    所以 `parseOcrJson` 认不出量纲时会整页退回「只有文本」而不是硬摆。
 *  · **一行一个对象**：词级太碎，页级没有位置；行级是造透明文字层的最小单位。
 *  · **只输出 JSON**：多一句「好的，以下是结果」就会把解析带偏。
 */
export const VISION_PROMPT = [
  '把这张书页图片里的全部文字按阅读顺序逐行识别出来，供阅读器做划词与搜索。',
  '',
  '只输出一个 JSON 对象，不要解释、不要 Markdown 代码块：',
  '{"lines":[{"text":"这一行的文字","box":[x,y,width,height]}]}',
  '',
  '规则：',
  '1. box 用 0 到 1 的小数表示：x、y 是这一行左上角在图片里的比例位置，width、height 是宽高比例。',
  '2. 一行一个对象。同一行里的几个词合成一个对象，词间保留一个空格。',
  '3. 中文同一行内不要加空格；英文按词间空格。',
  '4. 不要识别装饰线、边框、污渍；页眉页脚与页码照原样识别。',
  '5. 图上没有文字就返回 {"lines":[]}。',
].join('\n');

/** OpenAI 兼容的多模态消息：一段文字 + 一张图 */
export function visionMessages(image: string): Array<{ role: string; content: unknown }> {
  return [
    { role: 'system', content: '你是光学字符识别引擎，只输出 JSON，不解释。' },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_PROMPT },
        /* 不传 `detail`：那是 OpenAI 私有参数，Gemini / 智谱的兼容层
           遇到未知字段有的会直接 400。 */
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];
}

/**
 * 让视觉模型认一页。
 *
 * 为什么走聊天接口而不是官方 `/tools/ocr`：2026-11-15 实测官方 OCR 对
 * 单页图片只回「整页一个 box」（`[[149,0,999,999]]`），拿不到逐行位置，
 * 划词做不了；聊天模型的 `image_url` 反而能按 prompt 给出每行坐标。
 *
 * `maxTokens` 给 8000：一页 60 行、每行带四个坐标，约 3000–5000 token；
 * 不设上限时服务商默认值（常见 512/1024）会把后半页截掉，表现是「只认出半页」。
 * `thinking: 'disabled'` 只对 DeepSeek 官方端点生效：它的思考模式默认开启，
 * 4000 的额度会被思考吃光、正文为空（2026-11-15 真机就是这个报错）。
 */
export async function recognizeViaVision(
  config: ChatConfig,
  image: string,
  opts: {
    signal?: AbortSignal;
    /** 覆盖默认 180 秒：识别一页比问答慢 */
    timeoutMs?: number;
  } = {},
): Promise<ParsedOcr> {
  const raw = await postChat(config, visionMessages(image), {
    ...opts,
    temperature: 0.1,
    maxTokens: 8000,
    thinking: 'disabled',
    label: 'OCR',
  });
  const parsed = parseOcrJson(raw);
  /* 空结果不在这里抛：空白页是正常页（书里常有一两页纯图），
     由调用方落一个 `empty` 页，免得下一批又排进去重复收费。 */
  return parsed;
}

/* ─────────── 外部 OCR 服务 ─────────── */

/**
 * 外部服务的约定（极简，方便用 Umi-OCR / PaddleOCR 自己包一层）：
 *
 *   请求 POST <url>
 *        {"image":"<base64，不含 data: 前缀>","base64":"<同一份>","mime":"image/jpeg",
 *         "options":{"data.format":"dict","tbpu.parser":"multi_none"}}
 *        （`base64` 与 `options` 都是为 Umi-OCR 带的：它只认 `base64`，
 *         且只有 `data.format=dict` 才回每行的框；别的服务忽略未知字段）
 *   响应 200，任选其一：
 *        {"code":100,"data":[{"text":"…","box":[[x1,y1],[x2,y2],…]}]}  ← Umi-OCR：四点 + 像素
 *        {"lines":[{"text":"…","box":[x,y,w,h]}]}      ← 0..1 或 0..1000
 *        [[[[x1,y1],…],["文字",0.99]]]                  ← PaddleOCR 自建服务的嵌套列表
 *        {"text":"整页文字"}                            ← 只有字，不能划词
 *        [{"text":"…","bbox":[x1,y1,x2,y2]}]            ← 裸数组
 *
 * 外层套了 `data` / `result` / `results` 也认（很多服务习惯包一层）。
 * `code` 不是 100/101 时按失败报出来，不假装「这页没字」。
 */
export interface HttpOcrInput {
  url: string;
  /** 纯 base64（不含 data: 前缀） */
  image: string;
  mime: string;
  /**
   * 出图时的像素宽高。
   *
   * Umi-OCR 这一类回的是**像素坐标**，没有这两个数就算不出比例，整页会被
   * 判成「只有文本、不能划词」——明明识别是对的，画不出来就白认了。
   */
  width?: number;
  height?: number;
  signal?: AbortSignal;
}

function unwrapOcrBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const obj = body as Record<string, unknown>;
  for (const key of ['data', 'result', 'output']) {
    const inner = obj[key];
    if (inner && typeof inner === 'object') return inner;
  }
  return body;
}

/**
 * 请求体。
 *
 * `options` 是 Umi-OCR 的输出开关，别的服务会忽略未知字段：
 *  · `data.format: dict` —— 不传时默认回**整页纯文本**，拿不到每行的框，
 *    结果只有搜索/朗读能用，**不能划词**。这是本地通道能不能划词的分水岭。
 *  · `tbpu.parser: multi_none` —— 不传时它会按段落合并，框变粗（一段一个框），
 *    划词只能整段选。`multi_none` 保留原始行，正好对上我们的行级文字层。
 */
export function httpOcrBody(image: string, mime: string): Record<string, unknown> {
  return {
    image,
    base64: image,
    mime: mime || 'image/jpeg',
    options: { 'data.format': 'dict', 'tbpu.parser': 'multi_none' },
  };
}

/**
 * Umi-OCR 的状态码：100 成功、101 图中无文字，其余是失败。
 *
 * 不问这一句的话，模型没加载（500）会表现成「这一页没有识别出文字」，
 * 用户会以为是自己扫的页有问题。返回 null = 这层没有状态码，交给上层解析。
 */
function statusError(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const code = Number((body as Record<string, unknown>).code);
  if (!Number.isFinite(code) || code === 100 || code === 101) return null;
  return t('notice.pdf.ocrHttp', { status: `code ${code}` });
}

export async function recognizeViaHttp(input: HttpOcrInput): Promise<ParsedOcr> {
  const url = String(input.url ?? '').trim();
  if (!url) throw new Error(t('notice.pdf.ocrNoUrl'));
  let res: Response;
  try {
    res = await window.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(httpOcrBody(input.image, input.mime)),
      signal: input.signal,
    });
  } catch (e) {
    if (input.signal?.aborted) throw new Error('已取消');
    const raw = (e as Error)?.message || '';
    /* Chromium 只会说一句 "Failed to fetch"：可能是没开、端口不对，也可能是
       没放行跨域。照抄给用户等于没说（2026-11-15 真机上提示里就剩个 fetch）。 */
    const why = /failed to fetch|networkerror|load failed/i.test(raw)
      ? t('notice.pdf.ocrFetchHint')
      : raw || '网络错误';
    throw new Error(t('notice.pdf.ocrOffline', { why }));
  }
  if (!res.ok) throw new Error(t('notice.pdf.ocrHttp', { status: String(res.status) }));
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(t('notice.pdf.ocrBadJson'));
  }
  const failed = statusError(body);
  if (failed) throw new Error(failed);
  const ref =
    input.width && input.height && input.width > 0 && input.height > 0
      ? { width: input.width, height: input.height }
      : undefined;
  const parsed = parseOcrValue(unwrapOcrBody(body), ref);
  return parsed;
}

/* ─────────── 图 → base64 ─────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * 字节 → base64。手写而不走 `btoa`：`btoa` 对超过几 MB 的字符串要先把整个
 * 二进制转成拉丁字符串，页面图动辄几百 KB，在手机上会明显卡一下。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const data = bytes ?? new Uint8Array(0);
  let out = '';
  let i = 0;
  for (; i + 2 < data.length; i += 3) {
    const n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = data.length - i;
  if (rest === 1) {
    const n = data[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (data[i] << 16) | (data[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/** `data:<mime>;base64,<...>` */
export function dataUrlOf(base64: string, mime = 'image/jpeg'): string {
  return `data:${mime || 'image/jpeg'};base64,${base64}`;
}

/** Blob → dataURL（视觉识别用；体量与分辨率由调用方在出图那一步控制） */
export async function blobToDataUrl(blob: Blob | null | undefined): Promise<string> {
  if (!blob) throw new Error(t('notice.pdf.ocrNoImage'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return dataUrlOf(bytesToBase64(bytes), mimeOf(blob));
}

/** MIME 归一：pdf.js 出的图是 png，压缩后多半是 jpeg */
export function mimeOf(blob: Blob | null | undefined, fallback = 'image/jpeg'): string {
  const type = String(blob?.type ?? '').split(';')[0]?.trim();
  return type && /^image\//.test(type) ? type : fallback;
}
