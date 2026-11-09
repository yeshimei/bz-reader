import { describe, expect, it } from 'vitest';
import { BASE_FORMATS, BOOK_FORMATS_LABEL, PRO_FORMATS, formatOf } from '../src/data/book-repo';

describe('pdf as a book format', () => {
  it('认出 .pdf，大小写不限', () => {
    expect(formatOf('books/某本书.pdf')).toBe('pdf');
    expect(formatOf('A.PDF')).toBe('pdf');
    expect(formatOf('a.epub')).toBe('epub');
    expect(formatOf('a.docx')).toBeNull();
  });

  it('PDF 属于付费格式，不在基础版里', () => {
    expect(PRO_FORMATS).toContain('pdf');
    expect(BASE_FORMATS).not.toContain('pdf');
  });

  it('格式标签能显示 PDF', () => {
    expect(BOOK_FORMATS_LABEL(['pdf'])).toBe('PDF');
  });
});
