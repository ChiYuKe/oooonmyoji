/**
 * 工作流参数定义：与 Action manifest 共享的 v2 参数模型。
 * 纯计算模块（只依赖 Ajv），主进程与画布共用。
 */
import Ajv2020 from 'ajv/dist/2020';
import { CARD_CONTROLS, COLOR_PATTERN, KEY_PATTERN, NUMERIC_TYPES, PARAMETER_TYPES, STRING_TYPES } from '../parameter-types';

export { CARD_CONTROLS, COLOR_PATTERN, KEY_PATTERN, NUMERIC_TYPES, PARAMETER_TYPES, STRING_TYPES };

export interface ParameterInfo {
  type: string;
  display_name?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  editor?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  enum?: unknown[];
  minItems?: number;
  maxItems?: number;
  items?: ParameterInfo;
  properties?: Record<string, ParameterInfo>;
}

const parameterAjv = new Ajv2020({ allErrors: true, strict: false });

const SCALAR_TYPES: Record<string, string> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
};

export function parameterToSchema(param: ParameterInfo): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  const scalar = SCALAR_TYPES[param.type];
  if (scalar) {
    schema.type = scalar;
    if (param.type === 'number' || param.type === 'integer') {
      if (typeof param.min === 'number') schema.minimum = param.min;
      if (typeof param.max === 'number') schema.maximum = param.max;
    }
    if (param.type === 'string') {
      if (typeof param.minLength === 'number') schema.minLength = param.minLength;
      if (typeof param.maxLength === 'number') schema.maxLength = param.maxLength;
    }
  } else if (param.type === 'asset' || param.type === 'path') {
    schema.type = 'string';
    if (typeof param.minLength === 'number') schema.minLength = param.minLength;
    if (typeof param.maxLength === 'number') schema.maxLength = param.maxLength;
  } else if (param.type === 'duration') {
    schema.type = 'number';
    if (typeof param.min === 'number') schema.minimum = param.min;
    if (typeof param.max === 'number') schema.maximum = param.max;
  } else if (param.type === 'enum') {
    schema.type = 'string';
    if (typeof param.minLength === 'number') schema.minLength = param.minLength;
    if (typeof param.maxLength === 'number') schema.maxLength = param.maxLength;
  } else if (param.type === 'key') {
    schema.type = 'string';
    schema.pattern = KEY_PATTERN;
    if (typeof param.minLength === 'number') schema.minLength = param.minLength;
    if (typeof param.maxLength === 'number') schema.maxLength = param.maxLength;
  } else if (param.type === 'color') {
    schema.type = 'string';
    schema.pattern = COLOR_PATTERN;
  } else if (param.type === 'point') {
    schema.type = 'object';
    schema.properties = { x: { type: 'integer' }, y: { type: 'integer' } };
    schema.required = ['x', 'y'];
    schema.additionalProperties = false;
  } else if (param.type === 'rect') {
    schema.type = 'array';
    schema.prefixItems = [{ type: 'integer' }, { type: 'integer' }, { type: 'integer' }, { type: 'integer' }];
    schema.minItems = 4;
    schema.maxItems = 4;
  } else if (param.type === 'array') {
    schema.type = 'array';
    schema.items = param.items ? parameterToSchema(param.items) : {};
    if (typeof param.minItems === 'number') schema.minItems = param.minItems;
    if (typeof param.maxItems === 'number') schema.maxItems = param.maxItems;
  } else if (param.type === 'object') {
    schema.type = 'object';
    if (param.properties && Object.keys(param.properties).length > 0) {
      schema.properties = Object.fromEntries(
        Object.entries(param.properties).map(([key, value]) => [key, parameterToSchema(value)]),
      );
      schema.required = Object.entries(param.properties)
        .filter(([, value]) => value.required === true)
        .map(([key]) => key);
      schema.additionalProperties = false;
    }
    // 无 properties 的 object 参数为自由形态（对应历史 {"type":"object"} 透传）。
  }
  // 'any' 类型不写入 type 约束
  if (Array.isArray(param.enum) && param.enum.length > 0) schema.enum = param.enum;
  if (param.default !== undefined) schema.default = param.default;
  if (typeof param.description === 'string' && param.description) schema.description = param.description;
  return schema;
}

