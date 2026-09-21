/**
 * 节点位置锁定：被锁定的卡片不再被拖动，也不会被自动排列移动。
 *
 * 锁只记在文档的编辑器元数据 `_layoutLocks`（节点 id 数组）里——和 `_layout` 一样是
 * `_` 前缀的编辑器私有字段，运行时不读、导出时随文档一起带走（换台机器打开仍然锁定）。
 * 这里只做纯函数读写，改动由调用方包进 `mutate`，保持一次操作一条历史。
 */

/**
 * 文档里锁定的节点 id 集合（缺省/脏数据都安全退化成空集合）。
 *
 * 记忆化：卡片内容签名每个节点都要问一次「锁了吗」，500 节点 × 每帧重建一个 Set 是纯浪费。
 * 缓存键是「文档对象 + 锁数组」两个引用——`toggleNodeLock` 每次都换一个新数组，
 * 撤销回填的是重新解析出来的文档对象，因此两者的任何变化都会让缓存失效。
 */
let cachedRaw: any = null;
let cachedList: any = null;
let cachedIds: Set<string> = new Set();
const EMPTY_IDS: Set<string> = new Set();

export function lockedNodeIds(raw: any): Set<string> {
  const list = raw && Array.isArray(raw._layoutLocks) ? raw._layoutLocks : null;
  if (!list || !list.length) {
    // 没有锁（绝大多数文档）时连缓存都不必动：返回同一个空集合。
    cachedRaw = raw;
    cachedList = list;
    cachedIds = EMPTY_IDS;
    return EMPTY_IDS;
  }
  if (raw === cachedRaw && list === cachedList) return cachedIds;
  const ids = new Set<string>();
  for (const item of list) {
    const id = String(item ?? '');
    if (id) ids.add(id);
  }
  cachedRaw = raw;
  cachedList = list;
  cachedIds = ids;
  return ids;
}

export function isNodeLocked(raw: any, id: string): boolean {
  const key = String(id ?? '');
  return Boolean(key) && lockedNodeIds(raw).has(key);
}

/**
 * 切换一个节点的锁定状态，返回切换后的状态（true = 现在已锁定）。
 *
 * 列表为空时把 `_layoutLocks` 整个删掉，避免在文档里留一个空数组。
 */
export function toggleNodeLock(raw: any, id: string): boolean {
  const key = String(id ?? '');
  if (!raw || !key) return false;
  const list = Array.isArray(raw._layoutLocks) ? raw._layoutLocks.map(String) : [];
  const index = list.indexOf(key);
  if (index >= 0) list.splice(index, 1);
  else list.push(key);
  if (list.length) raw._layoutLocks = list;
  else delete raw._layoutLocks;
  return index < 0;
}
