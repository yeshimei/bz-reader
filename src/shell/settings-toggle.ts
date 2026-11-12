/**
 * 设置页开关：一行数据的翻转规则。
 *
 * 抽出来是为了能被单测覆盖——`shell/actions.ts` 会拖进整个壳层，
 * node 里 import 不动。翻完之后必须重绘，否则开关的 on 态要等下次进入
 * 设置页才刷新（这正是用户报过的「点了不实时显示」）。
 */
export interface ToggleState {
  exportComments: boolean;
  /** 调试日志（数据组）：默认关，开了才往 debug.json 写事件 */
  debugLog: boolean;
  /** 剪藏本（bz 组）：书架多一本跟着剪藏更新的书，内容实时读 bz 剪藏本，默认关 */
  clipBook: boolean;
  /* 曾经这里还有 aiKnowledge：2026-11-07 改成自动识别，开关撤掉，
     判断在 data/bz-bridge（bz 在不在）。2026-11-13 抽进 bz 组后
     仍然没有它——知识盒那一行只报状态。 */
}

/** 返回翻转后的补丁；未知 key 返回 null（不重绘、不写盘） */
export function flipSetting(current: ToggleState, key: string): Partial<ToggleState> | null {
  switch (key) {
    case 'exportComments':
      return { exportComments: !current.exportComments };
    case 'debugLog':
      return { debugLog: !current.debugLog };
    case 'clipBook':
      return { clipBook: !current.clipBook };
    default:
      return null;
  }
}
