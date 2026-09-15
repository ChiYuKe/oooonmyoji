/*
 * 参数/引用 JSON schema 工具：定义类型到 schema 的转换与引用类型兼容判断。
 * 纯函数，无外部依赖；主文件通过 window.StudioEditorSchema() 获取。
 */
(() => {
  'use strict';

  window.StudioEditorSchema = function StudioEditorSchema() {
  function definitionSchema(definition) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return {};
    const type = definition.type;
    if (type === 'asset' || type === 'path') return { type: 'string' };
    if (type === 'rect') return { type: 'array', items: { type: 'integer' } };
    if (type === 'any') return {};
    const schema = typeof type === 'string' ? { type } : {};
    if (type === 'object' && definition.properties && typeof definition.properties === 'object') {
      schema.properties = Object.fromEntries(Object.entries(definition.properties).map(([key, child]) => [key, definitionSchema(child)]));
    }
    if (type === 'array') schema.items = definitionSchema(definition.items || {});
    return schema;
  }

  function schemaTypes(schema) {
    if (!schema || typeof schema !== 'object') return new Set();
    if (typeof schema.type === 'string') return new Set([schema.type]);
    if (Array.isArray(schema.type)) return new Set(schema.type.filter((item) => typeof item === 'string'));
    return new Set();
  }

  function compatibleRefType(expected, actual) {
    const wanted = schemaTypes(expected);
    const offered = schemaTypes(actual);
    if (!wanted.size || !offered.size) return true;
    if (wanted.has('number') && offered.has('integer')) offered.add('number');
    return [...wanted].some((type) => offered.has(type));
  }

  function appendNestedRefs(prefix, schema, out, depth = 0) {
    if (!schema || typeof schema !== 'object' || depth >= 12) return;
    if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
        const ref = `${prefix}.${key}`;
        out.push({ ref, schema: child });
        appendNestedRefs(ref, child, out, depth + 1);
      }
    }
    if (schema.type === 'array') {
      const item = Array.isArray(schema.prefixItems) && schema.prefixItems[0] && typeof schema.prefixItems[0] === 'object'
        ? schema.prefixItems[0]
        : schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)
          ? schema.items
          : {};
      const ref = `${prefix}.0`;
      out.push({ ref, schema: item });
      appendNestedRefs(ref, item, out, depth + 1);
    }
  }


  return { definitionSchema, compatibleRefType, appendNestedRefs };
  };
})();
