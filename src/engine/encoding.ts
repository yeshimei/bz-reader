/* ============================================================
 * bz-reader · TXT 字节 → 文本（engine/encoding.ts）
 *
 * 中文 TXT 的四种常见来路，TXT 分支必须都认：
 *   · UTF-8（带不带 BOM）—— 现代编辑器、大多数正版 txt；
 *   · UTF-16LE（FF FE）/ UTF-16BE（FE FF）—— Windows 记事本「Unicode」；
 *   · GBK / GB18030 —— 老作者稿、大量网文站点；
 *   · Big5 —— 台版书。
 *
 * 判定顺序：BOM 最权威，有就用 BOM 说的编码；没 BOM 先按 UTF-8 **严格**解，
 * 解不了再依次试 gb18030、big5，都失败才退回宽松 UTF-8（宁可留替换符，
 * 也不要抛错把整本书拦在门外）。
 *
 * 为什么是纯函数：编码判定不该依赖 vault / DOM，放这里才能直接拿字节数组
 * 写回归测试（A-06）。
 * ============================================================ */

/** 先严格后宽松：候选编码必须用 fatal，否则 gb18030 会把任何字节都「解成功」 */
const CANDIDATES = ['gb18030', 'big5'] as const;

/* 已知局限：GB18030 的字节语法几乎覆盖 Big5，真实台版书仍会先被 gb18030
   解成假名/符号（不会抛错），所以 big5 只在 gb18030 严格失败时生效。
   真要区分两者得靠常用字比例的统计启发式，不在本条范围内——这里保证的是
   「GBK 能读对、解不了时有退路」，而不是「自动识别所有繁体书」。 */

function toBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

function tryStrict(label: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasPrefix(bytes: Uint8Array, ...prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * 把一份 TXT 字节解成字符串。BOM 会被吃掉，不会出现在正文第一行。
 *
 * `input` 收 ArrayBuffer（`vault.adapter.readBinary` 的返回）与任意视图
 * （测试里好直接塞 `Uint8Array`）。
 */
export function decodeTxtBytes(input: ArrayBuffer | ArrayBufferView): string {
  const bytes = toBytes(input);

  if (hasPrefix(bytes, 0xef, 0xbb, 0xbf)) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (hasPrefix(bytes, 0xff, 0xfe)) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (hasPrefix(bytes, 0xfe, 0xff)) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  const asUtf8 = tryStrict('utf-8', bytes);
  if (asUtf8 !== null) return asUtf8;

  for (const label of CANDIDATES) {
    const decoded = tryStrict(label, bytes);
    if (decoded !== null) return decoded;
  }

  /* 走到这儿说明字节在哪个候选里都不合法（半截下载、混编码）。
     宁可显示替换符也别抛——上层会当成「书打不开」。 */
  return new TextDecoder('utf-8').decode(bytes);
}
