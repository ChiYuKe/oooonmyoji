/**
 * 工作流会话的序列化与恢复：把打开的标签与未保存内容持久化到本地布局。
 * 纯函数，无外部依赖；workflow-session.test.cjs 会按函数名切片执行。
 */
export const WORKFLOW_SESSION_VERSION = 1;

export interface WorkflowDocumentTab {
  uri: string;
  text: string;
  dirty: boolean;
  backStack: string[];
}

export interface PersistedWorkflowTab {
  uri: string;
  text: string;
  dirty: boolean;
  backStack: string[];
}

export interface WorkflowSession {
  version: number;
  tabs: PersistedWorkflowTab[];
  activeUri: string;
}

export function serializeWorkflowSession(tabs: WorkflowDocumentTab[], activeUri: string): string {
  const payload: WorkflowSession = {
    version: WORKFLOW_SESSION_VERSION,
    activeUri,
    // 只为未保存的标签保留正文，避免把整个项目写进会话文件。
    tabs: tabs.map((tab) => ({
      uri: tab.uri,
      text: tab.dirty ? tab.text : '',
      dirty: tab.dirty,
      backStack: [...tab.backStack],
    })),
  };
  return JSON.stringify(payload);
}


export function parseWorkflowSession(raw: string | null | undefined): WorkflowSession | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const value = parsed as { tabs?: unknown; activeUri?: unknown };
  if (!Array.isArray(value.tabs)) return undefined;
  const tabs: PersistedWorkflowTab[] = [];
  for (const entry of value.tabs) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const tab = entry as { uri?: unknown; text?: unknown; dirty?: unknown; backStack?: unknown };
    const uri = typeof tab.uri === 'string' ? tab.uri : '';
    if (!uri) continue;
    const text = typeof tab.text === 'string' ? tab.text : '';
    const dirty = tab.dirty === true && text !== '';
    const backStack = Array.isArray(tab.backStack)
      ? tab.backStack.filter((item): item is string => typeof item === 'string')
      : [];
    tabs.push({ uri, text, dirty, backStack });
  }
  if (tabs.length === 0) return undefined;
  const requested = typeof value.activeUri === 'string' ? value.activeUri : '';
  const activeUri = tabs.some((tab) => tab.uri === requested) ? requested : tabs[0].uri;
  return { version: WORKFLOW_SESSION_VERSION, tabs, activeUri };
}


export function reconcileWorkflowSession(session: WorkflowSession | undefined, knownUris: string[]): WorkflowSession | undefined {
  if (!session) return undefined;
  const known = new Set(knownUris);
  const tabs = session.tabs.filter((tab) => known.has(tab.uri));
  if (tabs.length === 0) return undefined;
  const activeUri = tabs.some((tab) => tab.uri === session.activeUri) ? session.activeUri : tabs[0].uri;
  return { version: session.version, tabs, activeUri };
}

