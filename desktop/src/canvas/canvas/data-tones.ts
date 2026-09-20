/**
 * 数据端点与连线共用的稳定色调。
 * 同一身份字符串在任何卡片、端点和连线上都会得到同一个色号。
 */
export const DATA_TONE_COUNT = 10;

function dataHash(key: unknown): number {
  const text = String(key ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function dataTone(key: unknown): number {
  return dataHash(key) % DATA_TONE_COUNT;
}

/** 完整散列生成连续色相，避免同屏变量被有限色板碰撞成同色。 */
export function dataToneColor(key: unknown): string {
  return `hsl(${dataHash(key) % 360} 62% 60%)`;
}

export function variableDataKey(scope: unknown, name: unknown): string {
  return `${String(scope || 'variables')}.${String(name || '')}`;
}

export function parameterDataKey(nodeId: unknown, param: unknown): string {
  return `node:${String(nodeId || '')}:param:${String(param || '')}`;
}
