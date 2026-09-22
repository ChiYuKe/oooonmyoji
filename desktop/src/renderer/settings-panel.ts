/**
 * 设置面板：内容视图、实例自动刷新、启动行为与 Debug 截图的读写与事件绑定。
 *
 * 原来这些 DOM 引用、localStorage 读写、轮询定时器与 change 监听散在 main.ts；
 * 现在状态由本模块自己持有，入口只负责把各面板句柄注入进来。
 * 元素在构造时查询（不在模块顶层），模块可以脱离真实窗口被实例化。
 */

import type { RuntimeResourceProgress, RuntimeResourceStatus, RuntimeResourceVariantId } from '../shared/contracts';

export interface SettingsPanelDeps {
  api: {
    getDebugSettings(): Promise<{ enabled: boolean; annotateScreenshots: boolean }>;
    updateDebugSettings(settings: { enabled: boolean; annotateScreenshots: boolean }): Promise<{ enabled: boolean; annotateScreenshots: boolean }>;
    getRuntimeResourceStatus(): Promise<RuntimeResourceStatus>;
    installRuntimeResources(variant: RuntimeResourceVariantId): Promise<void>;
    activateRuntimeResources(variant: RuntimeResourceVariantId): Promise<RuntimeResourceStatus>;
    removeRuntimeResources(variant: RuntimeResourceVariantId): Promise<RuntimeResourceStatus>;
    onRuntimeResourceProgress(listener: (event: RuntimeResourceProgress) => void): () => void;
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
  const runtimeResources = document.querySelector<HTMLElement>('#settings-runtime-resources')!;
  const runtimeProgress = document.querySelector<HTMLElement>('#settings-runtime-progress')!;

  let autoRefreshInstances = true;
  let loadDefaultWorkflowOnStart = true;
  let restoreSessionOnStart = true;
  let instanceRefreshTimer: number | undefined;
  let resourceBusy = false;

  const resourceSize = (bytes: number): string => bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;

  function renderRuntimeResources(value: RuntimeResourceStatus): void {
    runtimeResources.textContent = '';
    for (const item of value.variants) {
      const card = document.createElement('article');
      card.className = `runtime-resource-card${value.activeVariant === item.id ? ' active' : ''}${item.supported ? '' : ' unsupported'}`;
      const icon = document.createElement('span');
      icon.className = 'runtime-resource-icon';
      icon.textContent = item.id === 'gpu' ? 'GPU' : 'CPU';
      const copy = document.createElement('span');
      copy.className = 'runtime-resource-copy';
      const title = document.createElement('strong');
      title.textContent = `${item.label}${value.activeVariant === item.id ? ' · 当前使用' : ''}`;
      const description = document.createElement('small');
      description.textContent = item.description;
      const meta = document.createElement('em');
      meta.textContent = item.supported
        ? `${item.ready ? `已安装 ${item.installedVersion}` : `需下载 ${resourceSize(item.downloadBytes)}`} · ${item.supportMessage ?? ''}`
        : item.supportMessage ?? '当前设备不可用';
      copy.append(title, description, meta);
      const actions = document.createElement('span');
      actions.className = 'runtime-resource-actions';
      if (!item.ready) {
        const install = document.createElement('button');
        install.type = 'button'; install.textContent = '安装'; install.dataset.runtimeAction = 'install'; install.dataset.variant = item.id;
        install.disabled = resourceBusy || !item.supported;
        actions.appendChild(install);
      } else if (value.activeVariant !== item.id) {
        const activate = document.createElement('button');
        activate.type = 'button'; activate.textContent = '切换'; activate.dataset.runtimeAction = 'activate'; activate.dataset.variant = item.id;
        activate.disabled = resourceBusy;
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = '删除'; remove.className = 'danger'; remove.dataset.runtimeAction = 'remove'; remove.dataset.variant = item.id;
        remove.disabled = resourceBusy;
        actions.append(activate, remove);
      }
      card.append(icon, copy, actions);
      runtimeResources.appendChild(card);
    }
  }

  async function refreshRuntimeResources(): Promise<void> {
    renderRuntimeResources(await api.getRuntimeResourceStatus());
  }

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
    void refreshRuntimeResources().catch((error) => showToast(`读取运行环境失败：${String(error)}`, true));
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
    runtimeResources.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('[data-runtime-action]');
      const id = button?.dataset.variant;
      if (!button || (id !== 'cpu' && id !== 'gpu') || resourceBusy) return;
      const action = button.dataset.runtimeAction;
      if (action === 'remove' && !window.confirm('删除该运行环境？以后仍可重新下载。')) return;
      void (async () => {
        resourceBusy = true;
        runtimeProgress.textContent = action === 'install' ? '正在准备下载…' : action === 'activate' ? '正在切换运行环境…' : '正在删除…';
        await refreshRuntimeResources().catch(() => undefined);
        try {
          if (action === 'install') await api.installRuntimeResources(id);
          else if (action === 'activate') {
            await api.activateRuntimeResources(id);
            showToast(`已切换到${id === 'gpu' ? 'NVIDIA GPU 加速版' : 'CPU 通用版'}`);
            refreshInstances();
          } else if (action === 'remove') await api.removeRuntimeResources(id);
          runtimeProgress.textContent = action === 'install' ? '安装完成，可点击“切换”启用。' : '';
        } catch (error) {
          runtimeProgress.textContent = '';
          showToast(`${action === 'install' ? '安装' : action === 'activate' ? '切换' : '删除'}运行环境失败：${String(error)}`, true);
        } finally {
          resourceBusy = false;
          await refreshRuntimeResources().catch(() => undefined);
        }
      })();
    });
  }

  const stopResourceProgress = api.onRuntimeResourceProgress((event) => {
    runtimeProgress.textContent = event.phase === 'downloading' && event.totalBytes > 0
      ? `${event.message} ${resourceSize(event.receivedBytes)} / ${resourceSize(event.totalBytes)}`
      : event.message;
  });

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
      stopResourceProgress();
      if (instanceRefreshTimer !== undefined) window.clearInterval(instanceRefreshTimer);
      instanceRefreshTimer = undefined;
    },
  };
}
