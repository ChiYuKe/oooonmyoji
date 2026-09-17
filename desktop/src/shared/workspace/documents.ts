/**
 * 工作区文档存储：文档列表、活动文档、正文、脏标记与返回栈的唯一归属。
 * 纯状态模块（无 DOM/Electron 依赖），渲染层工作区与测试共用。
 */
import type { WorkflowDocumentTab } from './session';

export interface DocumentStore {
  /** 只读的文档列表（顺序即标签顺序）。 */
  tabs(): readonly WorkflowDocumentTab[];
  tab(uri: string): WorkflowDocumentTab | undefined;
  activeUri(): string;
  activeTab(): WorkflowDocumentTab | undefined;
  activeText(): string;
  isDirty(): boolean;
  activeBackStack(): string[];
  /** 不存在时创建文档记录；已存在时原样返回。 */
  ensure(uri: string): WorkflowDocumentTab;
  /** 删除文档记录；删除的是活动文档时清空活动项，由调用方决定下一个活动文档。 */
  remove(uri: string): boolean;
  /** 文件移动/重命名后同步文档记录与活动项。 */
  rename(oldUri: string, newUri: string): void;
  setActive(uri: string): void;
  setText(uri: string, text: string): void;
  setDirty(uri: string, dirty: boolean): void;
  setBackStack(uri: string, stack: string[]): void;
  setActiveBackStack(stack: string[]): void;
  pushActiveBackStack(uri: string): void;
  popActiveBackStack(): string | undefined;
  popBackStack(uri: string): string | undefined;
  /** 会话恢复时整体替换。 */
  replaceAll(tabs: WorkflowDocumentTab[], activeUri: string): void;
}

export function createDocumentStore(): DocumentStore {
  const documents: WorkflowDocumentTab[] = [];
  let active = '';

  const tab = (uri: string): WorkflowDocumentTab | undefined => documents.find((item) => item.uri === uri);
  const activeTab = (): WorkflowDocumentTab | undefined => tab(active);

  return {
    tabs: () => documents,
    tab,
    activeUri: () => active,
    activeTab,
    activeText: () => activeTab()?.text ?? '',
    isDirty: () => activeTab()?.dirty ?? false,
    activeBackStack: () => [...(activeTab()?.backStack ?? [])],
    ensure(uri) {
      let existing = tab(uri);
      if (!existing) {
        existing = { uri, text: '', dirty: false, backStack: [] };
        documents.push(existing);
      }
      return existing;
    },
    remove(uri) {
      const index = documents.findIndex((item) => item.uri === uri);
      if (index < 0) return false;
      documents.splice(index, 1);
      if (active === uri) active = '';
      return true;
    },
    rename(oldUri, newUri) {
      if (!oldUri || oldUri === newUri) return;
      const existing = tab(oldUri);
      if (existing) existing.uri = newUri;
      if (active === oldUri) active = newUri;
    },
    setActive(uri) {
      active = uri;
    },
    setText(uri, text) {
      const existing = tab(uri);
      if (existing) existing.text = text;
    },
    setDirty(uri, dirty) {
      const existing = tab(uri);
      if (existing) existing.dirty = dirty;
    },
    setBackStack(uri, stack) {
      const existing = tab(uri);
      if (existing) existing.backStack = [...stack];
    },
    setActiveBackStack(stack) {
      const existing = activeTab();
      if (existing) existing.backStack = [...stack];
    },
    pushActiveBackStack(uri) {
      const existing = activeTab();
      if (existing && uri) existing.backStack.push(uri);
    },
    popActiveBackStack() {
      return activeTab()?.backStack.pop();
    },
    popBackStack(uri) {
      return tab(uri)?.backStack.pop();
    },
    replaceAll(tabs, activeUri) {
      documents.splice(0, documents.length, ...tabs.map((item) => ({
        uri: item.uri,
        text: item.text,
        dirty: item.dirty,
        backStack: [...item.backStack],
      })));
      active = activeUri;
    },
  };
}
