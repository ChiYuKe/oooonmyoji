/**
 * JSON Schema 路径取子 schema：对象按 properties / additionalProperties、数组按
 * prefixItems / items 逐段下钻。两端共同规则的一部分（Python 端在
 * `src/oooonmyoji/workflows/bindings.py` 的 `schema_at_path`）。
 *
 * 单独成模块是为了让 bindings.ts 与 graph.ts 共用而不产生相互依赖。
 */

import { isObject } from './guards';

export function schemaAtPath(schema: Record<string, unknown> | undefined, segments: string[]): Record<string, unknown> | undefined {
  let current = schema;
  for (const segment of segments) {
    if (!current || Object.keys(current).length === 0) return {};
    if (current.type === 'object') {
      const properties = isObject(current.properties) ? current.properties : {};
      if (isObject(properties[segment])) {
        current = properties[segment] as Record<string, unknown>;
        continue;
      }
      if (current.additionalProperties === false) return undefined;
      current = isObject(current.additionalProperties) ? current.additionalProperties : {};
      continue;
    }
    if (current.type === 'array') {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return undefined;
      const prefixItems = Array.isArray(current.prefixItems) ? current.prefixItems : [];
      if (isObject(prefixItems[index])) {
        current = prefixItems[index] as Record<string, unknown>;
        continue;
      }
      // 定长元组（prefixItems + maxItems 封顶）越界就是无效路径：区域 rect 只有 0..3，
      // 写 .4 运行时也取不到值，早点报错比运行时炸掉好。
      if (prefixItems.length && !isObject(current.items) && current.items !== true) {
        const maxItems = typeof current.maxItems === 'number' ? current.maxItems : prefixItems.length;
        if (index >= maxItems) return undefined;
      }
      if (current.items === false) return undefined;
      current = isObject(current.items) ? current.items : {};
      continue;
    }
    return undefined;
  }
  return current;
}
