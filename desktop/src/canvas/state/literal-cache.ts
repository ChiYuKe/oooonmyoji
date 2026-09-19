/**
 * 参数字面量缓存：按节点参数暂存用户最近输入的固定值。
 *
 * 详情栏与就地编辑器在用户断开绑定 / 切换动作 / 恢复默认值时写回这里，
 * 让「上一次手输的值」在重新编辑时还能回来（而不是直接落到动作默认值）。
 * 缓存挂在画布状态的 `paramLiteralCache` 上，每个画布实例一份，随文档版本失效。
 */
/** 惰性读取（并在缺失时初始化）画布状态的参数字面量缓存。 */
export function parameterLiteralCache(state: { [key: string]: any }): Record<string, any> {
  if (!state.paramLiteralCache || typeof state.paramLiteralCache !== 'object' || Array.isArray(state.paramLiteralCache)) state.paramLiteralCache = {};
  return state.paramLiteralCache;
}

export function parameterLiteralCacheKey(node: { id?: string } | null, name: string): string {
  return `${node && node.id ? node.id : ''}:${name}`;
}
