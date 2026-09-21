/**
 * 工作流文档生命周期：标签/面板的打开、激活、关闭与对账，画布运行时状态的存取。
 *
 * 原 `main.ts` 的文档处理函数与状态（closingDocuments/documentsReady/
 * removingDocument/suppressDocumentRemoval/documentLoads/activatingUri），
 * 抽出后改一个文档/标签行为不再需要跨 main.ts 追踪；workspace 只存状态，
 * 本模块只做编排。面板句柄与可变状态（docking/bootstrap/selectedInstance/
 * sidebar 等）经惰性取值或 getter 注入，构造期不互相引用。
 */
import type { BootstrapData, RuntimeInstance, WorkflowDescriptor, WorkflowEditorInit } from '../shared/contracts';
import type { WorkflowDocumentTab } from '../shared/workspace/session';
import type { DocumentRuntime, Workspace } from './workspace';
import type { DockingController, WorkbenchFrameController } from './docking';
import type { Sidebar } from './panels/sidebar';

export interface DocumentLifecycleDeps {
  api: {
    getWorkflowInit(uri: string, selectedInstance: string, canGoBack: boolean): Promise<WorkflowEditorInit>;
    saveWorkflow(uri: string, text: string): Promise<unknown>;
  };
  workspace: Workspace;
  getDocking(): DockingController | undefined;
  getWorkbenchFrame(): WorkbenchFrameController | undefined;
  getBootstrap(): BootstrapData | undefined;
  getSelectedInstance(): string;
  setSelectedInstance(instanceId: string): void;
  sidebar: Sidebar;
  overview: {
    reconcileSelection(initial?: boolean): void;
    render(): void;
  };
  contentBrowser: { render(): void };
  loadingMask: HTMLElement;
  detailsFrame: HTMLIFrameElement;
  renderWorkflowSelect(workflows: WorkflowDescriptor[]): void;
  renderInstances(instances: RuntimeInstance[], requested?: string): void;
  setStatus(message: string): void;
  showToast(message: string, error?: boolean): void;
  errorMessage(error: unknown): string;
  setDocumentPanelDirty(panelId: string, dirty: boolean): void;
  /** 重置布局时同步恢复共享面板到默认停靠面（没有共享桥时为空操作）。 */
  resetSharedPanelSurfaces(): void;
  /**
   * 打开文档时的崩溃恢复：有比磁盘更新的恢复副本时问用户，返回要采用的正文
   * （`null` = 继续用磁盘版本）。缺省表示不做恢复。
   */
  resolveRecovery?(uri: string, diskText: string): Promise<string | null>;
  /**
   * 磁盘被外部改写、本地又有未保存修改时的三选：返回 `'local'`（保留本地）/`'disk'`（用磁盘版）。
   * 缺省退化为「保留本地」（旧行为：跳过这个文档）。
   */
  resolveExternalChange?(uri: string): Promise<'local' | 'disk'>;
}

