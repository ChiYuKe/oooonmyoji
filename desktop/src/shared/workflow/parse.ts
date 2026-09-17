/** 工作流 JSON 解析：把 unknown 收窄为 WorkflowInfo。 */
import { isObject } from './guards';
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

export function parseWorkflow(raw: unknown): WorkflowInfo {
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
  if (!isObject(raw)) return info;
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
      };
    });
  }
  info.nodeIds = info.nodes.filter((node) => node.id).map((node) => node.id);
  return info;
}
