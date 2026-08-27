/**
 * 工作流解析、语义校验与动态 JSON Schema 构建。纯逻辑模块（不依赖 vscode API）。
 */
import { ActionCatalog } from './catalog';

export const TERMINALS = ['$success', '$failure', '$cancelled'] as const;
export const CONDITION_OPERATORS = ['exists', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'and', 'or', 'not'] as const;

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  /** JSONPath（键/下标序列），用于在 AST 中定位节点。 */
  path: (string | number)[];
  message: string;
  severity: Severity;
  code?: string;
}

export interface StepInfo {
  id: string;
  action: string;
  index: number;
  hasWhen: boolean;
  onSuccess?: string;
  onFailure?: string;
  onSkip?: string;
  retry?: unknown;
  timeoutSeconds?: number;
}

export interface WorkflowInfo {
  raw: Record<string, unknown> | null;
  id?: string;
  version?: string;
  entry?: string;
  referenceResolution?: number[];
  limits?: Record<string, unknown>;
  inputsSchema: Record<string, unknown> | null;
  inputsProps: string[];
  steps: StepInfo[];
  stepIds: string[];
  rawSteps: unknown[];
}

export function parseWorkflow(raw: unknown): WorkflowInfo {
  const info: WorkflowInfo = { raw: null, inputsSchema: null, inputsProps: [], steps: [], stepIds: [], rawSteps: [] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return info;
  }
  const wf = raw as Record<string, unknown>;
  info.raw = wf;
  if (typeof wf.id === 'string') info.id = wf.id;
  if (typeof wf.version === 'string') info.version = wf.version;
  if (typeof wf.entry === 'string') info.entry = wf.entry;
  if (Array.isArray(wf.reference_resolution)) info.referenceResolution = wf.reference_resolution as number[];
  if (wf.limits && typeof wf.limits === 'object' && !Array.isArray(wf.limits)) {
    info.limits = wf.limits as Record<string, unknown>;
  }
  if (wf.inputs_schema && typeof wf.inputs_schema === 'object' && !Array.isArray(wf.inputs_schema)) {
    info.inputsSchema = wf.inputs_schema as Record<string, unknown>;
    const props = info.inputsSchema.properties as Record<string, unknown> | undefined;
    if (props) info.inputsProps = Object.keys(props);
  }
  if (!Array.isArray(wf.steps)) {
    return info;
  }
  info.rawSteps = wf.steps;
  info.steps = (wf.steps as unknown[]).map((item, index) => {
    const step: StepInfo = { id: '', action: '', index, hasWhen: false };
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      if (typeof o.id === 'string') step.id = o.id;
      if (typeof o.action === 'string') step.action = o.action;
      step.hasWhen = o.when !== undefined;
      if (typeof o.on_success === 'string') step.onSuccess = o.on_success;
      if (typeof o.on_failure === 'string') step.onFailure = o.on_failure;
      if (typeof o.on_skip === 'string') step.onSkip = o.on_skip;
      step.retry = o.retry;
      if (typeof o.timeout_seconds === 'number') step.timeoutSeconds = o.timeout_seconds;
    }
    return step;
  });
  info.stepIds = info.steps.filter((s) => s.id).map((s) => s.id);
  return info;
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function validateRefValue(value: string, path: (string | number)[], issues: ValidationIssue[], stepIds: Set<string>): void {
  const parts = value.split('.');
  const all = (arr: string[]) => arr.length > 0 && arr.every((p) => p.length > 0);
  if (parts.length >= 2 && parts[0] === 'inputs' && all(parts.slice(1))) {
    return;
  }
  if (parts.length >= 4 && parts[0] === 'steps' && parts[2] === 'output' && stepIds.has(parts[1]) && all(parts.slice(3))) {
    return;
  }
  issues.push({
    path,
    message: `无效的结构化引用 "${value}"。合法形式：inputs.<字段> 或 steps.<步骤id>.output.<字段>`,
    severity: 'error',
    code: 'ref.invalid',
  });
}

