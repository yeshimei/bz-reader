/* ============================================================
 * bz-reader · 扫描页识别（data/ai-vision.ts）
 *
 * 两条通道，一套结果：
 *   · **vision**：把这一页的图直接发给用户已配置的多模态模型（OpenAI 兼容
 *     `/chat/completions` 的 image_url 形状），要求它回「一行一条 + 位置」的
 *     JSON。不需要下载任何模型文件，也不用在插件里塞 wasm——发布只有三件套，
 *     这是唯一能装进插件又立刻可用的识别方式。
 *   · **http**：用户自己起一个 OCR 服务（PaddleOCR / Umi-OCR / 云服务都行），
 *     填一个地址，插件把图 POST 过去。适合「量大、要准确、肯动手」的人。
 *
 * 两条都只吐 `ParsedOcr`，后面的落盘、造文字层、划线完全不区分来源。
 *
 * 为什么不在插件内置本地 OCR 引擎：模型（十几 MB）与 wasm 无法随三件套发布，
 * 打包进 main.js 会把 2.6 MB 的包撑到十几 MB，且 iOS 上 wasm 不稳。这条路
 * 留给「用户先用 OCRmyPDF 做一份带文字层的副本」——那份文件进来就是文字版。
 * ============================================================ */

import { aiPostChat, type AiChatOptions } from './ai';
import type { ReaderSettings } from './settings';
import { parseOcrJson, parseOcrValue, type ParsedOcr } from '../engine/pdf/ocr';
import { t } from '../i18n';

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

/** 一页成图后的 dataURL（`data:image/jpeg;base64,...`） */
export interface VisionInput {
  image: string;
  /** 只用于提示与日志，不参与请求 */
  page?: number;
}

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
 * `maxTokens` 给 4000：一页 60 行、每行带四个坐标，约 1500–2500 token；
 * 不设上限时服务商默认值（常见 512/1024）会把后半页截掉，表现是「只认出半页」。
 */
export async function recognizeOnPage(
  settings: ReaderSettings,
  input: VisionInput,
  opts: AiChatOptions = {},
): Promise<ParsedOcr> {
  const raw = await aiPostChat(settings, visionMessages(input.image), {
    ...opts,
    temperature: 0.1,
    maxTokens: 4000,
  });
  const parsed = parseOcrJson(raw);
  if (!parsed.lines.length && !parsed.text) throw new Error(t('notice.pdf.ocrEmpty'));
  return parsed;
}

/* ─────────── 外部 OCR 服务 ─────────── */

/**
 * 外部服务的约定（极简，方便用 Umi-OCR / PaddleOCR 自己包一层）：
 *
 *   请求 POST <url>
 *        {"image":"<base64，不含 data: 前缀>","mime":"image/jpeg"}
 *   响应 200，任选其一：
 *        {"lines":[{"text":"…","box":[x,y,w,h]}]}      ← 推荐（0..1 或 0..1000）
 *        {"text":"整页文字"}                            ← 只有字，不能划词
 *        [{"text":"…","bbox":[x1,y1,x2,y2]}]            ← 裸数组
 *
 * 外层套了 `data` / `result` 也认（很多服务习惯包一层）。
 */
export interface HttpOcrInput {
  url: string;
  /** 纯 base64（不含 data: 前缀） */
  image: string;
  mime: string;
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

export async function recognizeViaHttp(input: HttpOcrInput): Promise<ParsedOcr> {
  const url = String(input.url ?? '').trim();
  if (!url) throw new Error(t('notice.pdf.ocrNoUrl'));
  let res: Response;
  try {
    res = await window.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: input.image, mime: input.mime || 'image/jpeg' }),
      signal: input.signal,
    });
  } catch (e) {
    if (input.signal?.aborted) throw new Error('已取消');
    throw new Error(t('notice.pdf.ocrOffline', { why: (e as Error)?.message || '网络错误' }));
  }
  if (!res.ok) throw new Error(t('notice.pdf.ocrHttp', { status: String(res.status) }));
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(t('notice.pdf.ocrBadJson'));
  }
  const parsed = parseOcrValue(unwrapOcrBody(body));
  if (!parsed.lines.length && !parsed.text) throw new Error(t('notice.pdf.ocrEmpty'));
  return parsed;
}

/* ─────────── 图 → dataURL ─────────── */

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
    const n = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = data.length - i;
  if (rest === 1) {
    const n = data[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (data[i]! << 16) | (data[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** `data:<mime>;base64,<...>` */
export function dataUrlOf(base64: string, mime = 'image/jpeg'): string {
  return `data:${mime || 'image/jpeg'};base64,${base64}`;
}

/** MIME 归一：pdf.js 出的图是 png，压缩后多半是 jpeg */
export function mimeOf(blob: Blob | null | undefined, fallback = 'image/jpeg'): string {
  const type = String(blob?.type ?? '').split(';')[0]?.trim();
  return type && /^image\//.test(type) ? type : fallback;
}

/** Blob → dataURL（识别用；体量与分辨率由调用方在出图那一步控制） */
export async function blobToDataUrl(blob: Blob | null | undefined): Promise<string> {
  if (!blob) throw new Error(t('notice.pdf.ocrNoImage'));
  const mime = mimeOf(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return dataUrlOf(bytesToBase64(bytes), mime);
}
