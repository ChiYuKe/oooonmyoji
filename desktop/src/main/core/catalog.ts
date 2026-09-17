/**
 * Action 目录：内置 Action + plugins/actions 下的自定义 Action。
 * 二者共享同一份 v2 manifest 格式（schema_version 2），参数元数据只有一份，
 * 运行时（Python）与编辑器（本模块）各自解析同一批 manifest 文件。
 * 文件查找与磁盘读取留在本模块，参数解析等纯逻辑在 shared/workflow/parameters.ts。
 */
import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import {
  PARAMETER_TYPES,
  compileParameters,
  parseParameterDefinition,
  validationMessage,
  type ParameterInfo,
} from '../../shared/workflow/parameters';

export {
  applyParameterDefaults,
  compileParameters,
  parameterToSchema,
  parseParameterDefinition,
} from '../../shared/workflow/parameters';
export type { ParameterInfo } from '../../shared/workflow/parameters';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

/** 从工作区根目录向上查找 oooonmyoji 项目根（存在内置动作包、动作清单或 plugins/actions）。 */
export function discoverProjectRoot(workspaceRoot: string): ProjectInfo {
  let current = workspaceRoot;
  while (current && current !== path.parse(current).root) {
    const builtinPackage = path.join(current, 'src', 'oooonmyoji', 'actions', 'builtin', '__init__.py');
    const manifests = path.join(current, 'src', 'oooonmyoji', 'actions', 'manifests');
    const plugins = path.join(current, 'plugins', 'actions');
    if (fs.existsSync(builtinPackage) || fs.existsSync(manifests) || fs.existsSync(plugins)) {
      return { root: current, found: true };
    }
    current = path.dirname(current);
  }
  return { root: workspaceRoot, found: false };
}
