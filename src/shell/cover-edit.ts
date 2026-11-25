/* ============================================================
 * bz-reader · 封面上传（shell/cover-edit.ts）
 *
 * 用户在「编辑书籍信息」里点「上传替换封面」：选一张本地图片，必要时
 * 等比压到书架合适的尺寸，再交给 data/cover.ts 落盘。
 *
 * 为什么要压：书架封面墙一屏十几张，手机上下载的相册图动辄 4~8MB，
 * 原样存进去下次开书架要逐张解码，滚动会卡；压到最长边 1400、约 1.2MB
 * 以内，肉眼几乎看不出差别。
 *
 * 选图用浏览器自己的 `input[type=file]`：桌面弹文件对话框，手机弹相册，
 * 一套代码两端都能用。
 * ============================================================ */
import { extOfMime } from '../data/cover-name';

/** 压缩阈值：最长边与目标体积 */
const MAX_EDGE = 1400;
const MAX_BYTES = 1_200_000;

export interface PreparedCover {
  buf: ArrayBuffer;
  /** 落盘用的扩展名（jpg / png / webp / …） */
  ext: string;
}

/** 弹层里的文件输入是常驻的（桌面/手机共用），这里只负责把选中的图处理掉 */

/**
 * 读图并（必要时）压缩。非图片、读不出来返回 null。
 *
 * 小图原样保存（不重编码，避免把一张干净 PNG 压出色块）；
 * 大图等比缩到最长边 1400 后转 JPEG。
 */
export async function prepareCoverImage(file: File): Promise<PreparedCover | null> {
  const type = String(file.type || '');
  if (type && !type.startsWith('image/')) return null;
  let raw: ArrayBuffer;
  try {
    raw = await file.arrayBuffer();
  } catch {
    return null;
  }
  if (!raw.byteLength) return null;
  const ext = extOfMime(type || file.name.split('.').pop() || 'jpg');
  if (raw.byteLength <= MAX_BYTES) return { buf: raw, ext };

  const shrunk = await shrinkCover(raw, type);
  return shrunk ? { buf: shrunk, ext: 'jpg' } : { buf: raw, ext };
}

async function shrinkCover(buf: ArrayBuffer, mime: string): Promise<ArrayBuffer | null> {
  const url = URL.createObjectURL(new Blob([buf], { type: mime || 'image/jpeg' }));
  try {
    const img = await loadImage(url);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longest) return null;
    const scale = Math.min(1, MAX_EDGE / longest);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = createEl('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    /* JPEG 没有透明通道：先铺白底，否则透明 PNG 缩完会变成黑底 */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.88);
    });
    return out ? await out.arrayBuffer() : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}
