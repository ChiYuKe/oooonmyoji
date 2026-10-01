export interface WorkflowTestInit {
  uri: string;
  text: string;
  instanceId: string;
  nodeIds: string[];
}

export interface TestExpectation {
  path: string;
  operator: 'equals' | 'contains' | 'count' | 'at_least' | 'exists';
  value?: unknown;
}

export interface WorkflowTestRequest extends WorkflowTestInit {
  mode: 'live' | 'offline';
  images: string[];
  rounds: number;
  singleStep: boolean;
  breakpoints: string[];
  parameterOverrides: Record<string, Record<string, unknown>>;
  inputs: Record<string, unknown>;
  variables: Record<string, unknown>;
  outputs: Record<string, unknown>;
  expectations: TestExpectation[];
}

export type TestCommand = 'pause' | 'step' | 'continue' | 'stop';
export type WorkflowTestEvent = Record<string, unknown> & { type: string };

export interface TestNodeDraft {
  action: string;
  name: string;
  params: Record<string, unknown>;
}
export interface TestNodeTransfer {
  requestId: string;
  uri: string;
  node: TestNodeDraft;
}
export interface TestNodeAdded {
  requestId: string;
  uri: string;
  nodeId?: string;
  error?: string;
}

/** Configuration is persisted independently of the workflow document. */
export function testProfileKey(uri: string): string {
  let hash = 2166136261;
  for (const character of uri) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `workflow-test.v1.${(hash >>> 0).toString(16)}`;
}
