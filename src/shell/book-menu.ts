/**
 * 书卡右键 / 长按菜单的条目（纯函数，node 里可直接测）。
 *
 * 菜单外壳走 Obsidian 原生 `Menu`：桌面弹在鼠标处，手机是底部动作面板。
 * 这里只定**条目、顺序、图标与禁用条件**，不另造一套视觉。
 *
 * 顺序即使用频次：前三项是高频（打开、看详情、收藏），
 * 危险动作沉底、并用一道分隔线与上面隔开。
 *
 * 文件丢失时「阅读」禁用而不是隐藏：书还在书架上，用户需要知道
 * 「为什么点了没反应」，而不是以为菜单坏了。
 */

export type BookMenuAction = 'open' | 'detail' | 'fav' | 'done' | 'rename' | 'remove';

export interface BookMenuItem {
  act: BookMenuAction;
  title: string;
  icon: string;
  disabled?: boolean;
  /** 危险动作（移除书库）：宿主菜单里染红 */
  danger?: boolean;
  /** 在这一条之前插一道分隔线 */
  sepBefore?: boolean;
}

export interface BookMenuInput {
  /** 已经标为读完（决定「标为读完 / 标为在读」） */
  done: boolean;
  /** 已收藏（决定「收藏 / 取消收藏」） */
  fav: boolean;
  /** 源文件丢了：只禁「阅读」，其余照旧 */
  missing?: boolean;
}

export function bookMenuItems(input: BookMenuInput): BookMenuItem[] {
  return [
    { act: 'open', title: '阅读', icon: 'book-open', disabled: !!input.missing },
    { act: 'detail', title: '书籍详情', icon: 'info' },
    { act: 'fav', title: input.fav ? '取消收藏' : '收藏', icon: 'star' },
    /* 两个方向用两枚图标：check 是「完成」，refresh 是「回到未读完」。
       共用一枚 check 的话，「标为在读」看起来像又要把它标成读完。 */
    { act: 'done', title: input.done ? '标为在读' : '标为读完', icon: input.done ? 'refresh' : 'check' },
    { act: 'rename', title: '改名', icon: 'pencil', sepBefore: true },
    { act: 'remove', title: '移除书库', icon: 'trash', danger: true },
  ];
}
