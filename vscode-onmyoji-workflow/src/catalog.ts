/**
 * Action 目录：内置 Action + plugins/actions 下的自定义 Action。
 * 纯逻辑模块（不依赖 vscode API），便于 Node 冒烟测试。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ActionSpecInfo {
  name: string;
  version: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  retrySafe: boolean;
  sideEffect: boolean;
  source: string;
  description: string;
  /** 该 Action 输出的对象字段名（用于 steps.<id>.output.<field> 补全）。数组输出为空。 */
  outputFields: string[];
}

export interface ActionCatalog {
  byName(name: string): ActionSpecInfo | undefined;
  all(): ActionSpecInfo[];
  names(): string[];
  /** 与内置 Action 重名的自定义 Action 清单。 */
  clashes(): string[];
}

function spec(
  name: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>,
  retrySafe: boolean,
  sideEffect: boolean,
  description: string,
  outputFields: string[] = [],
): ActionSpecInfo {
  return {
    name,
    version: '1.0.0',
    inputSchema,
    outputSchema,
    retrySafe,
    sideEffect,
    source: 'builtin',
    description,
    outputFields,
  };
}

export function defaultBuiltinActions(): ActionSpecInfo[] {
  return [
    spec(
      'core.capture',
      { type: 'object', additionalProperties: false },
      { type: 'object' },
      true,
      false,
      '截取当前画面一帧（无参数）。输出 { width, height }，并把该帧保存为“最近一帧”供后续 save_frame 使用。',
      ['width', 'height'],
    ),
    spec(
      'core.save_frame',
      {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, description: '保存到产物目录的文件名，如 01-launcher.png' } },
        additionalProperties: false,
      },
      { type: 'object' },
      true,
      false,
      '把最近一帧保存到当前运行的产物目录。输出 { path }。',
      ['path'],
    ),
    spec(
      'core.sleep',
      {
        type: 'object',
        required: ['seconds'],
        properties: { seconds: { type: 'number', minimum: 0, description: '等待的秒数' } },
        additionalProperties: false,
      },
      { type: 'object' },
      true,
      false,
      '等待 seconds 秒（可取消）。输出 { seconds }。',
      ['seconds'],
    ),
    spec(
      'core.log',
      {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', description: '日志文本' },
          fields: { type: 'object', description: '附加结构化字段（可选）' },
        },
        additionalProperties: false,
      },
      { type: 'object' },
      true,
      false,
      '记录一条日志。输出 { message }。',
      ['message'],
    ),
    spec(
      'core.assert',
      {
        type: 'object',
        required: ['value'],
        properties: {
          value: { description: '要断言为真的值（可引用 $ref）' },
          message: { type: 'string', description: '断言失败时的错误信息（可选）' },
        },
        additionalProperties: false,
      },
      { type: 'object' },
      true,
      false,
      '断言 value 为真，否则工作流以 assertion 失败终止。输出 { asserted }。',
      ['asserted'],
    ),
    spec(
      'vision.match_template',
      {
        type: 'object',
        required: ['template'],
        properties: {
          template: { type: 'string', description: '模板图路径，如 assets/templates/xxx.png' },
          roi: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4, description: '裁剪区域 [x, y, w, h]' },
          threshold: { type: 'number', minimum: 0, maximum: 1, description: '匹配置信度阈值，默认 0.85' },
          max_results: { type: 'integer', minimum: 1, description: '最多返回的匹配数，默认 20' },
        },
        additionalProperties: false,
      },
      { type: 'array' },
      true,
      false,
      '在画面中匹配模板图，返回匹配对象数组（不等待）。输出数组，元素含 x/y/width/height/confidence/reference/center。',
      [],
    ),
    spec(
      'vision.ocr',
      {
        type: 'object',
        properties: { roi: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4, description: '裁剪区域 [x, y, w, h]' } },
        additionalProperties: false,
      },
      { type: 'array' },
      true,
      false,
      '对画面（可选 roi）做 OCR，返回识别文本项数组。',
      [],
    ),
    spec(
      'vision.wait_template',
      {
        type: 'object',
        required: ['template', 'timeout_seconds'],
        properties: {
          template: { type: 'string', description: '模板图路径' },
          timeout_seconds: { type: 'number', minimum: 0, description: '等待超时秒数，超时则失败' },
          present: { type: 'boolean', description: 'true 等待出现；false 等待消失。默认 true' },
          roi: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4, description: '裁剪区域 [x, y, w, h]' },
          threshold: { type: 'number', minimum: 0, maximum: 1, description: '匹配置信度阈值，默认 0.85' },
        },
        additionalProperties: false,
      },
      { type: 'array' },
      true,
      false,
      '等待模板出现（或消失，present=false），超时前满足则成功。输出匹配数组。',
      [],
    ),
    spec(
      'input.tap',
      {
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', description: '点击 X 坐标（参考分辨率坐标）' },
          y: { type: 'number', description: '点击 Y 坐标（参考分辨率坐标）' },
          hold_ms: { type: 'integer', minimum: 0, description: '按住毫秒数，默认 0' },
          random_offset: { type: 'integer', minimum: 0, description: '在 X/Y 方向分别随机偏移的最大像素数，默认 0' },
          random_interval: {
            type: 'array',
            prefixItems: [
              { type: 'number', minimum: 0 },
              { type: 'number', minimum: 0 },
            ],
            minItems: 2,
            maxItems: 2,
            description: '点击前随机等待区间 [最小秒数, 最大秒数]，默认 [0, 0]',
          },
        },
        additionalProperties: false,
      },
      { type: 'object' },
      false,
      true,
      '在 (x, y) 处点击，可配置随机偏移和随机点击前等待。有输入副作用，默认不可自动重试。输出实际点击坐标、偏移量和等待间隔。',
      ['x', 'y', 'offset_x', 'offset_y', 'interval_seconds'],
    ),
    spec(
      'input.tap_match',
      {
        type: 'object',
        required: ['match'],
        properties: {
          match: { type: 'object', description: '匹配对象，通常引用 steps.<id>.output.0' },
          revalidate: { type: 'boolean', description: '点击前重新截图验证匹配是否仍在，默认 true' },
          hold_ms: { type: 'integer', minimum: 0, description: '按住毫秒数，默认 0' },
          random_offset: { type: 'integer', minimum: 0, description: '在匹配中心 X/Y 方向分别随机偏移的最大像素数，默认 0' },
          random_interval: {
            type: 'array',
            prefixItems: [
              { type: 'number', minimum: 0 },
              { type: 'number', minimum: 0 },
            ],
            minItems: 2,
            maxItems: 2,
            description: '点击前随机等待区间 [最小秒数, 最大秒数]，默认 [0, 0]',
          },
        },
        additionalProperties: false,
      },
      { type: 'object' },
      false,
      true,
      '点击匹配结果中心，可配置随机偏移和随机点击前等待。有输入副作用，默认不可自动重试。输出实际点击坐标、偏移量和等待间隔。',
      ['x', 'y', 'offset_x', 'offset_y', 'interval_seconds', 'revalidated'],
    ),
    spec(
      'workflow.run',
      {
        type: 'object',
        required: ['workflow'],
        properties: {
          workflow: { type: 'string', minLength: 1, description: '子工作流 ID、JSON 文件名或 workflows/ 下的路径' },
          inputs: { type: 'object', description: '传给子工作流的输入（按子工作流 inputs_schema 校验），可含 $ref 引用' },
        },
        additionalProperties: false,
      },
      { type: 'object' },
      false,
      true,
      '运行另一个工作流（脚本嵌套调用）。子脚本完成后返回“回执”输出 { workflow, status, output }：status 为 succeeded/failed/cancelled，供 on_success/on_failure 分支与后续步骤 $ref 判断。递归调用会被拦截。',
      ['workflow', 'status', 'output'],
    ),
  ];
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
    if (!fs.statSync(dir).isDirectory()) {
      continue;
    }
    const manifestPath = path.join(dir, 'action.json');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const name = String(manifest.name ?? '');
      if (!name) {
        errors.push(`${manifestPath}: 缺少 name`);
        continue;
      }
      const inputSchema = (manifest.input_schema as Record<string, unknown>) ?? { type: 'object' };
      const outputSchema = (manifest.output_schema as Record<string, unknown>) ?? { type: 'object' };
      const outputFields: string[] = [];
      const outProps = (outputSchema.properties as Record<string, unknown> | undefined);
      if (outputSchema.type === 'object' && outProps) {
        outputFields.push(...Object.keys(outProps));
      }
      actions.push({
        name,
        version: String(manifest.version ?? '0.0.0'),
        inputSchema,
        outputSchema,
        retrySafe: manifest.retry_safe === true,
        sideEffect: manifest.side_effect === true,
        source: manifestPath,
        description: typeof manifest.description === 'string' ? manifest.description : `自定义 Action（${manifestPath}）`,
        outputFields,
      });
    } catch (err) {
      errors.push(`${manifestPath}: 解析失败 ${(err as Error).message}`);
    }
  }
  return { actions, errors };
}

export function buildCatalog(builtin: ActionSpecInfo[], custom: ActionSpecInfo[]): ActionCatalog {
  const byName = new Map<string, ActionSpecInfo>();
  const clashes: string[] = [];
  for (const item of builtin) {
    byName.set(item.name, item);
  }
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
  const custom = loadCustomActions(projectRoot);
  return buildCatalog(defaultBuiltinActions(), custom.actions);
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
