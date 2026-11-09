/* pdfjs-dist 把类型挂在包根（types/src/pdf.d.ts），但 build 下的 .mjs 没有
   同名声明。我们按子路径 import（避免默认入口的副作用），这里补两条。 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}

declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}
