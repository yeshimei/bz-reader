import { describe, expect, it, vi } from 'vitest';

/* ============================================================
 * 打不开的 PDF 要给人话（1.0.0 走查清单第 8 条）。
 *
 * pdf.js 拒绝打开时抛的是它内部的错误类型：加密文件是 PasswordException、
 * 结构坏了是 InvalidPDFException。以前这两种都原样冒到失败页上，用户
 * 读到的是一句英文栈信息（「No password given」），既不知道发生了什么，
 * 也不知道跟自己有没有关系。
 *
 * 这里不碰真的 PDF：把 loadPdfjs 换成返回别人写好的 reject，只验
 * 「异常名 → 文案」这一段映射，以及**别的错误原样透传**——把未知错误
 * 也吞掉换成「文件已损坏」会让真正的原因永远查不出来。
 * ============================================================ */

const rejectWith = { name: '' };

vi.mock('../src/engine/pdf/pdfjs', () => ({
  loadPdfjs: async () => ({
    getDocument: () => {
      const err = new Error('pdf.js 内部错误');
      err.name = rejectWith.name;
      return { promise: Promise.reject(err) };
    },
  }),
}));

const { PdfDocument } = await import('../src/engine/pdf/document');

function openRejecting(name: string): Promise<unknown> {
  rejectWith.name = name;
  return PdfDocument.load(new Uint8Array([1, 2, 3])).then(
    () => {
      throw new Error('本该失败却打开了');
    },
    (e: unknown) => e as Error,
  );
}

describe('PDF 打开失败的口径', () => {
  it('加密文件：说「有密码」，不是英文栈信息', async () => {
    const e = (await openRejecting('PasswordException')) as Error;
    expect(e.message).toBe('这本 PDF 有密码，暂时打不开');
  });

  it('结构损坏：说「可能已经损坏」', async () => {
    const e = (await openRejecting('InvalidPDFException')) as Error;
    expect(e.message).toBe('这本 PDF 打不开，文件可能已经损坏');
  });

  it('其他错误原样透传：不冒充成「文件损坏」', async () => {
    const e = (await openRejecting('UnexpectedResponseException')) as Error;
    expect(e.name).toBe('UnexpectedResponseException');
    expect(e.message).toBe('pdf.js 内部错误');
  });
});