function validateRefObject(node: unknown, path: (string | number)[], issues: ValidationIssue[], stepIds: Set<string>): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    issues.push({ path, message: '必须是一个仅含 $ref 的对象', severity: 'error', code: 'ref.shape' });
    return;
  }
  const obj = node as Record<string, unknown>;
  if (Object.keys(obj).length !== 1 || typeof obj.$ref !== 'string') {
    issues.push({ path, message: '$ref 对象必须只包含一个字符串 $ref', severity: 'error', code: 'ref.shape' });
    return;
  }
  validateRefValue(obj.$ref, [...path, '$ref'], issues, stepIds);
}

function validateScalarOrRef(node: unknown, path: (string | number)[], issues: ValidationIssue[], stepIds: Set<string>): void {
  if (isScalar(node)) return;
  if (node && typeof node === 'object' && !Array.isArray(node) && '$ref' in (node as Record<string, unknown>)) {
    validateRefObject(node, path, issues, stepIds);
    return;
  }
  // 引擎允许嵌套结构作为操作数（运行时递归解析其中的 $ref），因此递归校验引用即可
  validateRefsInTree(node, path, issues, stepIds);
}

function validateCondition(node: unknown, path: (string | number)[], issues: ValidationIssue[], stepIds: Set<string>): void {
  if (typeof node === 'boolean') return;
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    issues.push({ path, message: 'when 必须是布尔值或条件对象', severity: 'error', code: 'when.shape' });
    return;
  }
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 1 && keys[0] === '$ref') {
    issues.push({
      path,
      message: 'when 不能直接写成一个 $ref（引擎静态校验会放过，但运行时会报 unsupported operator: $ref）；请改用 exists/eq 等条件',
      severity: 'error',
      code: 'when.ref',
    });
    return;
  }
  if (keys.length !== 1 || !(CONDITION_OPERATORS as readonly string[]).includes(keys[0])) {
    issues.push({
      path,
      message: `when 必须只包含一个支持的条件运算符：${CONDITION_OPERATORS.join(', ')}`,
      severity: 'error',
      code: 'when.operator',
    });
    return;
  }
  const op = keys[0];
  const operands = obj[op];
  if (op === 'and' || op === 'or') {
    if (!Array.isArray(operands) || operands.length === 0) {
      issues.push({ path: [...path, op], message: `${op} 必须是非空数组`, severity: 'error', code: 'when.operands' });
      return;
    }
    operands.forEach((child, index) => validateCondition(child, [...path, op, index], issues, stepIds));
  } else if (op === 'not') {
    validateCondition(operands, [...path, 'not'], issues, stepIds);
  } else if (op === 'exists') {
    validateRefObject(operands, [...path, 'exists'], issues, stepIds);
  } else {
    if (!Array.isArray(operands) || operands.length !== 2) {
      issues.push({ path: [...path, op], message: `${op} 必须包含两个操作数`, severity: 'error', code: 'when.operands' });
      return;
    }
    operands.forEach((child, index) => validateScalarOrRef(child, [...path, op, index], issues, stepIds));
  }
}

/** 递归遍历任意 JSON 子树，校验其中所有 $ref。 */
export function validateRefsInTree(node: unknown, path: (string | number)[], issues: ValidationIssue[], stepIds: Set<string>): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, index) => validateRefsInTree(child, [...path, index], issues, stepIds));
    return;
  }
  const obj = node as Record<string, unknown>;
  if ('$ref' in obj) {
    validateRefObject(obj, path, issues, stepIds);
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    validateRefsInTree(value, [...path, key], issues, stepIds);
  }
}

function outgoingTargets(steps: StepInfo[], index: number): string[] {
  const step = steps[index];
  const next = index + 1 < steps.length ? steps[index + 1].id : '$success';
  return [
    step.onSuccess ?? next,
    step.onFailure ?? '$failure',
    step.onSkip ?? next,
  ];
}