export interface DocumentLifecycleController {
  /** 把未保存状态同步到原生 Dockview 标签。 */
  syncDocumentTabs(): void;
  /** 确保工作流文档存在标签与 Dockview 面板，新面板默认成为激活项。 */
  ensureDocument(uri: string): WorkflowDocumentTab;
  loadWorkflow(uri: string): Promise<void>;
  /**
   * 磁盘上的文件被外部改写（内容浏览器重命名/移动时重定向引用）后，强制这些文档重新读盘；
   * 返回因未保存修改而跳过的文档。
   */
  reloadDocuments(uris: readonly string[]): Promise<string[]>;
  /** 同一文档的加载只跑一次，标签激活与显式打开共享同一个 Promise。 */
  loadDocumentOnce(uri: string): Promise<void>;
  /** 画布握手完成后下发它自己的初始化数据；同一文档的多个面板互不影响。 */
  sendDocumentInit(uri: string): void;
  /** preserveNavigation 只用于“沿子工作流面包屑跳转”；普通标签激活会清除旧路径。 */
  activateWorkflowTab(uri: string, preserveNavigation?: boolean): Promise<void>;
  openWorkflowTab(uri: string, preserveNavigation?: boolean): Promise<void>;
  openWorkflowInNewTab(uri: string): void;
  /** 顶栏选择或子流程跳转：打开/聚焦对应文档面板，并把导航栈重置为该文档自己的记录。 */
  switchWorkflow(uri: string, resetStack?: boolean): Promise<void>;
  closeWorkflowTab(uri: string): Promise<void>;
  /** Dockview 面板被移除（关闭按钮、右键菜单或快捷键）后的收尾：保存、清状态、补默认画布。 */
  handleDocumentRemoved(uri: string): Promise<void>;
  relocateDocument(oldUri: string, newUri: string): void;
  /** 恢复布局后：关掉不再存在的文档面板，并为会话里的文档补齐面板。 */
  reconcileDocumentPanels(): void;
  /** 没有任何可打开的默认工作流时，至少保证有一个画布。 */
  ensureFallbackDocument(): void;
  /** 恢复默认布局：批量重建面板时抑制移除回调，随后按当前标签重新同步。 */
  resetDockLayout(): void;
  workflowTrail(): Array<{ uri: string; name: string }>;
  /** 会话恢复完成前忽略 Dockview 的激活事件，避免加载到错误的文档。 */
  isDocumentsReady(): boolean;
  setDocumentsReady(): void;
  /** 关闭文档期间抑制激活事件，避免邻居面板抢先把 currentUri 切走。 */
  isRemovingDocument(): boolean;
  /** 正在由壳层主动关闭的文档，避免 onDidRemoveDocument 重复走保存流程。 */
  hasClosingDocuments(): boolean;
  /** 正在由壳层主动关闭的文档集合（内容浏览器移动/重命名时也要用到）。 */
  closingDocumentUris(): Set<string>;
  /** 布局重置/会话对账时批量移除面板，不应触发保存与标签删除（退出时也用它抑制）。 */
  suppressRemovals(): void;
}

