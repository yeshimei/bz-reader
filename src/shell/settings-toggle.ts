/**
 * 设置页开关：一行数据的翻转规则。
 *
 * 抽出来是为了能被单测覆盖——`shell/actions.ts` 会拖进整个壳层，
 * node 里 import 不动。翻完之后必须重绘，否则开关的 on 态要等下次进入
 * 设置页才刷新（这正是用户报过的「点了不实时显示」）。
 */
export interface ToggleState {
  exportComments: boolean;
}

/** 返回翻转后的补丁；未知 key 返回 null（不重绘、不写盘） */
export function flipSetting(current: ToggleState, key: string): Partial<ToggleState> | null {
  switch (key) {
    case 'exportComments':
      return { exportComments: !current.exportComments };
    default:
      return null;
  }
}
