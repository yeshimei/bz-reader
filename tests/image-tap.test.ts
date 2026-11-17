/**
 * 点图放大：判定与图片信息（tests/image-tap.test.ts）
 *
 * 书页在 iframe 里，点图这一下从 host 的 emitTap 出来。判定必须是纯函数：
 * 跨 realm 的元素不能用 instanceof，只看 tagName / getAttribute。
 * 图片优先于链接——EPUB 常把图套在 <a> 里，先判图才不会在链接那关被吃掉。
 */
import { describe, expect, it } from 'vitest';
import { imageHitOf } from '../src/engine/image-tap';

function el(tag: string, attrs: Record<string, string> = {}, parent: unknown = null): any {
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (k: string) => attrs[k] ?? null,
    parentElement: parent,
    closest: (sel: string) => (sel === 'img' && tag.toLowerCase() === 'img' ? node : null),
  };
}
const node = el('img', { src: 'data:image/png;base64,AAAA' });

describe('imageHitOf', () => {
  it('开关关：一律不算点图，照旧翻页', () => {
    expect(imageHitOf(node, false)).toBeNull();
  });

  it('点 img：取出 src', () => {
    expect(imageHitOf(node, true)).toEqual({ src: 'data:image/png;base64,AAAA', kind: 'img' });
  });

  it('img 没有 src：不当图，别弹个空白层', () => {
    expect(imageHitOf(el('img'), true)).toBeNull();
  });

  it('链接包着图片：图片优先，仍然放大', () => {
    const img = el('img', { src: 'data:image/jpeg;base64,BB' });
    const a = el('a', { href: 'x.html' });
    img.parentElement = a;
    expect(imageHitOf(img, true)).toEqual({ src: 'data:image/jpeg;base64,BB', kind: 'img' });
  });

  it('SVG image：读 href / xlink:href', () => {
    const svgImg = el('image', { href: 'data:image/webp;base64,CC' });
    expect(imageHitOf(svgImg, true)).toEqual({ src: 'data:image/webp;base64,CC', kind: 'svg' });
    const legacy = el('image', { 'xlink:href': 'data:image/webp;base64,DD' });
    expect(imageHitOf(legacy, true)).toEqual({ src: 'data:image/webp;base64,DD', kind: 'svg' });
  });

  it('非图片元素：返回 null', () => {
    expect(imageHitOf(el('p'), true)).toBeNull();
    expect(imageHitOf(el('a', { href: 'x' }), true)).toBeNull();
    expect(imageHitOf(null, true)).toBeNull();
  });
});
