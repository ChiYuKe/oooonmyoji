/**
 * Action 目录：内置 Action + plugins/actions 下的自定义 Action。
 * 二者共享同一份 v2 manifest 格式（schema_version 2），参数元数据只有一份，
 * 运行时（Python）与编辑器（本模块）各自解析同一批 manifest 文件。
 * 纯逻辑模块（不依赖 vscode API），便于 Node 冒烟测试。
 */
import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';

export interface ParameterInfo {
  type: string;
  /** Workflow blackboard visibility. Action manifests do not use this field. */
  public?: boolean;
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

export interface ActionSpecInfo {
  name: string;
  version: string;
  entry: string;
  description: string;
  parameters: Record<string, ParameterInfo>;
  /** 由参数编译得到的 JSON Schema（运行时同源）。 */
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** 该 Action 输出的对象字段名（用于 nodes.<node>.output.<field> 补全）。数组输出为空。 */
  outputFields: string[];
  retry: string;
  retrySafe: boolean;
  sideEffect: boolean;
  source: string;
}

export interface ActionCatalog {
  byName(name: string): ActionSpecInfo | undefined;
  all(): ActionSpecInfo[];
  names(): string[];
  /** 与内置 Action 重名的自定义 Action 清单。 */
  clashes(): string[];
}

const PARAMETER_TYPES = ['string', 'number', 'integer', 'boolean', 'rect', 'asset', 'path', 'array', 'object', 'any'] as const;
const RETRY_MODES = ['safe', 'unsafe'] as const;
const ACTION_MANIFEST_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['schema_version', 'name', 'entry', 'parameters'],
  properties: {
    schema_version: { const: 2 },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    entry: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    parameters: { type: 'object', additionalProperties: { $ref: '#/$defs/parameter' } },
    outputs: { type: 'object' },
    effects: {
      type: 'object',
      properties: {
        side_effect: { type: 'boolean' },
        retry: { enum: [...RETRY_MODES] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
  $defs: {
    parameter: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { enum: [...PARAMETER_TYPES] },
        required: { type: 'boolean' },
        default: {},
        description: { type: 'string' },
        editor: { type: 'string' },
        min: { type: 'number' },
        max: { type: 'number' },
        min_length: { type: 'integer', minimum: 0 },
        max_length: { type: 'integer', minimum: 0 },
        enum: { type: 'array', minItems: 1 },
        min_items: { type: 'integer', minimum: 0 },
        max_items: { type: 'integer', minimum: 0 },
        items: { $ref: '#/$defs/parameter' },
        properties: { type: 'object', additionalProperties: { $ref: '#/$defs/parameter' } },
      },
      additionalProperties: false,
    },
  },
};

const schemaAjv = new Ajv2020({ allErrors: true, strict: false });
const validateManifestShape = schemaAjv.compile(ACTION_MANIFEST_SCHEMA);

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

function validationMessage(prefix: string, errors: typeof validateManifestShape.errors): string {
  const detail = errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
  return `${prefix}: ${detail || 'validation failed'}`;
}

function validateParameter(param: ParameterInfo, key: string): void {
  if (!PARAMETER_TYPES.includes(param.type as (typeof PARAMETER_TYPES)[number])) {
    throw new Error(`parameter ${key}: unknown type ${param.type}`);
  }
  if (!['number', 'integer'].includes(param.type) && (param.min !== undefined || param.max !== undefined)) {
    throw new Error(`parameter ${key}: min/max are only valid for numeric types`);
  }
  if (!['string', 'asset', 'path'].includes(param.type) && (param.minLength !== undefined || param.maxLength !== undefined)) {
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
  let validate: ReturnType<Ajv2020['compile']>;
  try {
    validate = schemaAjv.compile(schema);
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
  if (typeof obj.public === 'boolean') info.public = obj.public;
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

export function parseManifest(raw: unknown): ActionSpecInfo | undefined {
  if (!validateManifestShape(raw)) {
    throw new Error(validationMessage('invalid Action manifest', validateManifestShape.errors));
  }
  const obj = asRecord(raw);
  const name = typeof obj.name === 'string' ? obj.name : '';
  if (!name) return undefined;
  const parametersRaw = asRecord(obj.parameters);
  const parameters: Record<string, ParameterInfo> = {};
  for (const [key, value] of Object.entries(parametersRaw)) parameters[key] = parseParameterDefinition(value, key);
  const effects = asRecord(obj.effects);
  const retry = typeof effects.retry === 'string' ? effects.retry : 'unsafe';
  const outputSchema = asRecord(obj.outputs);
  try {
    schemaAjv.compile(outputSchema);
  } catch (error) {
    throw new Error(`Action ${name}: outputs is not a valid JSON Schema: ${(error as Error).message}`);
  }
  const outputFields: string[] = [];
  const outProps = asRecord(outputSchema.properties);
  if (outputSchema.type === 'object' && Object.keys(outProps).length > 0) {
    outputFields.push(...Object.keys(outProps));
  }
  return {
    name,
    version: typeof obj.version === 'string' ? obj.version : '1.0.0',
    entry: typeof obj.entry === 'string' ? obj.entry : '',
    description: typeof obj.description === 'string' ? obj.description : '',
    parameters,
    inputSchema: compileParameters(parameters),
    outputSchema,
    outputFields,
    retry,
    retrySafe: retry === 'safe',
    sideEffect: effects.side_effect === true,
    source: '',
  };
}

function readManifests(root: string): { actions: ActionSpecInfo[]; errors: string[] } {
  const actions: ActionSpecInfo[] = [];
  const errors: string[] = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { actions, errors };
  for (const file of fs.readdirSync(root).sort()) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    const manifestPath = path.join(root, file);
    try {
      const parsed = parseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      if (!parsed) {
        errors.push(`${manifestPath}: 缺少 name`);
        continue;
      }
      parsed.source = manifestPath;
      actions.push(parsed);
    } catch (err) {
      errors.push(`${manifestPath}: 解析失败 ${(err as Error).message}`);
    }
  }
  return { actions, errors };
}

/** 读取内置 Action manifest（与 Python 运行时共享的同一批文件）。 */
export function loadBuiltinActions(projectRoot: string): { actions: ActionSpecInfo[]; errors: string[] } {
  const root = path.join(projectRoot, 'src', 'oooonmyoji', 'actions', 'manifests');
  const loaded = readManifests(root);
  for (const item of loaded.actions) item.source = 'builtin';
  return loaded;
}

/** 读取 plugins/actions/<dir>/action.json，返回自定义 Action 清单。 */
export function loadCustomActions(projectRoot: string): { actions: ActionSpecInfo[]; errors: string[] } {
  const actions: ActionSpecInfo[] = [];
  const errors: string[] = [];
  const root = path.join(projectRoot, 'plugins', 'actions');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { actions, errors };
  }
  for (const dirName of fs.readdirSync(root).sort()) {
    const dir = path.join(root, dirName);
    if (!fs.statSync(dir).isDirectory()) continue;
    const manifestPath = path.join(dir, 'action.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const parsed = parseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      if (!parsed) {
        errors.push(`${manifestPath}: 缺少 name`);
        continue;
      }
      parsed.source = manifestPath;
      actions.push(parsed);
    } catch (err) {
      errors.push(`${manifestPath}: 解析失败 ${(err as Error).message}`);
    }
  }
  return { actions, errors };
}

export function buildCatalog(builtin: ActionSpecInfo[], custom: ActionSpecInfo[]): ActionCatalog {
  const byName = new Map<string, ActionSpecInfo>();
  const clashes: string[] = [];
  for (const item of builtin) byName.set(item.name, item);
  for (const item of custom) {
    if (byName.has(item.name)) {
      clashes.push(item.name);
      continue;
    }
    byName.set(item.name, item);
  }
  const all = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  return {
    byName: (name: string) => byName.get(name),
    all: () => all,
    names: () => all.map((item) => item.name),
    clashes: () => clashes,
  };
}

export function loadActionCatalog(projectRoot: string): ActionCatalog {
  const builtin = loadBuiltinActions(projectRoot);
  const custom = loadCustomActions(projectRoot);
  return buildCatalog(builtin.actions, custom.actions);
}

export interface ProjectInfo {
  root: string;
  found: boolean;
}

/** 从工作区根目录向上查找 oooonmyoji 项目根（存在 src/oooonmyoji/actions/builtin.py 或 plugins/actions）。 */
export function discoverProjectRoot(workspaceRoot: string): ProjectInfo {
  let current = workspaceRoot;
  while (current && current !== path.parse(current).root) {
    const marker = path.join(current, 'src', 'oooonmyoji', 'actions', 'builtin.py');
    const plugins = path.join(current, 'plugins', 'actions');
    if (fs.existsSync(marker) || fs.existsSync(plugins)) {
      return { root: current, found: true };
    }
    current = path.dirname(current);
  }
  return { root: workspaceRoot, found: false };
}
