/**
 * 书卡右键 / 长按菜单的条目（纯函数，node 里可直接测）。
 *
 * 菜单外壳走 Obsidian 原生 `Menu`：桌面弹在鼠标处，手机是底部动作面板。
 * 这里只定**条目、顺序、图标与禁用条件**，不另造一套视觉。
 *
 * 顺序即使用频次：前几项是高频（打开、看详情、导出、收藏），
 * 管理类动作沉底、并用一道分隔线与上面隔开。
 *
 * 文件丢失时「阅读」禁用而不是隐藏，并补一条「重新定位文件…」：
 * 书还在书架上，用户需要知道「为什么点了没反应」，还得有个能修的地方。
 *
 * 「移出书架」不再是危险项：它现在只归档，进度/划线/书签/想法全留，
 * 重新导入同一份文件就复活——不可逆的只有「清理归档」那种入口。
 *
 * 2026-11-21 起新加的归档项走 `t()`（这个文件的老条目仍是硬编码中文，
 * 整组统一翻译留到以后一次性收；新条目不再往上加中文）。
 */
import { t } from '../i18n';

export type BookMenuAction =
  | 'open'
  | 'detail'
  | 'review'
  | 'enrich'
  | 'export'
  | 'fav'
  | 'done'
  | 'rename'
  | 'shelf'
  | 'relocate'
  | 'restore'
  | 'remove';

export interface BookMenuItem {
  act: BookMenuAction;
  title: string;
  icon: string;
  disabled?: boolean;
  /** 危险动作（不可逆）：宿主菜单里染红 */
  danger?: boolean;
  /** 在这一条之前插一道分隔线 */
  sepBefore?: boolean;
}

export interface BookMenuInput {
  /** 已经标为读完（决定「标为读完 / 标为在读」） */
  done: boolean;
  /** 已收藏（决定「收藏 / 取消收藏」） */
  fav: boolean;
  /** 源文件丢了：只禁「阅读」，另给一条重新定位 */
  missing?: boolean;
  /** 装了 bz Review 才显示「加入复习」（没装就不摆一个点了没反应的项） */
  review?: boolean;
  /** 归档书（换版本后的旧书 / 移出书架）：菜单只留恢复、详情、导出与删除 */
  archived?: boolean;
}

export function bookMenuItems(input: BookMenuInput): BookMenuItem[] {
  /* 归档书不在书架上，菜单只留「怎么把它弄回来 / 看它是什么 / 导出」。
     阅读状态、收藏、归类都还在数据里，恢复回书架后一切照旧。 */
  if (input.archived) {
    return [
      { act: 'restore', title: t('shelf.archived.restore'), icon: 'rotate-ccw' },
      { act: 'detail', title: '书籍详情', icon: 'info' },
      { act: 'export', title: '导出这本书', icon: 'download' },
      { act: 'remove', title: t('shelf.archived.purge'), icon: 'trash', sepBefore: true, danger: true },
    ];
  }
  return [
    { act: 'open', title: '阅读', icon: 'book-open', disabled: !!input.missing },
    /* 文件失联时最该先做的是找文件：放在「阅读」下面，不用翻到菜单底部 */
    ...(input.missing
      ? [{ act: 'relocate' as const, title: '重新定位文件…', icon: 'folder-open' }]
      : []),
    { act: 'detail', title: '书籍详情', icon: 'info' },
    /* 加入复习：把书里的划线/章节做成复习卡，交给 bz Review。
       没装 Review 就不显示——摆一个点了只弹「没装」的项，不如不放。 */
    ...(input.review ? [{ act: 'review' as const, title: '加入复习', icon: 'layers' }] : []),
    /* 2026-11-11：补全信息紧跟详情——两者都回答「这本书是什么」。
       只填空白字段，用户改过的一律不动。 */
    { act: 'enrich', title: '补全信息（AI）', icon: 'sparkles' },
    /* 导出紧跟详情：两者都回答「这本书能产出什么」。摘录存在本机，
       书文件丢了也能导，所以这一条不看 missing。 */
    { act: 'export', title: '导出这本书', icon: 'download' },
    { act: 'fav', title: input.fav ? '取消收藏' : '收藏', icon: 'star' },
    /* 两个方向用两枚图标：check 是「完成」，refresh 是「回到未读完」。
       共用一枚 check 的话，「标为在读」看起来像又要把它标成读完。 */
    { act: 'done', title: input.done ? '标为在读' : '标为读完', icon: input.done ? 'refresh' : 'check' },
    { act: 'rename', title: '改名', icon: 'pencil', sepBefore: true },
    /* 归类与改名同属「整理这本书」：都改的是书怎么摆，不碰它的内容。
       放进同一组、不另起分隔线——分隔线留给「要动书架本身」的动作。 */
    { act: 'shelf', title: '归入分类…', icon: 'folder' },
    { act: 'remove', title: '移出书架', icon: 'trash', sepBefore: true },
  ];
}