export function validateWorkflow(raw: unknown, catalog: ActionCatalog): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({ path: [], message: '工作流必须是 JSON 对象', severity: 'error', code: 'workflow.shape' });
    return issues;
  }
  const wf = raw as Record<string, unknown>;
  for (const field of ['schema_version', 'id', 'version', 'reference_resolution', 'entry', 'steps']) {
    if (!(field in wf)) {
      issues.push({ path: [field], message: `缺少必需字段 ${field}`, severity: 'error', code: 'workflow.required' });
    }
  }
  if (!Array.isArray(wf.steps)) {
    if (wf.steps !== undefined) {
      issues.push({ path: ['steps'], message: 'steps 必须是数组', severity: 'error', code: 'workflow.steps' });
    }
    return issues;
  }

  const stepIds: string[] = [];
  const idToIndex = new Map<string, number>();
  const byId = new Map<string, Record<string, unknown>>();
  const rawSteps = wf.steps as Record<string, unknown>[];

  // 第一遍：收集全部步骤 ID（校验跳转/引用需要完整集合）
  rawSteps.forEach((step, index) => {
    if (step === null || typeof step !== 'object' || Array.isArray(step)) {
      issues.push({ path: ['steps', index], message: '步骤必须是对象', severity: 'error', code: 'step.shape' });
      return;
    }
    const id = typeof step.id === 'string' ? step.id : '';
    if (!id) {
      issues.push({ path: ['steps', index, 'id'], message: '步骤缺少 id', severity: 'error', code: 'step.required' });
    } else if (idToIndex.has(id)) {
      issues.push({
        path: ['steps', index, 'id'],
        message: `重复的步骤 ID: ${id}（第一次出现在第 ${idToIndex.get(id)! + 1} 步）`,
        severity: 'error',
        code: 'step.dup',
      });
    } else {
      idToIndex.set(id, index);
      stepIds.push(id);
      byId.set(id, step);
    }
  });
  const allStepIds = new Set(stepIds);

  // 第二遍：校验 action / 参数 / 跳转 / 条件 / 重试
  rawSteps.forEach((step, index) => {
    if (step === null || typeof step !== 'object' || Array.isArray(step)) return;
    const action = typeof step.action === 'string' ? step.action : '';
    const spec = action ? catalog.byName(action) : undefined;
    if (!action) {
      issues.push({ path: ['steps', index, 'action'], message: '步骤缺少 action', severity: 'error', code: 'step.required' });
    } else if (!spec) {
      issues.push({ path: ['steps', index, 'action'], message: `未知 Action: ${action}`, severity: 'error', code: 'action.unknown' });
    } else {
      const withVal = step['with'];
      if (withVal !== undefined) {
        if (withVal === null || typeof withVal !== 'object' || Array.isArray(withVal)) {
          issues.push({ path: ['steps', index, 'with'], message: 'with 必须是对象', severity: 'error', code: 'with.shape' });
        } else {
          const withObj = withVal as Record<string, unknown>;
          const inputSchema = spec.inputSchema as Record<string, unknown>;
          const props = inputSchema.properties as Record<string, unknown> | undefined;
          // 引擎对 additionalProperties:false 的 Action 拒绝任何未声明参数（如 core.capture 空 schema 也拒绝所有参数）
          if (inputSchema.additionalProperties === false) {
            for (const key of Object.keys(withObj)) {
              if (!props || !(key in props)) {
                issues.push({
                  path: ['steps', index, 'with', key],
                  // 引擎静态校验（cli validate）不检查 with 参数，但运行时会按 additionalProperties:false 拒绝
                  message: `Action ${action} 不接受参数 ${key}（引擎运行时会拒绝；静态 validate 不检查这一层）`,
                  severity: 'error',
                  code: 'with.unknown',
                });
              }
            }
          }
          validateRefsInTree(withVal, ['steps', index, 'with'], issues, allStepIds);
        }
      }
    }

    for (const field of ['on_success', 'on_failure', 'on_skip'] as const) {
      const target = step[field];
      if (target === undefined) continue;
      if (typeof target !== 'string' || target.length === 0) {
        issues.push({ path: ['steps', index, field], message: `${field} 必须是字符串`, severity: 'error', code: 'target.type' });
      } else if (!(allStepIds.has(target) || TERMINALS.includes(target as (typeof TERMINALS)[number]))) {
        issues.push({
          path: ['steps', index, field],
          message: `${field} 指向未知目标: ${target}`,
          severity: 'error',
          code: 'target.unknown',
        });
      }
    }

    if (step['when'] !== undefined) {
      validateCondition(step['when'], ['steps', index, 'when'], issues, allStepIds);
    }

    if (spec && step['retry'] !== undefined) {
      let attempts = 0;
      const retry = step['retry'];
      if (typeof retry === 'number') {
        attempts = retry;
      } else if (retry && typeof retry === 'object' && !Array.isArray(retry)) {
        attempts = Number((retry as Record<string, unknown>).attempts ?? 1);
      }
      if (attempts > 1 && (!spec.retrySafe || spec.sideEffect)) {
        issues.push({
          path: ['steps', index, 'retry'],
          message: `Action ${action} 不允许重试（非 retry-safe 或有副作用）`,
          severity: 'error',
          code: 'retry.unsafe',
        });
      }
    }
  });

  const entry = typeof wf.entry === 'string' ? wf.entry : '';
  if (entry && stepIds.length > 0 && !stepIds.includes(entry)) {
    issues.push({ path: ['entry'], message: `entry 不是有效步骤: ${entry}`, severity: 'error', code: 'entry.unknown' });
  }

  if (stepIds.length > 0 && entry && byId.has(entry)) {
    const stepInfoList = (wf.steps as Record<string, unknown>[]).map((s, i) => ({
      id: typeof s.id === 'string' ? s.id : '',
      action: typeof s.action === 'string' ? s.action : '',
      index: i,
      hasWhen: false,
      onSuccess: typeof s.on_success === 'string' ? s.on_success : undefined,
      onFailure: typeof s.on_failure === 'string' ? s.on_failure : undefined,
      onSkip: typeof s.on_skip === 'string' ? s.on_skip : undefined,
    }));
    // 可达性（警告级别，编辑过程中噪声更小）
    const reachable = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (reachable.has(current) || TERMINALS.includes(current as (typeof TERMINALS)[number])) continue;
      reachable.add(current);
      const index = stepInfoList.findIndex((s) => s.id === current);
      if (index < 0) continue;
      for (const target of outgoingTargets(stepInfoList, index)) {
        if (!reachable.has(target)) pending.push(target);
      }
    }
    const unreachable = stepIds.filter((id) => !reachable.has(id));
    for (const id of unreachable) {
      issues.push({
        path: ['steps', idToIndex.get(id)!],
        // 引擎（validator.py）把不可达步骤当作硬错误（ConfigError），故此处也用错误级别
        message: `步骤不可达（从 entry 无法到达）: ${id}`,
        severity: 'error',
        code: 'graph.unreachable',
      });
    }
    // 每个步骤能否到达终点
    const canFinish = new Set<string>(TERMINALS as unknown as string[]);
    let changed = true;
    while (changed) {
      changed = false;
      stepInfoList.forEach((step, index) => {
        if (!canFinish.has(step.id) && outgoingTargets(stepInfoList, index).some((t) => canFinish.has(t))) {
          canFinish.add(step.id);
          changed = true;
        }
      });
    }
    const noTerminal = stepIds.filter((id) => !canFinish.has(id));
    for (const id of noTerminal) {
      issues.push({
        path: ['steps', idToIndex.get(id)!],
        message: `步骤无法到达任何终点（$success/$failure/$cancelled）: ${id}`,
        severity: 'warning',
        code: 'graph.no-terminal',
      });
    }
  }

  return issues;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface RefSuggestions {
  inputs: string[];
  steps: string[];
}

