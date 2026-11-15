/* ============================================================
 * bz-reader · 识别通道的连通性自检（shell/ocr-probe.ts）
 *
 * 设置页那颗「测试连接」：不用先去认一页，就能知道地址、密钥、模型
 * 这一串到底通不通。三种结果分开说，别混成一句「失败」——
 * 用户能做的补救完全不同：
 *   ok    连上了，而且每行带位置（正式识别也能划词）
 *   text  连上了，但只回整页文字（能搜索朗读，不能划词）
 *   fail  没通：地址/密钥/额度/CORS 各自带自己的话
 *
 * 请求必须和正式识别走**同一条路径**（浏览器直连，不是 Obsidian 的
 * requestUrl）：用 requestUrl 测通只说明服务活着，正式识别仍会被跨域拦掉，
 * 那就是「测试通过、真用失败」，比不测更误导。
 * ============================================================ */

import {
  bytesToBase64,
  dataUrlOf,
  recognizeViaHttp,
  recognizeViaVision,
} from '../data/ai-vision';
import { pdfOcrEngineOf, pdfOcrReady, type ReaderSettings } from '../data/settings';
import type { ParsedOcr } from '../engine/pdf/ocr';
import { t } from '../i18n';

export interface OcrProbeOutcome {
  level: 'ok' | 'text' | 'fail';
  /** 直接给用户看的一句话 */
  message: string;
}

export interface OcrProbeShot {
  /** 不带 data: 前缀的 base64 */
  base64: string;
  mime: string;
  width: number;
  height: number;
}

/**
 * 一张内置的小测试图（480×140，白底黑字）。
 *
 * 为什么不拿当前打开的书页：设置页可能根本没开书；开着的书也不一定是
 * 扫描页（文字版随便认一页都能过，测不出什么）。内置图每次一样，
 * 失败时能确定是配置问题，不是这张图的问题。
 *
 * 内容只用 ASCII：这里量的是「通不通、有没有行位置」，不验中文准确率。
 */
export function probeImage(): OcrProbeShot | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 40px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('BZ READER OCR 123', 22, 52);
    ctx.font = '28px sans-serif';
    ctx.fillText('connection test', 22, 104);
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] ?? '';
    if (!base64) return null;
    return { base64, mime: 'image/png', width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

/** 请求回来的结果该怎么说 */
export function describeOcrProbe(parsed: Pick<ParsedOcr, 'lines' | 'layout' | 'text'>): OcrProbeOutcome {
  const n = Array.isArray(parsed.lines) ? parsed.lines.length : 0;
  if (n > 0) {
    return { level: 'ok', message: t('settings.pdfOcrProbe.ok', { n: String(n) }) };
  }
  if (String(parsed.text ?? '').trim()) {
    return { level: 'text', message: t('settings.pdfOcrProbe.text') };
  }
  return { level: 'fail', message: t('settings.pdfOcrProbe.empty') };
}

/**
 * 跑一次自检。`shot` 由调用方给（真机是 `probeImage`，测试里直接塞假图）。
 *
 * 没配好时不发请求：把空配置发出去，接口只会回 401/404，
 * 用户看到的是服务端的错，而不是「你还没填」。
 */
export async function ocrProbe(
  settings: ReaderSettings,
  shot: () => Promise<OcrProbeShot | null>,
): Promise<OcrProbeOutcome> {
  const chosen = settings.pdfOcr.engine;
  const url = String(settings.pdfOcr.url ?? '').trim();
  if (chosen === 'http' && !url) return { level: 'fail', message: t('notice.pdf.ocrNoUrl') };
  if (!pdfOcrReady(settings)) return { level: 'fail', message: t('notice.pdf.ocrNoKey') };

  let image: OcrProbeShot | null = null;
  try {
    image = await shot();
  } catch {
    image = null;
  }
  if (!image) return { level: 'fail', message: t('notice.pdf.ocrNoImage') };

  const engine = pdfOcrEngineOf(settings);
  try {
    const parsed =
      engine === 'http'
        ? await recognizeViaHttp({
            url,
            image: image.base64,
            mime: image.mime,
            width: image.width,
            height: image.height,
          })
        : await recognizeViaVision(
            {
              baseUrl: settings.pdfOcr.baseUrl,
              apiKey: settings.pdfOcr.apiKey,
              model: settings.pdfOcr.model,
            },
            dataUrlOf(image.base64, image.mime),
            { timeoutMs: 60_000 },
          );
    return describeOcrProbe(parsed);
  } catch (e) {
    const message = (e as Error)?.message || t('settings.pdfOcrProbe.failed');
    return { level: 'fail', message };
  }
}

/** 给测试用：blob → 自检要的形状 */
export async function shotOfBlob(blob: Blob): Promise<OcrProbeShot> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: bytesToBase64(bytes),
    mime: String(blob.type || 'image/png').split(';')[0] || 'image/png',
    width: 0,
    height: 0,
  };
}
