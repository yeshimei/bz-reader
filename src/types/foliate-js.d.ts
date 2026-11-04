/**
 * foliate-js 没有类型声明（上游是纯 JS）。这里只补两个入口模块的声明，
 * 真正的类型面在 `types/foliate.ts`，由 `engine/foliate.ts` 一次性 cast。
 */
declare module 'foliate-js/view.js' {
  const mod: Record<string, unknown>;
  export = mod;
}

declare module 'foliate-js/overlayer.js' {
  const mod: Record<string, unknown>;
  export = mod;
}