export function createDocumentLifecycle(deps: DocumentLifecycleDeps): DocumentLifecycleController {
  const {
    api, workspace, getDocking, getWorkbenchFrame, getBootstrap, getSelectedInstance, setSelectedInstance,
    sidebar, overview, contentBrowser, loadingMask, detailsFrame,
    renderWorkflowSelect, renderInstances, setStatus, showToast, errorMessage, setDocumentPanelDirty,
    resetSharedPanelSurfaces,
  } = deps;

  /** 正在由壳层主动关闭的文档，避免 onDidRemoveDocument 重复走保存流程。 */
  const closingDocuments = new Set<string>();
  /** 会话恢复完成前忽略 Dockview 的激活事件，避免加载到错误的文档。 */
  let documentsReady = false;
  /** 关闭文档期间抑制激活事件，避免邻居面板抢先把 currentUri 切走。 */
  let removingDocument = false;
  /** 布局重置/会话对账时批量移除面板，不应触发保存与标签删除。 */
  let suppressDocumentRemoval = false;
  /** setActive 可能同步触发 Dockview 激活事件；标记这些激活来自面包屑导航。 */
  const preservingNavigation = new Set<string>();

  function relocateDocument(oldUri: string, newUri: string): void {
    const docking = getDocking();
    if (!docking || !oldUri || oldUri === newUri) return;
    if (docking.isDocumentOpen(oldUri)) {
      closingDocuments.add(oldUri);
      docking.closeDocument(oldUri);
      closingDocuments.delete(oldUri);
    }
    workspace.getDocumentRuntimes().delete(oldUri);
    workspace.renameDocument(oldUri, newUri);
    if (!docking.isDocumentOpen(newUri)) docking.openDocument(newUri, workspace.workflowTabName(newUri));
    syncDocumentTabs();
  }

  /** 恢复布局后：关掉不再存在的文档面板，并为会话里的文档补齐面板。 */
  function reconcileDocumentPanels(): void {
    const docking = getDocking();
    if (!docking) return;
    const known = new Set(workspace.tabs().map((tab) => tab.uri));
    for (const uri of docking.documentUris()) {
      if (known.has(uri)) continue;
      closingDocuments.add(uri);
      docking.closeDocument(uri);
      closingDocuments.delete(uri);
      workspace.getDocumentRuntimes().delete(uri);
    }
    for (const tab of workspace.tabs()) {
      if (!docking.isDocumentOpen(tab.uri)) docking.openDocument(tab.uri, workspace.workflowTabName(tab.uri));
    }
    syncDocumentTabs();
  }

  /** 没有任何可打开的默认工作流时，至少保证有一个画布。 */
  function ensureFallbackDocument(): void {
    if (workspace.tabs().length > 0) return;
    const first = getBootstrap()?.workflows[0];
    if (first) void openWorkflowTab(first.uri);
  }

  /** 恢复默认布局：批量重建面板时抑制移除回调，随后按当前标签重新同步。 */
  function resetDockLayout(): void {
    suppressDocumentRemoval = true;
    try {
      getDocking()?.resetLayout();
      getWorkbenchFrame()?.resetLayout();
      resetSharedPanelSurfaces();
    } finally {
      suppressDocumentRemoval = false;
    }
    syncDocumentTabs();
  }

  /** 把未保存状态同步到原生 Dockview 标签。 */
  function syncDocumentTabs(): void {
    for (const tab of workspace.tabs()) {
      const runtime = workspace.getDocumentRuntimes().get(tab.uri);
      if (!runtime) continue;
      setDocumentPanelDirty(runtime.panelId, tab.dirty);
      getDocking()?.dockviewApi.getPanel(runtime.panelId)?.api.setTitle(workspace.workflowTabName(tab.uri));
    }
    workspace.scheduleWorkflowSessionPersist();
  }

  /** 把当前激活画布的选中项/折叠状态写回运行时，切换文档时原样恢复。 */
  function rememberActiveRuntimeState(): void {
    const runtime = workspace.activeRuntime();
    if (!runtime) return;
    const view = sidebar.snapshot();
    runtime.sidebarNodes = view.nodes;
    runtime.sidebarVariables = view.variables;
    runtime.selectedNode = view.selectedNode;
    runtime.selectedVariable = view.selectedVariable;
    runtime.selectedVariableScope = view.selectedVariableScope;
    runtime.collapsedTreeNodes = view.collapsed;
  }

  /** 把运行时的画布状态恢复到左侧面板，重新驱动结构树与详细信息。 */
  function applyDocumentState(uri: string, tab: WorkflowDocumentTab, runtime: DocumentRuntime): void {
    workspace.setActiveDocument(uri);
    sidebar.apply({
      nodes: runtime.sidebarNodes,
      variables: runtime.sidebarVariables,
      selectedNode: runtime.selectedNode,
      selectedVariable: runtime.selectedVariable,
      selectedVariableScope: runtime.selectedVariableScope,
      collapsed: runtime.collapsedTreeNodes,
    });
    if (runtime.init) {
      setSelectedInstance(runtime.init.selectedInstance);
      runtime.init.workflowTrail = workflowTrail();
      renderWorkflowSelect(runtime.init.workflows);
      renderInstances(runtime.init.instances, runtime.init.selectedInstance);
      workspace.postToFrame(detailsFrame, runtime.init as unknown as Record<string, unknown>);
    }
    document.querySelector<HTMLElement>('#document-path')!.textContent = workspace.displayFileUri(uri);
    workspace.setDirty(tab.dirty);
    overview.render();
    sidebar.render();
    if (runtime.inspectorSelection) {
      workspace.postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: runtime.inspectorSelection });
    }
    syncDocumentTabs();
  }

  /** 画布握手完成后下发它自己的初始化数据；同一文档的多个面板互不影响。 */
  function sendDocumentInit(uri: string): void {
    const runtime = workspace.getDocumentRuntimes().get(uri);
    if (!runtime?.init) return;
    // 页内 ready 消息可能先于运行时登记到达而被丢掉（启动恢复时常见），
    // 所以只要画布 iframe 已经加载完成就补发一次；重复下发是幂等的。
    if (!runtime.ready && runtime.frame.contentDocument?.readyState !== 'complete') return;
    runtime.ready = true;
    if (uri === workspace.activeUri()) runtime.init.workflowTrail = workflowTrail();
    workspace.postToFrame(runtime.frame, runtime.init as unknown as Record<string, unknown>);
    // 新画布（含刚从会话恢复的）也要拿到当前剪贴板，否则跨画布粘贴在它上面没有入口。
    const clipboard = workspace.canvasClipboard();
    if (clipboard) workspace.postToFrame(runtime.frame, { type: 'clipboard', clipboard });
    if (uri === workspace.activeUri()) workspace.postToFrame(detailsFrame, runtime.init as unknown as Record<string, unknown>);
  }

  function workflowTrailFor(uri: string): Array<{ uri: string; name: string }> {
    const uris = [...(workspace.tab(uri)?.backStack ?? []), uri].filter(Boolean);
    return uris.map((uri) => {
      const descriptor = getBootstrap()?.workflows.find((item) => item.uri === uri);
      const file = workspace.displayFileUri(uri).split(/[\\/]/).pop() || '';
      return { uri, name: descriptor?.id || descriptor?.name?.replace(/\.json$/i, '') || file.replace(/\.json$/i, '') || '工作流' };
    });
  }

  function workflowTrail(): Array<{ uri: string; name: string }> {
    return workflowTrailFor(workspace.activeUri());
  }

  function openWorkflowInNewTab(uri: string): void {
    getWorkbenchFrame()?.show('workflow');
    void openWorkflowTab(uri);
  }

  /** 顶栏选择或子流程跳转：打开/聚焦对应文档面板，并把导航栈重置为该文档自己的记录。 */
  async function switchWorkflow(uri: string, resetStack = true): Promise<void> {
    if (!uri) return;
    getWorkbenchFrame()?.show('workflow');
    workspace.cancelAutoSave();
    await workspace.waitForAutoSave();
    if (resetStack && workspace.tab(uri)) workspace.setDocumentBackStack(uri, []);
    await openWorkflowTab(uri);
  }

  /** 确保工作流文档存在标签与 Dockview 面板，新面板默认成为激活项。 */
  function ensureDocument(uri: string): WorkflowDocumentTab {
    const tab = workspace.ensureDocument(uri);
    const docking = getDocking();
    if (docking && !docking.isDocumentOpen(uri)) docking.openDocument(uri, workspace.workflowTabName(uri));
    syncDocumentTabs();
    return tab;
  }

  async function loadWorkflow(uri: string): Promise<void> {
    if (!uri) return;
    const tab = ensureDocument(uri);
    rememberActiveRuntimeState();
    workspace.cancelAutoSave();
    await workspace.waitForAutoSave();
    loadingMask.classList.remove('hidden');
    try {
      const init = await api.getWorkflowInit(uri, getSelectedInstance(), tab.backStack.length > 0);
      let documentText = tab.text || init.document.text;
      // 崩溃恢复：文档还没有内存副本、磁盘版本又比恢复副本旧时，先问用户要不要捡回未保存内容。
      if (!tab.text && deps.resolveRecovery) {
        const recovered = await deps.resolveRecovery(uri, documentText);
        if (recovered && recovered !== documentText) {
          documentText = recovered;
          tab.dirty = true;
        }
      }
      init.document.text = documentText;
      if (init.document.uri !== workspace.activeUri()) sidebar.resetCollapsed();
      workspace.setDocumentText(uri, documentText);
      workspace.setActiveDocument(init.document.uri);
      setSelectedInstance(init.selectedInstance);
      const bootstrap = getBootstrap();
      if (bootstrap) {
        bootstrap.workflows = init.workflows;
        bootstrap.instances = init.instances;
      }
      sidebar.resetViews();
      const runtime = workspace.getDocumentRuntimes().get(uri);
      if (runtime) {
        runtime.init = init;
        runtime.sidebarNodes = [];
        runtime.sidebarVariables = [];
        runtime.selectedNode = '';
        runtime.selectedVariable = '';
        runtime.collapsedTreeNodes = sidebar.snapshot().collapsed;
        runtime.inspectorSelection = undefined;
      }
      renderWorkflowSelect(init.workflows);
      renderInstances(init.instances, init.selectedInstance);
      overview.reconcileSelection();
      overview.render();
      contentBrowser.render();
      document.querySelector<HTMLElement>('#document-path')!.textContent = workspace.displayFileUri(init.document.uri);
      workspace.setDirty(tab.dirty);
      sidebar.render();
      workspace.postToFrame(detailsFrame, init as unknown as Record<string, unknown>);
      sendDocumentInit(uri);
      setStatus(init.issues.length > 0 ? `${init.issues.length} 个校验问题` : '工作流已载入');
    } catch (error) {
      showToast(errorMessage(error), true);
      setStatus('载入失败');
    } finally {
      loadingMask.classList.add('hidden');
    }
  }

  /**
   * 磁盘被外部改写后强制重新读盘。`loadWorkflow` 优先沿用内存正文（`tab.text`）以保留未保存的
   * 改动，所以被外部改写的文档必须先丢掉内存副本：否则画布会继续显示旧引用，下一次自动保存
   * 还会把旧内容写回磁盘，把刚完成的重定向覆盖掉。
   *
   * 本地有未保存修改时不再默默跳过：交给 `resolveExternalChange` 让用户三选
   * （对比 / 保留本地 / 使用磁盘版本）。选择「使用磁盘版本」就丢掉内存副本重新读盘；
   * 「保留本地」保持现状并把这个文档回报给调用方（照旧提示）。没有注入选择器时退化为保留本地。
   */
  async function reloadDocuments(uris: readonly string[]): Promise<string[]> {
    const skipped: string[] = [];
    const reloaded: string[] = [];
    const forced: string[] = [];
    for (const uri of uris) {
      const tab = uri ? workspace.tab(uri) : undefined;
      if (!tab) continue;
      if (tab.dirty) {
        const choice = deps.resolveExternalChange ? await deps.resolveExternalChange(uri) : 'local';
        if (choice !== 'disk') {
          skipped.push(uri);
          continue;
        }
        forced.push(uri);
      }
      workspace.cancelAutoSave(uri);
      workspace.setDocumentText(uri, '');
      const runtime = workspace.getDocumentRuntimes().get(uri);
      if (runtime) runtime.init = undefined;
      reloaded.push(uri);
    }
    if (reloaded.length === 0) return skipped;
    await workspace.waitForAutoSave();
    const active = workspace.activeUri();
    if (active && reloaded.includes(active)) await loadWorkflow(active);
    else syncDocumentTabs();
    // 明确选了「使用磁盘版本」的文档：丢弃内存里的修改，别再报成「跳过」。
    void forced;
    return skipped;
  }

  const documentLoads = new Map<string, Promise<void>>();
  /** 同一文档的加载只跑一次，标签激活与显式打开共享同一个 Promise。 */
  function loadDocumentOnce(uri: string): Promise<void> {
    const pending = documentLoads.get(uri);
    if (pending) return pending;
    const load = loadWorkflow(uri).finally(() => documentLoads.delete(uri));
    documentLoads.set(uri, load);
    return load;
  }

  let activatingUri: string | undefined;

  async function activateWorkflowTab(uri: string, preserveNavigation = preservingNavigation.has(uri)): Promise<void> {
    if (!uri) return;
    const tab = workspace.tab(uri);
    if (!tab) return;
    const clearedNavigation = !preserveNavigation && tab.backStack.length > 0;
    if (clearedNavigation) workspace.setDocumentBackStack(uri, []);
    // 只有「已经加载过」的活动文档才能只同步标签：启动恢复会话时
    // activeUri 已经被设为它，但运行时还没有 init，这里必须继续往下加载，
    // 否则首屏画布会一直空白，直到用户手动切一次标签。
    if (uri === workspace.activeUri() && workspace.getDocumentRuntimes().get(uri)?.init) {
      if (clearedNavigation) {
        const runtime = workspace.getDocumentRuntimes().get(uri)!;
        runtime.init!.workflowTrail = workflowTrailFor(uri);
        workspace.postToFrame(runtime.frame, {
          type: 'workflowTrail', workflowTrail: runtime.init!.workflowTrail, canGoBack: false,
        });
      }
      syncDocumentTabs();
      return;
    }
    if (activatingUri === uri) return;
    activatingUri = uri;
    try {
      getDocking()?.focusDocument(uri);
      rememberActiveRuntimeState();
      workspace.cancelAutoSave();
      await workspace.waitForAutoSave();
      const runtime = workspace.getDocumentRuntimes().get(uri);
      if (runtime?.init) {
        applyDocumentState(uri, tab, runtime);
        sendDocumentInit(uri);
        return;
      }
      await loadDocumentOnce(uri);
    } finally {
      activatingUri = undefined;
    }
  }

  async function openWorkflowTab(uri: string, preserveNavigation = false): Promise<void> {
    if (!uri) return;
    ensureDocument(uri);
    if (preserveNavigation) preservingNavigation.add(uri);
    try {
      getDocking()?.focusDocument(uri);
      await activateWorkflowTab(uri, preserveNavigation);
    } finally {
      preservingNavigation.delete(uri);
    }
  }

  /** Dockview 面板被移除（关闭按钮、右键菜单或快捷键）后的收尾：保存、清状态、补默认画布。 */
  async function handleDocumentRemoved(uri: string): Promise<void> {
    closingDocuments.delete(uri);
    if (suppressDocumentRemoval) {
      workspace.getDocumentRuntimes().delete(uri);
      return;
    }
    removingDocument = true;
    try {
      const tab = workspace.tab(uri);
      if (!tab) {
        workspace.unregisterDocumentFrame(workspace.getDocumentRuntimes().get(uri)?.panelId ?? '');
        workspace.getDocumentRuntimes().delete(uri);
        return;
      }
      const index = workspace.tabs().indexOf(tab);
      const wasActive = uri === workspace.activeUri();
      try {
        if (tab.dirty && tab.text) {
          await api.saveWorkflow(uri, tab.text);
          workspace.setDocumentDirty(uri, false);
        }
      } catch (error) {
        showToast(`关闭工作流失败：${errorMessage(error)}`, true);
      }
      workspace.getDocumentRuntimes().delete(uri);
      workspace.removeDocument(uri);
      removingDocument = false;
      if (workspace.tabs().length === 0) {
        const fallback = getBootstrap()?.defaultWorkflow;
        if (fallback) await openWorkflowTab(fallback);
        else syncDocumentTabs();
        return;
      }
      if (wasActive) await activateWorkflowTab(workspace.tabs()[Math.min(index, workspace.tabs().length - 1)].uri);
      else syncDocumentTabs();
    } finally {
      removingDocument = false;
    }
  }

  async function closeWorkflowTab(uri: string): Promise<void> {
    if (workspace.tabs().length <= 1) {
      showToast('至少保留一个工作流画布');
      return;
    }
    if (!workspace.tab(uri)) return;
    closingDocuments.add(uri);
    getDocking()?.closeDocument(uri);
    if (closingDocuments.has(uri)) {
      // 面板没有同步触发移除（例如还未渲染），退回到手动收尾。
      closingDocuments.delete(uri);
      await handleDocumentRemoved(uri);
    }
  }

  return {
    syncDocumentTabs,
    ensureDocument,
    loadWorkflow,
    reloadDocuments,
    loadDocumentOnce,
    sendDocumentInit,
    activateWorkflowTab,
    openWorkflowTab,
    openWorkflowInNewTab,
    switchWorkflow,
    closeWorkflowTab,
    handleDocumentRemoved,
    relocateDocument,
    reconcileDocumentPanels,
    ensureFallbackDocument,
    resetDockLayout,
    workflowTrail,
    isDocumentsReady: () => documentsReady,
    setDocumentsReady: () => { documentsReady = true; },
    isRemovingDocument: () => removingDocument,
    hasClosingDocuments: () => closingDocuments.size > 0,
    closingDocumentUris: () => closingDocuments,
    suppressRemovals: () => { suppressDocumentRemoval = true; },
  };
}
