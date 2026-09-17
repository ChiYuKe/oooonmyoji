/**
 * 工作流语义校验与生成 schema：编辑时诊断。
 * 权威判断在 Python `src/oooonmyoji/workflows/validator.py`；这里保持同样的规则代码与文案。
 */
import Ajv2020 from 'ajv/dist/2020';
import {
  allowBinding,
  bindingAwareParameterSchema,
  bindingTypesCompatible,
  validateBindings,
  type RefContext,
} from './bindings';
import { availableOutputNodeIds, possiblyAvailableOutputNodeIds } from './graph';
import { isObject } from './guards';
import { applyParameterDefaults, parseParameterDefinition, parameterToSchema } from './parameters';
import { parseWorkflow } from './parse';
import {
  DECORATOR_TYPES,
  INSTANCE_PARALLEL_WAIT_MODES,
  NODE_TYPES,
  PARALLEL_FINISH_MODES,
  type ActionCatalogLike,
  type ValidationIssue,
  type WorkflowInfo,
} from './types';

const workflowAjv = new Ajv2020({ allErrors: true, strict: false });

function issue(path: (string | number)[], message: string, code: string): ValidationIssue {
  return { path, message, severity: 'error', code };
}

function validateDecorator(
  item: Record<string, unknown>,
  path: (string | number)[],
  context: RefContext,
  issues: ValidationIssue[],
  availableNodeIds: Set<string>,
  possiblyAvailableNodeIds: Set<string>,
): void {
  const type = item.type;
  if (typeof type !== 'string' || !(DECORATOR_TYPES as readonly string[]).includes(type)) {
    issues.push(issue([...path, 'type'], `未知装饰器类型：${String(type)}`, 'invalid-decorator'));
    return;
  }
  const allowed: Record<string, string[]> = {
    condition: ['type', 'expression'], cooldown: ['type', 'seconds'], timeout: ['type', 'seconds'],
    retry: ['type', 'attempts', 'delay_seconds'], repeat: ['type', 'count'], do_once: ['type', 'reset_on_failure'],
  };
  const required: Record<string, string[]> = {
    condition: ['expression'], cooldown: ['seconds'], timeout: ['seconds'], retry: ['attempts'], repeat: ['count'], do_once: [],
  };
  const extras = Object.keys(item).filter((key) => !allowed[type].includes(key));
  if (extras.length) issues.push(issue(path, `装饰器包含未知字段：${extras.join(', ')}`, 'invalid-decorator'));
  for (const key of required[type]) if (!(key in item)) issues.push(issue(path, `装饰器缺少 ${key}`, 'invalid-decorator'));
  if (type === 'condition') validateBindings(item.expression, context, [...path, 'expression'], issues, true, undefined, availableNodeIds, possiblyAvailableNodeIds);
  const schemas: Record<string, Record<string, unknown>> = {seconds:{type:'number',exclusiveMinimum:0},attempts:{type:'integer',minimum:1},delay_seconds:{type:'number',minimum:0},reset_on_failure:{type:'boolean'}};
  for (const [key,schema] of Object.entries(schemas)) {
    if (!(key in item)) continue;
    validateBindings(item[key],context,[...path,key],issues,false,schema,availableNodeIds);
    if (!workflowAjv.compile(allowBinding(schema))(item[key])) issues.push(issue([...path,key],`${key} 的值或引用无效`,'invalid-decorator'));
  }
  if (type === 'repeat') {
    if (isObject(item.count) && typeof item.count.ref === 'string') {
      validateBindings(item.count, context, [...path, 'count'], issues, false, { type: 'integer' }, availableNodeIds);
    } else if (!Number.isInteger(item.count) || Number(item.count) < 1) {
      issues.push(issue([...path, 'count'], 'count 必须是正整数或整数引用', 'invalid-decorator'));
    }
  }
}

function validateInstanceParallelInputs(value: unknown, path: (string | number)[], issues: ValidationIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateInstanceParallelInputs(child, [...path, index], issues));
    return;
  }
  if (!isObject(value)) return;
  if ('ref' in value) {
    if (Object.keys(value).length !== 1 || typeof value.ref !== 'string' || !value.ref.startsWith('inputs.')) {
      issues.push(issue(path, '实例并行 inputs 只能绑定父工作流 inputs', 'invalid-instance-binding'));
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) validateInstanceParallelInputs(child, [...path, key], issues);
}

