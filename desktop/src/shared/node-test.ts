import type { ActionSpec } from './contracts';
import type { TestNodeDraft } from './workflow-testing';
import { emitRuntimeDocument } from './workflow/graph-dsl';
import { parameterValueAccepted } from '../canvas/model/parameter-edits';
import { fieldLabel } from '../canvas/ui/labels';

export const TEST_NODE_ID = 'test_node';

/** Validate the exact draft sent to testing and to the live canvas. */
export function validateTestNode(value: unknown, catalog: Pick<ActionSpec, 'name' | 'parameters'>[]): TestNodeDraft {
  const draft = value as TestNodeDraft;
  const spec = draft && catalog.find(item => item.name === draft.action);
  if (!spec) throw new Error('请先选择节点动作');
  if (typeof draft.name !== 'string' || !draft.params || typeof draft.params !== 'object' || Array.isArray(draft.params)) throw new Error('节点配置无效');
  for (const [name, definition] of Object.entries(spec.parameters)) {
    if (definition.required && definition.default === undefined && (draft.params[name] === undefined || draft.params[name] === '')) throw new Error(`请填写${definition.display_name || fieldLabel(name)}`);
  }
  for (const [name, value] of Object.entries(draft.params)) {
    if (!spec.parameters[name] || !parameterValueAccepted(spec.parameters[name], value)) throw new Error(`${spec.parameters[name]?.display_name || fieldLabel(name)}不符合动作要求；请使用具体参数值`);
  }
  return structuredClone({ action: draft.action, name: draft.name.trim(), params: draft.params });
}

export function nodeTestText(draft: TestNodeDraft, resolution: number[]): string {
  return emitRuntimeDocument({ schema_version: 4, id: 'node_test', version: '1.0.0', resolution,
    root: 'test_root', inputs: {}, variables: {}, nodes: [
      { id: 'test_root', type: 'root', children: [TEST_NODE_ID] },
      { id: TEST_NODE_ID, type: 'task', name: draft.name, action: draft.action, params: draft.params },
    ] });
}
