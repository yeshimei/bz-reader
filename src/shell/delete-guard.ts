/**
 * 删除的二次确认（纯函数）。
 *
 * 侧栏书签/划线的删除按钮在触摸屏上容易被误触，而删除是不可撤销的数据丢失。
 * 规则：第一次点只是「上膛」，同一个 id 在窗口内再点一次才真删；超时或换了
 * 另一个 id 就重新上膛。
 */
export interface DeleteArm {
  id: string;
  at: number;
}

export const DELETE_CONFIRM_MS = 4000;

export function confirmDelete(
  prev: DeleteArm | null,
  id: string,
  now: number,
  windowMs = DELETE_CONFIRM_MS,
): { remove: boolean; next: DeleteArm | null } {
  if (prev && prev.id === id && now - prev.at <= windowMs) {
    return { remove: true, next: null };
  }
  return { remove: false, next: { id, at: now } };
}