export function validateWorkflow(raw: unknown, catalog: ActionCatalogLike): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const info = parseWorkflow(raw);
  if (!info.raw) return [issue([], '工作流必须是一个 JSON 对象', 'not-object')];
  const root = info.raw;
  if (root.schema_version !== 4) issues.push(issue(['schema_version'], '仅支持 schema_version 4', 'schema-version'));
  if (typeof root.id !== 'string' || !root.id) issues.push(issue(['id'], '缺少 id', 'missing-id'));
  if (typeof root.version !== 'string' || !root.version) issues.push(issue(['version'], '缺少 version', 'missing-version'));
  if (root.description !== undefined && typeof root.description !== 'string') issues.push(issue(['description'], 'description 必须是字符串', 'invalid-description'));
  if (typeof root.root !== 'string' || !root.root) issues.push(issue(['root'], '缺少 root', 'missing-root'));
  if (!Array.isArray(root.resolution) || root.resolution.length !== 2 || !root.resolution.every((value) => Number.isInteger(value) && Number(value) > 0)) issues.push(issue(['resolution'], 'resolution 必须包含两个正整数', 'invalid-resolution'));
  if (!Array.isArray(root.nodes) || root.nodes.length < 2) issues.push(issue(['nodes'], 'Behavior Tree 至少需要 Root 和一个子节点', 'invalid-nodes'));
  if (!isObject(root.inputs)) {
    issues.push(issue(['inputs'], '工作流 inputs 必须是定义对象', 'invalid-inputs'));
  } else {
    for (const [name, definition] of Object.entries(root.inputs)) {
      if (isObject(definition) && 'public' in definition) issues.push(issue(['inputs', name, 'public'], 'schema v4 已移除 public', 'removed-public-field'));
      try { parseParameterDefinition(definition, `inputs.${name}`); }
      catch (error) { issues.push(issue(['inputs', name], (error as Error).message, 'invalid-inputs-definition')); }
    }
  }
  if (!isObject(root.variables)) {
    issues.push(issue(['variables'], '工作流 variables 必须是定义对象', 'invalid-variables'));
  } else {
    for (const [name, definition] of Object.entries(root.variables)) {
      try {
        if (isObject(definition) && 'public' in definition) issues.push(issue(['variables', name, 'public'], 'schema v4 已移除 public', 'removed-public-field'));
        const parsed = parseParameterDefinition(definition, `variables.${name}`);
        if (parsed.default === undefined) issues.push(issue(['variables', name], '运行变量必须声明 default', 'missing-variable-default'));
      } catch (error) {
        issues.push(issue(['variables', name], (error as Error).message, 'invalid-variable-definition'));
      }
    }
  }
  for (const name of info.inputProps) {
    if (info.variableProps.includes(name)) issues.push(issue(['variables', name], 'inputs 与 variables 不能重名', 'duplicate-binding-name'));
  }

  const ids = new Set(info.nodeIds);
  if (ids.size !== info.nodeIds.length) issues.push(issue(['nodes'], '存在重复的节点 ID', 'duplicate-node'));
  const context: RefContext = { info, catalog, nodeIds: ids };
  const parents = new Map<string, number>(info.nodeIds.map((id) => [id, 0]));
  const nodeMap = new Map(info.nodes.map((node) => [node.id, node]));
  const descendants = (owner:string):Set<string> => {
    const found=new Set<string>(),pending=[owner];
    while(pending.length){const id=pending.pop()!;if(found.has(id))continue;found.add(id);pending.push(...(nodeMap.get(id)?.children||[]));}return found;
  };
  const references = (value:unknown,prefix:string):boolean => {
    if(!value||typeof value!=='object')return false;
    if(isObject(value)&&typeof value.ref==='string'&&(value.ref===prefix||value.ref.startsWith(prefix+'.')))return true;
    return Object.values(value).some(child=>references(child,prefix));
  };
  for(const [name,definition] of Object.entries(isObject(root.variables)?root.variables:{})) {
    if(!isObject(definition))continue;
    if(definition.initial_from!==undefined) {
      const input=typeof definition.initial_from==='string'?info.inputs[definition.initial_from]:undefined;
      if(!input||!info.variables[name]||!bindingTypesCompatible(parameterToSchema(info.variables[name]),parameterToSchema(input)))issues.push(issue(['variables',name,'initial_from'],'初始化来源必须是兼容的工作流输入','variable-initializer'));
    }
    if(!definition.owner)continue;
    const owner=typeof definition.owner==='string'?nodeMap.get(definition.owner):undefined;
    if(!owner||['task','instance_parallel'].includes(owner.type)){issues.push(issue(['variables',name,'owner'],'局部作用域必须指向复合节点','variable-scope'));continue;}
    const allowed=descendants(owner.id);
    for(const node of info.nodes)if(!allowed.has(node.id)&&references(info.rawNodes[node.index],`variables.${name}`))issues.push(issue(['nodes',node.index],'节点越界访问局部变量：'+name,'variable-scope'));
  }

  (root.nodes as unknown[] | undefined)?.forEach((rawNode, index) => {
    const path = ['nodes', index];
    if (!isObject(rawNode)) { issues.push(issue(path, '节点必须是对象', 'invalid-node')); return; }
    const node = info.nodes[index];
    const availableNodeIds = availableOutputNodeIds(info, node.id);
    const possiblyAvailableNodeIds = possiblyAvailableOutputNodeIds(info, node.id);
    if (!node.id) issues.push(issue([...path, 'id'], '节点缺少 id', 'missing-node-id'));
    if (!(NODE_TYPES as readonly string[]).includes(String(rawNode.type))) issues.push(issue([...path, 'type'], `未知节点类型：${String(rawNode.type)}`, 'invalid-node-type'));
    const decoratorsRaw = rawNode.decorators;
    const singletons = new Set<string>();
    if (decoratorsRaw !== undefined && !Array.isArray(decoratorsRaw)) issues.push(issue([...path, 'decorators'], 'decorators 必须是数组', 'invalid-decorator'));
    if (Array.isArray(decoratorsRaw)) decoratorsRaw.forEach((decorator, decoratorIndex) => {
      if (!isObject(decorator)) { issues.push(issue([...path, 'decorators', decoratorIndex], '装饰器必须是对象', 'invalid-decorator')); return; }
      validateDecorator(decorator, [...path, 'decorators', decoratorIndex], context, issues, availableNodeIds, possiblyAvailableNodeIds);
      if (decorator.type !== 'condition' && typeof decorator.type === 'string') {
        if (singletons.has(decorator.type)) issues.push(issue([...path, 'decorators', decoratorIndex], `重复的 ${decorator.type} 装饰器`, 'duplicate-decorator'));
        singletons.add(decorator.type);
      }
    });
    if (node.type === 'task') {
      if ('children' in rawNode || 'finish_mode' in rawNode) issues.push(issue(path, 'Task 不能定义 children 或 finish_mode', 'invalid-task'));
      if (typeof rawNode.action !== 'string' || !rawNode.action) issues.push(issue([...path, 'action'], 'Task 必须定义 Action', 'invalid-action'));
      else {
        const spec = catalog.byName(rawNode.action);
        if (!spec) issues.push(issue([...path, 'action'], `未知 Action：${rawNode.action}`, 'unknown-action'));
        else {
          const params = rawNode.params === undefined ? {} : rawNode.params;
          if (!isObject(params)) issues.push(issue([...path, 'params'], 'params 必须是对象', 'invalid-params'));
          else {
            validateBindings(params, context, [...path, 'params'], issues, false, spec.inputSchema, availableNodeIds);
            const validate = workflowAjv.compile(bindingAwareParameterSchema(spec.inputSchema));
            const normalized = applyParameterDefaults(spec.parameters, params);
            if (!validate(normalized)) {
              const primary = validate.errors?.find((error) => ['required', 'additionalProperties', 'type', 'enum', 'minimum', 'maximum'].includes(error.keyword)) ?? validate.errors?.[0];
              issues.push(issue([...path, 'params'], `Action ${rawNode.action} 参数无效：${primary?.instancePath || '/'} ${primary?.message || 'validation failed'}`, 'invalid-params'));
            }
            const retry = node.decorators.find((decorator) => decorator.type === 'retry' && (isObject(decorator.raw.attempts) || Number(decorator.attempts) > 1));
            if (retry && !spec.retrySafe && root.retry_safe !== true) issues.push(issue([...path, 'decorators'], `Action ${rawNode.action} 不可安全重试`, 'unsafe-retry'));
          }
        }
      }
    } else if (node.type === 'instance_parallel') {
      if (['action', 'params', 'children', 'finish_mode'].some((key) => key in rawNode)) {
        issues.push(issue(path, 'Instance Parallel 不能定义 action、params、children 或 finish_mode', 'invalid-instance-parallel'));
      }
      if (node.decorators.length) issues.push(issue([...path, 'decorators'], 'Instance Parallel 不能挂装饰器', 'invalid-instance-parallel'));
      if (!Array.isArray(rawNode.runs) || rawNode.runs.length === 0) {
        issues.push(issue([...path, 'runs'], 'Instance Parallel 至少需要一个运行项', 'instance-run-count'));
      } else {
        const seen = new Set<string>();
        rawNode.runs.forEach((run, runIndex) => {
          const runPath = [...path, 'runs', runIndex];
          if (!isObject(run)) { issues.push(issue(runPath, '运行项必须是对象', 'invalid-instance-run')); return; }
          if (typeof run.instance !== 'string' || !run.instance.trim()) issues.push(issue([...runPath, 'instance'], 'instance 必须是非空字符串', 'invalid-instance-run'));
          else if (seen.has(run.instance)) issues.push(issue([...runPath, 'instance'], `实例重复：${run.instance}`, 'duplicate-instance-run'));
          else seen.add(run.instance);
          if (typeof run.workflow !== 'string' || !run.workflow.trim()) issues.push(issue([...runPath, 'workflow'], 'workflow 必须是非空字符串', 'invalid-instance-run'));
          if (run.inputs !== undefined && !isObject(run.inputs)) issues.push(issue([...runPath, 'inputs'], 'inputs 必须是对象', 'invalid-instance-inputs'));
          if (run.inputs !== undefined) validateInstanceParallelInputs(run.inputs, [...runPath, 'inputs'], issues);
          const allowed = new Set(['instance', 'workflow', 'inputs']);
          for (const key of Object.keys(run)) if (!allowed.has(key)) issues.push(issue([...runPath, key], `运行项包含未知字段：${key}`, 'invalid-instance-run'));
        });
      }
      if (rawNode.wait_for !== undefined && !INSTANCE_PARALLEL_WAIT_MODES.includes(rawNode.wait_for as typeof INSTANCE_PARALLEL_WAIT_MODES[number])) {
        issues.push(issue([...path, 'wait_for'], 'wait_for 必须是 all 或 any', 'invalid-instance-parallel'));
      }
      if (rawNode.cancel_on_failure !== undefined && typeof rawNode.cancel_on_failure !== 'boolean') {
        issues.push(issue([...path, 'cancel_on_failure'], 'cancel_on_failure 必须是布尔值', 'invalid-instance-parallel'));
      }
    } else {
      if ('action' in rawNode || 'params' in rawNode) issues.push(issue(path, `${node.type} 不能定义 action 或 params`, 'invalid-composite'));
      if (node.type !== 'parallel' && ['runs', 'wait_for', 'cancel_on_failure'].some((key) => key in rawNode)) issues.push(issue(path, '实例并行字段只适用于 Instance Parallel', 'invalid-instance-parallel'));
      if (node.type === 'root' && node.decorators.length) issues.push(issue([...path, 'decorators'], 'Root 不能挂装饰器', 'invalid-root'));
      if (!Array.isArray(rawNode.children)) issues.push(issue([...path, 'children'], `${node.type} 必须定义 children`, 'invalid-children'));
      if (node.type === 'root' && node.children.length !== 1) issues.push(issue([...path, 'children'], 'Root 必须恰好连接一个子节点', 'root-child-count'));
      if ((node.type === 'selector' || node.type === 'sequence') && node.children.length < 1) issues.push(issue([...path, 'children'], `${node.type} 至少需要一个子节点`, 'composite-child-count'));
      if (node.type === 'parallel' && node.children.length < 2) issues.push(issue([...path, 'children'], 'Parallel 至少需要两个子节点', 'parallel-child-count'));
      if (node.type === 'repeat_until' && node.children.length !== 1) issues.push(issue([...path, 'children'], 'Repeat Until 必须恰好有一个子节点', 'repeat-child-count'));
      if (node.type === 'branch' && (!Array.isArray(rawNode.conditions) || rawNode.conditions.length !== node.children.length)) issues.push(issue([...path, 'conditions'], 'Branch 的 conditions 数量必须与 children 一致', 'branch-condition-count'));
      if (node.type === 'switch' && (!Array.isArray(rawNode.cases) || rawNode.cases.length < 1)) issues.push(issue([...path, 'cases'], 'Switch 至少需要一个 case', 'switch-case-count'));
      if (node.type === 'simple_parallel') {
        if (node.children.length !== 2) issues.push(issue([...path, 'children'], 'Simple Parallel 必须恰好有两个子节点', 'parallel-child-count'));
        if (node.children[0] && nodeMap.get(node.children[0])?.type !== 'task') issues.push(issue([...path, 'children', 0], 'Simple Parallel 的第一个子节点必须是主 Task', 'parallel-main-task'));
      } else if ('finish_mode' in rawNode) issues.push(issue([...path, 'finish_mode'], 'finish_mode 只适用于 Simple Parallel', 'invalid-finish-mode'));
    }
    for (const [childIndex, child] of node.children.entries()) {
      if (!ids.has(child)) issues.push(issue([...path, 'children', childIndex], `未知子节点：${child}`, 'unknown-child'));
      else parents.set(child, (parents.get(child) ?? 0) + 1);
    }
  });

  const rootNode = typeof root.root === 'string' ? nodeMap.get(root.root) : undefined;
  if (typeof root.root === 'string' && !rootNode) issues.push(issue(['root'], `root 指向不存在的节点：${root.root}`, 'unknown-root'));
  else if (rootNode?.type !== 'root') issues.push(issue(['root'], 'root 必须指向 Root 类型节点', 'invalid-root'));
  if (rootNode && (parents.get(rootNode.id) ?? 0) !== 0) issues.push(issue(['root'], 'Root 不能有父节点', 'root-parent'));
  for (const node of info.nodes) {
    if (node.type !== 'instance_parallel') continue;
    if (!rootNode || rootNode.children.length !== 1 || rootNode.children[0] !== node.id || (parents.get(node.id) ?? 0) !== 1) {
      issues.push(issue(['nodes', node.index], 'Instance Parallel 必须是 Root 的唯一直接子节点', 'instance-parallel-root-only'));
    }
  }
  for (const node of info.nodes) {
    if (rootNode && node.id !== rootNode.id && (parents.get(node.id) ?? 0) !== 1) issues.push(issue(['nodes', node.index], `节点 ${node.id} 必须恰好有一个父节点`, 'parent-count'));
  }

  if (rootNode && !issues.some((entry) => ['duplicate-node', 'unknown-child'].includes(entry.code ?? ''))) {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) { issues.push(issue(['nodes', nodeMap.get(id)?.index ?? 0], `检测到环：${id}`, 'cycle')); return; }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const child of nodeMap.get(id)?.children ?? []) visit(child);
      visiting.delete(id);
      visited.add(id);
    };
    visit(rootNode.id);
    for (const node of info.nodes) if (!visited.has(node.id)) issues.push(issue(['nodes', node.index], `存在不可达节点：${node.id}`, 'unreachable-node'));
  }
  return issues;
}