export function collectRefSuggestions(info: WorkflowInfo, catalog: ActionCatalog): RefSuggestions {
  const inputs = info.inputsProps.map((p) => `inputs.${p}`);
  const steps: string[] = [];
  for (const step of info.steps) {
    const spec = step.action ? catalog.byName(step.action) : undefined;
    const fields = spec?.outputFields ?? [];
    if (fields.length > 0) {
      for (const field of fields) {
        steps.push(`steps.${step.id}.output.${field}`);
      }
    } else {
      steps.push(`steps.${step.id}.output.0`);
    }
  }
  return { inputs, steps };
}

/** 依据当前工作流内容 + Action 目录，构建可用于补全/校验/悬停的动态 JSON Schema。 */
export function buildWorkflowSchema(info: WorkflowInfo, catalog: ActionCatalog): Record<string, unknown> {
  const targets = [...info.stepIds, ...TERMINALS];
  const withProperties: Record<string, unknown> = {};
  for (const spec of catalog.all()) {
    const props = (spec.inputSchema as Record<string, unknown>).properties as Record<string, unknown> | undefined;
    if (!props) continue;
    for (const [key, value] of Object.entries(props)) {
      const clone = deepClone(value) as Record<string, unknown>;
      const existing = typeof clone.description === 'string' ? String(clone.description) : '';
      clone.description = existing ? `${existing}（${spec.name} 参数）` : `${spec.name} 参数`;
      // 允许 $ref 引用代替字面量，避免把 {"$ref": ...} 误报为类型错误
      withProperties[key] = {
        anyOf: [clone, { $ref: '#/definitions/refObject' }],
        description: `${existing ? existing + '；' : ''}${spec.name} 参数（可为字面量或 $ref 引用）`,
      };
    }
  }

  const targetDescriptions = targets.map((id) => (TERMINALS.includes(id as (typeof TERMINALS)[number]) ? `${id}（终点）` : `步骤：${id}`));
  const actionEnumDescriptions = catalog.all().map((s) => `${s.name} — ${s.description}`);

  const stepSchema: Record<string, unknown> = {
    type: 'object',
    required: ['id', 'action'],
    properties: {
      id: { type: 'string', minLength: 1, description: '步骤 ID，全局唯一，供跳转与引用' },
      action: {
        type: 'string',
        minLength: 1,
        enum: catalog.names(),
        enumDescriptions: actionEnumDescriptions,
        description: '要执行的 Action（内置 + 自定义）',
      },
      with: {
        type: 'object',
        properties: withProperties,
        additionalProperties: false,
        description: 'Action 参数。参数随 action 变化，此处为所有 Action 支持参数的并集。',
      },
      when: { $ref: '#/definitions/condition', description: '执行条件（可选）。支持 exists/eq/ne/gt/gte/lt/lte/contains/and/or/not' },
      on_success: {
        type: 'string',
        enum: targets,
        enumDescriptions: targetDescriptions,
        description: '成功后的跳转目标；缺省跳到下一步',
      },
      on_failure: {
        type: 'string',
        enum: targets,
        enumDescriptions: targetDescriptions,
        description: '失败后的跳转目标；缺省 $failure',
      },
      on_skip: {
        type: 'string',
        enum: targets,
        enumDescriptions: targetDescriptions,
        description: '条件不满足被跳过后的跳转目标；缺省跳到下一步',
      },
      retry: {
        oneOf: [
          { type: 'integer', minimum: 1, description: '重试次数' },
          {
            type: 'object',
            properties: {
              attempts: { type: 'integer', minimum: 1, description: '重试次数' },
              delay_seconds: { type: 'number', minimum: 0, description: '重试间隔（秒）' },
            },
            additionalProperties: false,
            description: '重试配置',
          },
        ],
        description: '重试配置（默认 1；有副作用或非 retry-safe 的 Action 不允许 >1）',
      },
      timeout_seconds: { type: 'number', exclusiveMinimum: 0, description: '本步骤超时秒数（可选）' },
    },
    additionalProperties: false,
  };

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['schema_version', 'id', 'version', 'reference_resolution', 'entry', 'steps'],
    properties: {
      schema_version: { const: 1, description: '工作流 schema 版本，固定为 1' },
      id: { type: 'string', minLength: 1, description: '工作流 ID（供 config 中 task.workflow 引用）' },
      version: { type: 'string', minLength: 1, description: '版本号，如 1.0.0' },
      reference_resolution: {
        type: 'array',
        items: [{ type: 'integer', minimum: 1 }, { type: 'integer', minimum: 1 }],
        additionalItems: false,
        minItems: 2,
        maxItems: 2,
        description: '参考分辨率 [宽, 高]，所有坐标按此换算，通常 [1920, 1080]',
      },
      entry: {
        type: 'string',
        minLength: 1,
        enum: info.stepIds,
        enumDescriptions: info.stepIds.map((id) => `入口步骤：${id}`),
        description: '入口步骤 ID，必须命名一个步骤',
      },
      limits: {
        type: 'object',
        properties: {
          timeout_seconds: { type: 'number', exclusiveMinimum: 0, description: '整个工作流超时（秒）' },
          max_steps: { type: 'integer', minimum: 1, description: '最大执行步数' },
        },
        additionalProperties: false,
        description: '工作流整体限制（可选）',
      },
      inputs_schema: { type: 'object', description: '任务输入参数 JSON Schema（可选）；其 properties 用于 inputs.<字段> 引用补全' },
      steps: { type: 'array', minItems: 1, items: stepSchema, description: '步骤列表' },
    },
    // 允许下划线前缀的元数据字段（如 _layout 卡片位置布局），与引擎 validator 一致
    patternProperties: { '^_': { description: '编辑器/工具私有元数据（引擎忽略）' } },
    additionalProperties: false,
    definitions: {
      refObject: {
        type: 'object',
        required: ['$ref'],
        properties: { $ref: { type: 'string', description: '结构化引用：inputs.<字段> 或 steps.<步骤id>.output.<字段>' } },
        additionalProperties: false,
      },
      operand: {
        anyOf: [
          { type: ['string', 'number', 'boolean', 'null'] },
          { $ref: '#/definitions/refObject' },
          { type: 'object' },
          { type: 'array' },
        ],
        description: '操作数：标量或 $ref 引用（引擎也允许嵌套结构，运行时递归解析其中的 $ref）',
      },
      pair: {
        type: 'array',
        items: [{ $ref: '#/definitions/operand' }, { $ref: '#/definitions/operand' }],
        additionalItems: false,
        minItems: 2,
        maxItems: 2,
      },
      conditionObject: {
        type: 'object',
        properties: {
          exists: { $ref: '#/definitions/refObject', description: '引用是否存在/有值' },
          eq: { $ref: '#/definitions/pair', description: '两操作数相等' },
          ne: { $ref: '#/definitions/pair', description: '两操作数不相等' },
          gt: { $ref: '#/definitions/pair', description: '前操作数 > 后操作数' },
          gte: { $ref: '#/definitions/pair', description: '前操作数 >= 后操作数' },
          lt: { $ref: '#/definitions/pair', description: '前操作数 < 后操作数' },
          lte: { $ref: '#/definitions/pair', description: '前操作数 <= 后操作数' },
          contains: { $ref: '#/definitions/pair', description: '前操作数包含后操作数' },
          and: { type: 'array', items: { $ref: '#/definitions/condition' }, description: '全部成立' },
          or: { type: 'array', items: { $ref: '#/definitions/condition' }, description: '任一成立' },
          not: { $ref: '#/definitions/condition', description: '取反' },
        },
        additionalProperties: false,
      },
      condition: {
        oneOf: [{ type: 'boolean' }, { $ref: '#/definitions/conditionObject' }],
      },
    },
  };
}
