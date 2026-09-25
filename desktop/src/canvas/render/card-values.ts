/**
 * 节点卡片的值格式化与摘要：纯计算，供画布节点卡与详情面板共用。
 * 原 `workflow-editor.js` 的 nodeCardSummary/compactValue/workflowInputVariableValue/
 * variableValueSummary/runtimeInstanceLabel。
 */

import { paramAssetName, paramDurationText, paramPointParts } from './param-rows';

export interface CardValueNode {
  type?: string;
  params?: Record<string, any>;
  [key: string]: any;
}

export interface CardValueVariable {
  name: string;
  definition: Record<string, any>;
}

export interface CardValueInstance {
  id: string;
  displayName?: string;
  backend?: string;
  mumuIndex?: number;
}

export function nodeCardSummary(node: CardValueNode): string {
  const params = node.params || {};
  const parts: string[] = [];
  if (typeof params.present === 'boolean') parts.push(params.present ? '等待出现' : '等待消失');
  if (typeof params.timeout_seconds === 'number') parts.push(`超时 ${params.timeout_seconds}s`);
  if (typeof params.threshold === 'number') parts.push(`阈值 ${Math.round(params.threshold * 100)}%`);
  if (parts.length) return parts.join(' · ');
  if (node.type === 'task') return Object.keys(params).length ? `${Object.keys(params).length} 项参数 · 详情栏编辑` : '详情栏编辑参数';
  if (node.type === 'root') return '工作流入口';
  const labels: Record<string, string> = { instance_parallel: '各实例独立执行', parallel: '并行执行分支', simple_parallel: '主任务与后台并行', selector: '按顺序尝试可用分支', branch: '按条件选择分支', switch: '按条件选择分支', repeat_until: '重复执行直到满足条件', sequence: '按顺序执行子节点', condition: '成立走真口，否则走假口', bool_judge: 'bool 输出 · 可被多处引用', break: '拆分来源输出 · 字段可引用' };
  return labels[node.type ?? ''] || '详情栏查看配置';
}

export function compactValue(value: unknown, max = 24): string {
  let text: string;
  if (value === undefined) text = '未传值';
  else if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { ref?: unknown }).ref === 'string') text = `← ${(value as { ref: string }).ref.replace(/^inputs\./, '')}`;
  else if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function workflowInputVariableValue(holder: unknown, variable: CardValueVariable): string {
  const record = holder && typeof holder === 'object' && !Array.isArray(holder) ? holder as { inputs?: unknown } : {};
  const inputs = record.inputs && typeof record.inputs === 'object' && !Array.isArray(record.inputs) ? record.inputs as Record<string, unknown> : {};
  if (Object.prototype.hasOwnProperty.call(inputs, variable.name)) return compactValue(inputs[variable.name], Infinity);
  if (Object.prototype.hasOwnProperty.call(variable.definition, 'default')) return `默认 ${compactValue(variable.definition.default, Infinity)}`;
  return variable.definition.required ? '需要传值' : '未传值';
}

export function variableValueSummary(definition: unknown): string {
  const record = definition && typeof definition === 'object' && !Array.isArray(definition) ? definition as Record<string, any> : undefined;
  if (record && Object.prototype.hasOwnProperty.call(record, 'default')) {
    const type = String(record.type || '');
    // 坐标点与时长用可读写法，避免卡片里塞进被截断的 JSON；坐标点省略括号以适配窄值区。
    if (type === 'point') {
      const parts = paramPointParts(record.default);
      return `${parts.x},${parts.y}`;
    }
    if (type === 'duration') return paramDurationText(record.default);
    if (type === 'workflow') return paramAssetName(record.default);
    return compactValue(record.default, Infinity);
  }
  if (record && record.required === true) return '必填';
  return '未设默认';
}

export function instanceLabel(instanceId: unknown, instances: CardValueInstance[] | undefined, fallback = '未选择实例'): string {
  const id = String(instanceId || '');
  const instance = (instances || []).find((item) => item && item.id === id);
  if (!instance) return id || fallback;
  return instance.displayName
    || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
}
