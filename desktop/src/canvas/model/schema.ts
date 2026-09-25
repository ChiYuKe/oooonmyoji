/**
 * 参数/引用 JSON schema 工具：定义类型到 schema 的转换与引用类型兼容判断。
 * 纯函数，无外部依赖。
 */

export interface SchemaLike {
  type?: string;
  properties?: Record<string, SchemaLike>;
  items?: SchemaLike;
  prefixItems?: SchemaLike[];
  [key: string]: unknown;
}

export interface RefCandidate {
  ref: string;
  schema: SchemaLike;
}

export interface EditorSchema {
  definitionSchema(definition: unknown): SchemaLike;
  compatibleRefType(expected: SchemaLike | null | undefined, actual: SchemaLike): boolean;
  appendNestedRefs(prefix: string, schema: SchemaLike | null | undefined, out: RefCandidate[], depth?: number): void;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function definitionSchema(definition: unknown): SchemaLike {
  const object = asObject(definition);
  if (!object) return {};
  const type = object.type;
  if (type === 'asset' || type === 'path' || type === 'workflow' || type === 'key' || type === 'color' || type === 'enum') return { type: 'string' };
  // 区域 rect 是定长四元组 [x, y, w, h]：带 title 的 prefixItems 让拆分卡片能排出 X / Y / W / H
  // 四个字段引脚（与 Python `ParameterDefinition.to_schema` 的结构一致）。
  if (type === 'rect') {
    return {
      type: 'array',
      prefixItems: [
        { type: 'integer', title: 'X' },
        { type: 'integer', title: 'Y' },
        { type: 'integer', title: 'W' },
        { type: 'integer', title: 'H' },
      ],
      minItems: 4,
      maxItems: 4,
    };
  }
  if (type === 'point') return { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } } };
  if (type === 'duration') return { type: 'number' };
  if (type === 'any') return {};
  const schema: SchemaLike = typeof type === 'string' ? { type } : {};
  const properties = asObject(object.properties);
  if (type === 'object' && properties) {
    schema.properties = Object.fromEntries(Object.entries(properties).map(([key, child]) => [key, definitionSchema(child)]));
  }
  if (type === 'array') schema.items = definitionSchema(object.items ?? {});
  return schema;
}

function schemaTypes(schema: SchemaLike | null | undefined): Set<string> {
  const object = asObject(schema);
  if (!object) return new Set();
  if (typeof object.type === 'string') return new Set([object.type]);
  if (Array.isArray(object.type)) return new Set(object.type.filter((item): item is string => typeof item === 'string'));
  return new Set();
}

function compatibleRefType(expected: SchemaLike | null | undefined, actual: SchemaLike): boolean {
  const wanted = schemaTypes(expected);
  const offered = schemaTypes(actual);
  if (!wanted.size || !offered.size) return true;
  if (wanted.has('number') && offered.has('integer')) offered.add('number');
  return [...wanted].some((type) => offered.has(type));
}

function appendNestedRefs(prefix: string, schema: SchemaLike | null | undefined, out: RefCandidate[], depth = 0): void {
  const object = asObject(schema);
  if (!object || depth >= 12) return;
  const properties = asObject(object.properties);
  if (object.type === 'object' && properties) {
    for (const [key, child] of Object.entries(properties)) {
      const childObject = asObject(child);
      if (!childObject) continue;
      const ref = `${prefix}.${key}`;
      out.push({ ref, schema: childObject });
      appendNestedRefs(ref, childObject, out, depth + 1);
    }
  }
  if (object.type === 'array') {
    const prefixItems = Array.isArray(object.prefixItems) ? object.prefixItems : [];
    const first = asObject(prefixItems[0]);
    const items = asObject(object.items);
    const item: SchemaLike = first ?? items ?? {};
    const ref = `${prefix}.0`;
    out.push({ ref, schema: item });
    appendNestedRefs(ref, item, out, depth + 1);
  }
}

export function createEditorSchema(): EditorSchema {
  return { definitionSchema, compatibleRefType, appendNestedRefs };
}
