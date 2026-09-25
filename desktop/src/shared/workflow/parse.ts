/** 工作流 JSON 解析：把 unknown 收窄为 WorkflowInfo。 */
import { isObject } from './guards';
import { isGraphDocument, toCanvasDocument } from './graph-document';
import { parseParameterDefinition } from './parameters';
import { NODE_TYPES, type DecoratorInfo, type InstanceParallelRunInfo, type NodeInfo, type NodeType, type WorkflowInfo } from './types';

function parsedDecorator(raw: unknown): DecoratorInfo | undefined {
  if (!isObject(raw)) return undefined;
  const out: DecoratorInfo = { type: typeof raw.type === 'string' ? raw.type : '', raw };
  if (raw.expression !== undefined) out.expression = raw.expression;
  if (typeof raw.seconds === 'number') out.seconds = raw.seconds;
  if (typeof raw.attempts === 'number') out.attempts = raw.attempts;
  if (typeof raw.delay_seconds === 'number') out.delaySeconds = raw.delay_seconds;
  if (typeof raw.count === 'number') out.count = raw.count;
  if (typeof raw.reset_on_failure === 'boolean') out.resetOnFailure = raw.reset_on_failure;
  return out;
}

export function parseWorkflow(input: unknown): WorkflowInfo {
  const info: WorkflowInfo = {
    raw: null,
    inputs: {},
    inputProps: [],
    variables: {},
    variableProps: [],
    nodes: [],
    nodeIds: [],
    rawNodes: [],
  };
  if (!isObject(input)) return info;
  // 节点图 v5：先转成编辑形态，`children` / `ports` / `cases[].child` 才存在。
  // 主进程的引用建议与引用图都基于这份解析结果，转换必须发生在这里，否则
  // 「哪些节点排在我前面」会全部算空（见 core/references.ts、suggestions.ts）。
  const raw: Record<string, any> = isGraphDocument(input) ? toCanvasDocument(input) : input;
  info.raw = raw;
  if (typeof raw.id === 'string') info.id = raw.id;
  if (typeof raw.version === 'string') info.version = raw.version;
  if (typeof raw.description === 'string') info.description = raw.description;
  if (typeof raw.root === 'string') info.root = raw.root;
  if (Array.isArray(raw.resolution)) info.resolution = raw.resolution as number[];
  if (isObject(raw.limits)) info.limits = raw.limits;
  if (isObject(raw.inputs)) {
    for (const [key, value] of Object.entries(raw.inputs)) {
      try {
        info.inputs[key] = parseParameterDefinition(value, `inputs.${key}`);
      } catch {
        info.inputs[key] = { type: isObject(value) ? String(value.type ?? '') : '' };
      }
    }
    info.inputProps = Object.keys(info.inputs);
  }
  if (isObject(raw.variables)) {
    for (const [key, value] of Object.entries(raw.variables)) {
      try {
        info.variables[key] = parseParameterDefinition(value, `variables.${key}`);
      } catch {
        info.variables[key] = { type: isObject(value) ? String(value.type ?? '') : '' };
      }
    }
    info.variableProps = Object.keys(info.variables);
  }
  if (Array.isArray(raw.nodes)) {
    info.rawNodes = raw.nodes;
    info.nodes = raw.nodes.map((item, index): NodeInfo => {
      const object = isObject(item) ? item : {};
      const type = (NODE_TYPES as readonly string[]).includes(String(object.type)) ? object.type as NodeType : 'task';
      return {
        id: typeof object.id === 'string' ? object.id : '',
        type,
        index,
        name: typeof object.name === 'string' ? object.name : undefined,
        action: typeof object.action === 'string' ? object.action : undefined,
        params: isObject(object.params) ? object.params : {},
        children: Array.isArray(object.children) ? object.children.filter((child): child is string => typeof child === 'string') : [],
        decorators: Array.isArray(object.decorators) ? object.decorators.flatMap((decorator) => parsedDecorator(decorator) ?? []) : [],
        finishMode: object.finish_mode === 'wait_for_background' ? 'wait_for_background' : 'abort_background',
        runs: Array.isArray(object.runs) ? object.runs.flatMap((run): InstanceParallelRunInfo[] => {
          if (!isObject(run)) return [];
          return [{
            instance: typeof run.instance === 'string' ? run.instance : '',
            workflow: typeof run.workflow === 'string' ? run.workflow : '',
            inputs: isObject(run.inputs) ? run.inputs : {},
          }];
        }) : [],
        waitFor: object.wait_for === 'any' ? 'any' : 'all',
        cancelOnFailure: object.cancel_on_failure !== false,
        ref: isObject(object.ref) ? object.ref : undefined,
        fields: isObject(object.fields) ? object.fields : undefined,
      };
    });
  }
  info.nodeIds = info.nodes.filter((node) => node.id).map((node) => node.id);
  return info;
}

/**
 * 顶层的 `instance_parallel` 运行项：`root` 的唯一直接子节点是 `instance_parallel` 时返回它的 `runs`。
 *
 * 运行宿主靠它决定「这次要投递到哪些实例」并给运行记录写标签；图文档（v5）里没有
 * `children`，所以必须走 `parseWorkflow`（它会先把图转成编辑形态），不能自己解析 JSON。
 */
export function instanceParallelRuns(raw: unknown): InstanceParallelRunInfo[] {
  const info = parseWorkflow(raw);
  if (!info.root) return [];
  const root = info.nodes.find((node) => node.id === info.root && node.type === 'root');
  const childId = root?.children?.[0];
  if (!childId) return [];
  const child = info.nodes.find((node) => node.id === childId);
  if (!child || child.type !== 'instance_parallel') return [];
  return child.runs;
}