export function buildWorkflowSchema(info: WorkflowInfo, catalog: ActionCatalogLike): Record<string, unknown> {
  return {
    type: 'object',
    required: ['schema_version', 'id', 'version', 'resolution', 'root', 'inputs', 'variables', 'nodes'],
    properties: {
      schema_version: { const: 4 },
      id: { type: 'string', minLength: 1 },
      version: { type: 'string', minLength: 1 },
      description: { type: 'string', description: '工作流用途说明，会显示在子工作流选择器中' },
      resolution: { type: 'array', prefixItems: [{ type: 'integer', minimum: 1 }, { type: 'integer', minimum: 1 }], minItems: 2, maxItems: 2 },
      root: { type: 'string', enum: info.nodeIds },
      inputs: { type: 'object' },
      variables: { type: 'object' },
      retry_safe: { type: 'boolean' },
      limits: { type: 'object', properties: { timeout_seconds: { type: 'number', exclusiveMinimum: 0 }, max_steps: { type: 'integer', minimum: 1 } }, additionalProperties: false },
      nodes: {
        type: 'array', minItems: 2,
        items: {
          type: 'object', required: ['id', 'type'],
          properties: {
            id: { type: 'string', minLength: 1 }, type: { enum: [...NODE_TYPES] }, name: { type: 'string', minLength: 1 },
            action: { type: 'string', enum: catalog.names() }, params: { type: 'object' },
            children: { type: 'array', items: { type: 'string', enum: info.nodeIds }, uniqueItems: true },
            decorators: { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { enum: [...DECORATOR_TYPES] }, expression: {}, seconds: allowBinding({ type: 'number', exclusiveMinimum: 0 }), attempts: allowBinding({ type: 'integer', minimum: 1 }), delay_seconds: allowBinding({ type: 'number', minimum: 0 }), count: allowBinding({ type: 'integer', minimum: 1 }), reset_on_failure: allowBinding({ type: 'boolean' }) }, additionalProperties: false } },
            finish_mode: { enum: [...PARALLEL_FINISH_MODES] },
            runs: {
              type: 'array', minItems: 1,
              items: {
                type: 'object', required: ['instance', 'workflow'],
                properties: { instance: { type: 'string', minLength: 1 }, workflow: { type: 'string', minLength: 1 }, inputs: { type: 'object' } },
                additionalProperties: false,
              },
            },
            wait_for: { enum: [...INSTANCE_PARALLEL_WAIT_MODES] },
            cancel_on_failure: { type: 'boolean' },
            condition: {}, conditions: { type: 'array' }, max_iterations: { type: 'integer', minimum: 1 },
            expression: {}, cases: { type: 'array' }, default_child: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    patternProperties: { '^_': {} },
    additionalProperties: false,
  };
}
