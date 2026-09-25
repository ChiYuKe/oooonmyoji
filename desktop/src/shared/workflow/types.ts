/**
 * 工作流领域公共类型与常量：不依赖 Electron / Node 文件系统。
 * Python 端 `src/oooonmyoji/workflows/model.py` 是执行时的权威定义，
 * 这里保持同名常量与节点结构，供主进程和画布做编辑时诊断。
 */
import type { ParameterInfo } from './parameters';

export const NODE_TYPES = ['root', 'selector', 'sequence', 'simple_parallel', 'parallel', 'repeat_until', 'branch', 'switch', 'instance_parallel', 'condition', 'bool_judge', 'break', 'task'] as const;
export const DECORATOR_TYPES = ['cooldown', 'timeout', 'retry', 'repeat', 'do_once'] as const;
export const PARALLEL_FINISH_MODES = ['abort_background', 'wait_for_background'] as const;
export const CONDITION_OPERATORS = ['exists', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'and', 'or', 'not'] as const;
export const INSTANCE_PARALLEL_WAIT_MODES = ['all', 'any'] as const;

/**
 * 布尔判断卡片（`bool_judge`）的输出形状：引用写作 `nodes.<id>.output.value`。
 * 与 Python `src/oooonmyoji/workflows/model.py` 的 `BOOL_JUDGE_OUTPUT_SCHEMA` 一致。
 */
export const BOOL_JUDGE_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { value: { type: 'boolean' } },
  required: ['value'],
  additionalProperties: false,
};

export type NodeType = typeof NODE_TYPES[number];
export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  severity: Severity;
  code?: string;
}

export interface DecoratorInfo {
  type: string;
  expression?: unknown;
  seconds?: number;
  attempts?: number;
  delaySeconds?: number;
  count?: number;
  resetOnFailure?: boolean;
  raw: Record<string, unknown>;
}

export interface NodeInfo {
  id: string;
  type: NodeType;
  index: number;
  name?: string;
  action?: string;
  params: Record<string, unknown>;
  children: string[];
  decorators: DecoratorInfo[];
  finishMode: 'abort_background' | 'wait_for_background';
  runs: InstanceParallelRunInfo[];
  waitFor: 'all' | 'any';
  cancelOnFailure: boolean;
  /** 拆分卡片（`break`）的来源绑定：`{ ref: 'nodes.<id>.output...' }`。 */
  ref?: unknown;
  /** 拆分卡片的字段映射：输出名 → 源值内的路径（如 `0.score`）。 */
  fields?: Record<string, unknown>;
}

export interface InstanceParallelRunInfo {
  instance: string;
  workflow: string;
  inputs: Record<string, unknown>;
}

export interface WorkflowInfo {
  raw: Record<string, unknown> | null;
  id?: string;
  version?: string;
  description?: string;
  root?: string;
  resolution?: number[];
  limits?: Record<string, unknown>;
  inputs: Record<string, ParameterInfo>;
  inputProps: string[];
  variables: Record<string, ParameterInfo>;
  variableProps: string[];
  nodes: NodeInfo[];
  nodeIds: string[];
  rawNodes: unknown[];
}

/** 校验与引用建议所需的最小 Action 契约（catalog 与测试替身都满足它）。 */
export interface ActionSpecLike {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  parameters: Record<string, ParameterInfo>;
  retrySafe?: boolean;
}

export interface ActionCatalogLike {
  byName(name: string): ActionSpecLike | undefined;
  names(): string[];
}

export interface WorkflowFileDescriptor {
  uri: string;
  name: string;
  rel: string;
  id?: string;
  description?: string;
  inputs?: Array<{
    name: string;
    definition: ParameterInfo;
  }>;
}

/** 结构树节点（按 children 嵌套，前端逐层渲染）。 */
export interface TreeNodePayload {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: TreeNodePayload[];
}

/** 一个 workflow.run 节点对子工作流的一次引用（引用原文 `params.workflow`）。 */
export interface WorkflowRunReference {
  /** 引用节点 id。 */
  nodeId: string;
  /** 引用节点 name（未命名时缺省）。 */
  nodeName?: string;
  /** `params.workflow` 的原始引用值（工作流 ID、JSON 文件名或 workflows/ 下路径）。 */
  reference: string;
}
