declare module '*.png' {
  /** 构建期由 esbuild 的 `dataurl` loader 内联成 data URI 字符串 */
  const src: string;
  export default src;
}
