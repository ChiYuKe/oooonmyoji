/**
 * 设置面板：内容视图、实例自动刷新、启动行为与 Debug 截图的读写与事件绑定。
 *
 * 原来这些 DOM 引用、localStorage 读写、轮询定时器与 change 监听散在 main.ts；
 * 现在状态由本模块自己持有，入口只负责把各面板句柄注入进来。
 * 元素在构造时查询（不在模块顶层），模块可以脱离真实窗口被实例化。
 */

export interface SettingsPanelDeps {
  api: {
    getDebugSettings(): Promise<{ enabled: boolean; annotateScreenshots: boolean }>;
    updateDebugSettings(settings: { enabled: boolean; annotateScreenshots: boolean }): Promise<{ enabled: boolean; annotateScreenshots: boolean }>;
  };
  contentBrowser: { getView(): string; setView(view: 'grid' | 'list'): void };
  showToast(message: string, error?: boolean): void;
  /** 把工作台切到设置面板（没有工作台时为空操作）。 */
  showPanel(): void;
  refreshInstances(): void;
  /** 实例自动刷新间隔（毫秒），默认 5000。 */
  refreshIntervalMs?: number;
}

export interface SettingsPanelController {
  /** 从 localStorage 读回启动行为（自动刷新 / 默认工作流 / 恢复会话）。 */
  readSettings(): void;
  autoRefreshInstances(): boolean;
  loadDefaultWorkflowOnStart(): boolean;
  restoreSessionOnStart(): boolean;
  /** 打开设置面板：同步控件状态并按需刷新 Debug 设置。 */
  openSettingsPanel(): void;
  refreshDebugSettings(): Promise<void>;
  /** 按当前自动刷新开关重建实例轮询定时器。 */
  restartInstanceRefresh(): void;
  /** 绑定设置控件的 change 事件。 */
  bind(): void;
  /** 退出前清掉轮询定时器。 */
  dispose(): void;
}

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanelController {
  const { api, contentBrowser, showToast, showPanel, refreshInstances } = deps;
  const refreshIntervalMs = deps.refreshIntervalMs ?? 5000;
  const contentView = document.querySelector<HTMLSelectElement>('#settings-content-view')!;
  const autoRefresh = document.querySelector<HTMLInputElement>('#settings-auto-refresh')!;
  const defaultWorkflow = document.querySelector<HTMLInputElement>('#settings-default-workflow')!;
  const restoreSession = document.querySelector<HTMLInputElement>('#settings-restore-session')!;
  const debugEnabled = document.querySelector<HTMLInputElement>('#settings-debug-enabled')!;
  const debugAnnotate = document.querySelector<HTMLInputElement>('#settings-debug-annotate')!;

  let autoRefreshInstances = true;
  let loadDefaultWorkflowOnStart = true;
  let restoreSessionOnStart = true;
  let instanceRefreshTimer: number | undefined;

  async function refreshDebugSettings(): Promise<void> {
    const settings = await api.getDebugSettings();
    debugEnabled.checked = settings.enabled;
    debugAnnotate.checked = settings.annotateScreenshots;
    debugAnnotate.disabled = !settings.enabled;
  }

  function openSettingsPanel(): void {
    contentView.value = contentBrowser.getView();
    autoRefresh.checked = autoRefreshInstances;
    defaultWorkflow.checked = loadDefaultWorkflowOnStart;
    restoreSession.checked = restoreSessionOnStart;
    void refreshDebugSettings().catch((error) => showToast(`读取 Debug 设置失败：${String(error)}`));
    showPanel();
  }

  function readSettings(): void {
    autoRefreshInstances = window.localStorage.getItem('onmyoji-studio.settings.auto-refresh') !== 'false';
    loadDefaultWorkflowOnStart = window.localStorage.getItem('onmyoji-studio.settings.default-workflow') !== 'false';
    restoreSessionOnStart = window.localStorage.getItem('onmyoji-studio.settings.restore-session') !== 'false';
  }

  function restartInstanceRefresh(): void {
    if (instanceRefreshTimer !== undefined) {
      window.clearInterval(instanceRefreshTimer);
      instanceRefreshTimer = undefined;
    }
    if (autoRefreshInstances) {
      instanceRefreshTimer = window.setInterval(() => void refreshInstances(), refreshIntervalMs);
    }
  }

  function bind(): void {
    contentView.addEventListener('change', () => contentBrowser.setView(contentView.value === 'list' ? 'list' : 'grid'));
    autoRefresh.addEventListener('change', () => {
      autoRefreshInstances = autoRefresh.checked;
      window.localStorage.setItem('onmyoji-studio.settings.auto-refresh', String(autoRefreshInstances));
      restartInstanceRefresh();
    });
    defaultWorkflow.addEventListener('change', () => {
      loadDefaultWorkflowOnStart = defaultWorkflow.checked;
      window.localStorage.setItem('onmyoji-studio.settings.default-workflow', String(loadDefaultWorkflowOnStart));
    });
    restoreSession.addEventListener('change', () => {
      restoreSessionOnStart = restoreSession.checked;
      window.localStorage.setItem('onmyoji-studio.settings.restore-session', String(restoreSessionOnStart));
    });
    const saveDebugSettings = async (): Promise<void> => {
      debugEnabled.disabled = true;
      debugAnnotate.disabled = true;
      try {
        const settings = await api.updateDebugSettings({
          enabled: debugEnabled.checked,
          annotateScreenshots: debugAnnotate.checked,
        });
        debugEnabled.checked = settings.enabled;
        debugAnnotate.checked = settings.annotateScreenshots;
        showToast(settings.enabled ? 'Debug 逐步截图已开启，下次运行生效' : 'Debug 逐步截图已关闭');
      } catch (error) {
        showToast(`保存 Debug 设置失败：${String(error)}`);
        await refreshDebugSettings().catch(() => undefined);
      } finally {
        debugEnabled.disabled = false;
        debugAnnotate.disabled = !debugEnabled.checked;
      }
    };
    debugEnabled.addEventListener('change', () => void saveDebugSettings());
    debugAnnotate.addEventListener('change', () => void saveDebugSettings());
  }

  return {
    readSettings,
    autoRefreshInstances: () => autoRefreshInstances,
    loadDefaultWorkflowOnStart: () => loadDefaultWorkflowOnStart,
    restoreSessionOnStart: () => restoreSessionOnStart,
    openSettingsPanel,
    refreshDebugSettings,
    restartInstanceRefresh,
    bind,
    dispose: () => {
      if (instanceRefreshTimer !== undefined) window.clearInterval(instanceRefreshTimer);
      instanceRefreshTimer = undefined;
    },
  };
}