export function compileParameters(parameters: Record<string, ParameterInfo>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, param] of Object.entries(parameters)) {
    properties[name] = parameterToSchema(param);
    if (param.required) required.push(name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applyValueDefaults(param: ParameterInfo, value: unknown): unknown {
  if (param.type === 'object' && param.properties && isPlainObject(value)) {
    const out: Record<string, unknown> = cloneValue(value);
    for (const [name, child] of Object.entries(param.properties)) {
      if (!(name in out) && child.default !== undefined) out[name] = cloneValue(child.default);
      if (name in out) out[name] = applyValueDefaults(child, out[name]);
    }
    return out;
  }
  if (param.type === 'array' && param.items && Array.isArray(value)) {
    return value.map((child) => applyValueDefaults(param.items!, child));
  }
  return cloneValue(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function applyParameterDefaults(
  parameters: Record<string, ParameterInfo>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out = cloneValue(values);
  for (const [name, param] of Object.entries(parameters)) {
    if (!(name in out) && param.default !== undefined) out[name] = cloneValue(param.default);
    if (name in out) out[name] = applyValueDefaults(param, out[name]);
  }
  return out;
}

export function validationMessage(prefix: string, errors: Array<{ instancePath?: string; message?: string }> | null | undefined): string {
  const detail = errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
  return `${prefix}: ${detail || 'validation failed'}`;
}

function validateParameter(param: ParameterInfo, key: string): void {
  if (!PARAMETER_TYPES.includes(param.type as (typeof PARAMETER_TYPES)[number])) {
    throw new Error(`parameter ${key}: unknown type ${param.type}`);
  }
  if (param.type === 'enum') {
    if (!Array.isArray(param.enum) || param.enum.length === 0) {
      throw new Error(`parameter ${key}: enum type requires a non-empty enum list`);
    }
    param.enum.forEach((option, index) => {
      if (typeof option !== 'string') throw new Error(`parameter ${key}.enum[${index}] must be a string`);
    });
  }
  if (!NUMERIC_TYPES.includes(param.type as (typeof NUMERIC_TYPES)[number]) && (param.min !== undefined || param.max !== undefined)) {
    throw new Error(`parameter ${key}: min/max are only valid for numeric types`);
  }
  if (!STRING_TYPES.includes(param.type as (typeof STRING_TYPES)[number]) && (param.minLength !== undefined || param.maxLength !== undefined)) {
    throw new Error(`parameter ${key}: min_length/max_length are only valid for string types`);
  }
  if (param.type !== 'array' && (param.minItems !== undefined || param.maxItems !== undefined)) {
    throw new Error(`parameter ${key}: min_items/max_items are only valid for array`);
  }
  if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
    throw new Error(`parameter ${key}: min must be <= max`);
  }
  if (param.minLength !== undefined && param.maxLength !== undefined && param.minLength > param.maxLength) {
    throw new Error(`parameter ${key}: min_length must be <= max_length`);
  }
  if (param.minItems !== undefined && param.maxItems !== undefined && param.minItems > param.maxItems) {
    throw new Error(`parameter ${key}: min_items must be <= max_items`);
  }

  const schema = parameterToSchema(param);
  let validate: ReturnType<typeof parameterAjv.compile>;
  try {
    validate = parameterAjv.compile(schema);
  } catch (error) {
    throw new Error(`parameter ${key} compiles to an invalid schema: ${(error as Error).message}`);
  }
  for (const [index, value] of (param.enum ?? []).entries()) {
    if (!validate(value)) throw new Error(validationMessage(`parameter ${key}.enum[${index}]`, validate.errors));
  }
  if (param.default !== undefined) {
    const normalized = applyValueDefaults(param, param.default);
    if (!validate(normalized)) throw new Error(validationMessage(`parameter ${key}.default`, validate.errors));
  }
}

export function parseParameterDefinition(raw: unknown, key: string): ParameterInfo {
  const obj = asRecord(raw);
  const info: ParameterInfo = { type: String(obj.type ?? '') };
  if (typeof obj.display_name === 'string') info.display_name = obj.display_name;
  if (obj.required === true) info.required = true;
  if (obj.default !== undefined) info.default = obj.default;
  if (typeof obj.description === 'string') info.description = obj.description;
  if (typeof obj.editor === 'string') info.editor = obj.editor;
  if (typeof obj.min === 'number') info.min = obj.min;
  if (typeof obj.max === 'number') info.max = obj.max;
  if (typeof obj.min_length === 'number') info.minLength = obj.min_length;
  if (typeof obj.max_length === 'number') info.maxLength = obj.max_length;
  if (Array.isArray(obj.enum)) info.enum = obj.enum;
  if (typeof obj.min_items === 'number') info.minItems = obj.min_items;
  if (typeof obj.max_items === 'number') info.maxItems = obj.max_items;
  if (obj.items !== undefined) info.items = parseParameterDefinition(obj.items, `${key}[]`);
  if (obj.properties !== undefined) {
    const props = asRecord(obj.properties);
    const out: Record<string, ParameterInfo> = {};
    for (const [name, value] of Object.entries(props)) out[name] = parseParameterDefinition(value, `${key}.${name}`);
    info.properties = out;
  }
  validateParameter(info, key);
  return info;
}
