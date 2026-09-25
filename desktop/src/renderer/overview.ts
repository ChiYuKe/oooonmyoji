/**
 * 脚本概览：工作流卡片、执行队列、输入配置与运行调度。
 * 状态由本模块持有，通过 createOverview 注入主窗口的实时状态读写与共享操作。
 * 单卡片渲染在 overview/card.ts（依赖注入、可独立测试）。
 */
import type { createIcons } from 'lucide';
import type {
  BootstrapData,
  OnmyojiDesktopApi,
  ParameterInfo,
  RuntimeInstance,
  RuntimeStateEvent,
  WorkflowDescriptor,
} from '../shared/contracts';
import type { DockingController, SharedPanelDockBridge, WorkbenchFrameController } from './docking';
import { OVERVIEW_INPUT_LABELS, overviewInputDisplayName } from './naming';
import { renderOverviewCard, type OverviewCardDeps, type OverviewItemStatus } from './overview/card';

interface OverviewRunState {
  items: Array<{ rel: string; status: OverviewItemStatus }>;
  index: number;
  instanceId: string;
  active: boolean;
  cancelling: boolean;
  message: string;
}


interface OverviewConfigReader {
  name: string;
  read: () => unknown;
  focus: () => void;
}

const overviewSearch = document.querySelector<HTMLInputElement>('#overview-search')!;
const overviewInstanceSelect = document.querySelector<HTMLSelectElement>('#overview-instance-select')!;
const overviewWorkflowGrid = document.querySelector<HTMLElement>('#overview-workflow-grid')!;
const overviewQueueElement = document.querySelector<HTMLElement>('#overview-queue')!;
const overviewRunButton = document.querySelector<HTMLButtonElement>('#overview-run')!;
const overviewStopButton = document.querySelector<HTMLButtonElement>('#overview-stop')!;
const overviewConfigModal = document.querySelector<HTMLElement>('#overview-config-modal')!;
const overviewConfigFields = document.querySelector<HTMLElement>('#overview-config-fields')!;

let selectedQueueRel = '';
let overviewSelection: string[] = [];
let overviewQuery = '';
let overviewRun: OverviewRunState | undefined;
let overviewConfigurations: Record<string, Record<string, unknown>> = {};
let overviewConfigWorkflow: WorkflowDescriptor | undefined;
let overviewConfigReaders: OverviewConfigReader[] = [];

const OVERVIEW_SELECTION_KEY = 'onmyoji-studio.overview-selection.v1';
const OVERVIEW_CONFIG_KEY = 'onmyoji-studio.overview-inputs.v1';
const WORKFLOW_SESSION_KEY = 'onmyoji-studio.workflow-session.v1';
const WORKFLOW_SESSION_VERSION = 1;

/* ---------- 依赖端口：由 createOverview 注入 ---------- */
type QueueDeleteTarget = { kind: 'queue'; rel: string };
type IconSet = NonNullable<Parameters<typeof createIcons>[0]>['icons'];

let api!: OnmyojiDesktopApi;
let createIconsRef!: typeof createIcons;
let desktopIconsRef!: IconSet;
let showToast!: (message: string, error?: boolean) => void;
let errorMessage!: (error: unknown) => string;
let desktopControl!: (command: string, value?: unknown) => void;
let instanceLabel!: (instance: RuntimeInstance) => string;
let renderWorkflowSelect!: (workflows: WorkflowDescriptor[]) => void;
let renderInstances!: (instances: RuntimeInstance[], requested?: string) => void;
let renderContentBrowser!: () => void;
let selectRuntimeInstance!: (instanceId: string, notify?: boolean) => void;
let getBootstrap!: () => BootstrapData | undefined;
let setBootstrap!: (value: BootstrapData) => void;
let isRuntimeBusy!: () => boolean;
let getSelectedInstance!: () => string;
let getRuntimeInstances!: () => RuntimeInstance[];
let getCurrentUri!: () => string;
let getCurrentText!: () => string;
let getWorkbenchFrame!: () => WorkbenchFrameController | undefined;
let getDocking!: () => DockingController | undefined;
let getSharedPanelDockBridge!: () => SharedPanelDockBridge | undefined;
let getDeleteTarget!: () => QueueDeleteTarget | undefined;
let setDeleteTarget!: (target: QueueDeleteTarget | undefined) => void;

function overviewWorkflowName(workflow: WorkflowDescriptor): string {
  return workflow.id || workflow.name.replace(/\.(?:owf|json)$/i, '');
}

function overviewWorkflowKind(workflow: WorkflowDescriptor): string {
  const rel = workflow.rel.replace(/\\/g, '/').toLowerCase();
  if (workflow.source === 'generated' || rel.startsWith('workflows/generated/')) return 'AI 生成';
  if (rel.includes('/entrypoints/')) return '入口脚本';
  if (rel.includes('/examples/')) return '示例';
  if (rel.includes('/shared/')) return '共享流程';
  return '工作流';
}

function overviewWorkflowRank(workflow: WorkflowDescriptor): number {
  const kind = overviewWorkflowKind(workflow);
  return kind === '入口脚本' ? 0 : kind === 'AI 生成' ? 1 : kind === '工作流' ? 2 : kind === '共享流程' ? 3 : 4;
}

function overviewWorkflowValidation(workflow: WorkflowDescriptor): { label: string; title: string; className: string } {
  if (workflow.validationStatus === 'valid') return { label: '已校验', title: '工作流校验通过', className: 'valid' };
  if (workflow.validationStatus === 'invalid') return { label: '有错误', title: '工作流存在校验错误，请打开编辑器查看', className: 'invalid' };
  return { label: '未校验', title: '尚未完成工作流校验', className: 'unknown' };
}

function overviewWorkflowUpdated(workflow: WorkflowDescriptor): string | undefined {
  if (typeof workflow.updatedAt !== 'number' || !Number.isFinite(workflow.updatedAt)) return undefined;
  return `更新 ${new Date(workflow.updatedAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function sortedOverviewWorkflows(): WorkflowDescriptor[] {
  return [...(getBootstrap()?.workflows ?? [])].sort((left, right) => (
    overviewWorkflowRank(left) - overviewWorkflowRank(right)
    || overviewWorkflowName(left).localeCompare(overviewWorkflowName(right), 'zh-CN')
    || left.rel.localeCompare(right.rel, 'zh-CN')
  ));
}

function filteredOverviewWorkflows(): WorkflowDescriptor[] {
  const query = overviewQuery.trim().toLocaleLowerCase('zh-CN');
  if (!query) return sortedOverviewWorkflows();
  return sortedOverviewWorkflows().filter((workflow) => (
    `${overviewWorkflowName(workflow)} ${workflow.name} ${workflow.rel} ${workflow.description ?? ''}`
      .toLocaleLowerCase('zh-CN')
      .includes(query)
  ));
}

function persistOverviewSelection(): void {
  window.localStorage.setItem(OVERVIEW_SELECTION_KEY, JSON.stringify(overviewSelection));
}

function reconcileOverviewSelection(loadPersisted = false): void {
  const available = new Set((getBootstrap()?.workflows ?? []).map((workflow) => workflow.rel));
  let candidates = overviewSelection;
  if (loadPersisted) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(OVERVIEW_SELECTION_KEY) || '[]') as unknown;
      candidates = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      candidates = [];
    }
  }
  overviewSelection = [...new Set(candidates.filter((rel) => available.has(rel)))];
  persistOverviewSelection();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneOverviewValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value;
  }
}

function persistOverviewConfigurations(): void {
  window.localStorage.setItem(OVERVIEW_CONFIG_KEY, JSON.stringify(overviewConfigurations));
}

function reconcileOverviewConfigurations(loadPersisted = false): void {
  let candidates: Record<string, Record<string, unknown>> = overviewConfigurations;
  if (loadPersisted) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(OVERVIEW_CONFIG_KEY) || '{}') as unknown;
      candidates = isPlainObject(parsed)
        ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, Record<string, unknown>] => isPlainObject(entry[1])))
        : {};
    } catch {
      candidates = {};
    }
  }
  const next: Record<string, Record<string, unknown>> = {};
  for (const workflow of getBootstrap()?.workflows ?? []) {
    const stored = candidates[workflow.rel];
    if (!stored) continue;
    const allowed = new Set((workflow.inputs ?? []).map((input) => input.name));
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(stored)) {
      const migratedName = OVERVIEW_INPUT_LABELS[name] ?? name;
      if (!allowed.has(migratedName)) continue;
      if (name === migratedName || !Object.prototype.hasOwnProperty.call(values, migratedName)) {
        values[migratedName] = value;
      }
    }
    if (Object.keys(values).length > 0) next[workflow.rel] = values;
  }
  overviewConfigurations = next;
  persistOverviewConfigurations();
}

function overviewConfiguredInputs(workflow: WorkflowDescriptor): Record<string, unknown> | undefined {
  const stored = overviewConfigurations[workflow.rel];
  if (!stored) return undefined;
  const values: Record<string, unknown> = {};
  for (const input of workflow.inputs ?? []) {
    if (Object.prototype.hasOwnProperty.call(stored, input.name)) {
      values[input.name] = cloneOverviewValue(stored[input.name]);
    }
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

function overviewParameterTypeLabel(definition: ParameterInfo): string {
  if (definition.enum?.length) return '选项';
  if (definition.type === 'boolean') return '开关';
  if (definition.type === 'integer') return '整数';
  if (definition.type === 'number') return '数字';
  if (definition.type === 'asset') return '图片资源';
  if (definition.type === 'rect') return '坐标 / 区域';
  if (definition.type === 'array') return '列表';
  if (definition.type === 'object') return '对象';
  return '文本';
}

function overviewInputInitialValue(name: string, definition: ParameterInfo, stored: Record<string, unknown>): unknown {
  if (Object.prototype.hasOwnProperty.call(stored, name)) return cloneOverviewValue(stored[name]);
  if (Object.prototype.hasOwnProperty.call(definition, 'default')) return cloneOverviewValue(definition.default);
  if (definition.enum?.length) return cloneOverviewValue(definition.enum[0]);
  if (definition.type === 'boolean') return false;
  if (definition.type === 'rect') return [0, 0, 0, 0];
  if (definition.type === 'array') return [];
  if (definition.type === 'object') return {};
  return undefined;
}

function overviewConfigHint(definition: ParameterInfo): string {
  const parts: string[] = [];
  if (definition.min !== undefined || definition.max !== undefined) {
    parts.push(`范围 ${definition.min ?? '不限'} – ${definition.max ?? '不限'}`);
  }
  if (definition.minItems !== undefined || definition.maxItems !== undefined) {
    parts.push(`条目 ${definition.minItems ?? '不限'} – ${definition.maxItems ?? '不限'}`);
  }
  if (Object.prototype.hasOwnProperty.call(definition, 'default')) {
    const raw = JSON.stringify(definition.default);
    parts.push(`默认 ${raw === undefined ? '未设置' : raw}`);
  }
  return parts.join(' · ');
}

function createOverviewConfigControl(
  name: string,
  definition: ParameterInfo,
  value: unknown,
): { element: HTMLElement; reader: OverviewConfigReader } {
  const invalid = (message: string): never => { throw new Error(`${overviewInputDisplayName(name)}：${message}`); };
  if (definition.enum?.length) {
    const select = document.createElement('select');
    select.className = 'overview-config-control';
    const selectedIndex = definition.enum.findIndex((item) => JSON.stringify(item) === JSON.stringify(value));
    definition.enum.forEach((optionValue, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = typeof optionValue === 'string' ? optionValue : JSON.stringify(optionValue);
      select.appendChild(option);
    });
    select.value = String(selectedIndex >= 0 ? selectedIndex : 0);
    return {
      element: select,
      reader: {
        name,
        read: () => cloneOverviewValue(definition.enum?.[Number(select.value)]),
        focus: () => select.focus(),
      },
    };
  }
  if (definition.type === 'boolean') {
    const label = document.createElement('label');
    label.className = 'overview-config-switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = value === true;
    const track = document.createElement('span');
    const text = document.createElement('em');
    text.textContent = checkbox.checked ? '开启' : '关闭';
    checkbox.addEventListener('change', () => { text.textContent = checkbox.checked ? '开启' : '关闭'; });
    label.append(checkbox, track, text);
    return { element: label, reader: { name, read: () => checkbox.checked, focus: () => checkbox.focus() } };
  }
  if (definition.type === 'integer' || definition.type === 'number') {
    const input = document.createElement('input');
    input.className = 'overview-config-control';
    input.type = 'number';
    input.step = definition.type === 'integer' ? '1' : 'any';
    if (definition.min !== undefined) input.min = String(definition.min);
    if (definition.max !== undefined) input.max = String(definition.max);
    input.value = typeof value === 'number' ? String(value) : '';
    return {
      element: input,
      reader: {
        name,
        read: () => {
          if (!input.value.trim()) return definition.required ? invalid('不能为空') : undefined;
          const parsed = Number(input.value);
          if (!Number.isFinite(parsed)) return invalid('请输入有效数字');
          if (definition.type === 'integer' && !Number.isInteger(parsed)) return invalid('请输入整数');
          if (definition.min !== undefined && parsed < definition.min) return invalid(`不能小于 ${definition.min}`);
          if (definition.max !== undefined && parsed > definition.max) return invalid(`不能大于 ${definition.max}`);
          return parsed;
        },
        focus: () => input.focus(),
      },
    };
  }
  if (definition.type === 'rect') {
    const rect = Array.isArray(value) ? value : [0, 0, 0, 0];
    const labels = ['X', 'Y', '宽', '高'];
    const wrap = document.createElement('div');
    wrap.className = 'overview-config-rect';
    const controls = labels.map((labelText, index) => {
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.value = typeof rect[index] === 'number' ? String(rect[index]) : '0';
      label.append(text, input);
      wrap.appendChild(label);
      return input;
    });
    return {
      element: wrap,
      reader: {
        name,
        read: () => controls.map((input) => {
          const parsed = Number(input.value);
          if (!Number.isFinite(parsed)) return invalid('四个坐标都必须是数字');
          return parsed;
        }),
        focus: () => controls[0].focus(),
      },
    };
  }
  if (definition.type === 'array' || definition.type === 'object') {
    const textarea = document.createElement('textarea');
    textarea.className = 'overview-config-control overview-config-json';
    textarea.spellcheck = false;
    textarea.value = value === undefined ? '' : JSON.stringify(value, null, 2);
    textarea.placeholder = definition.type === 'array' ? '[]' : '{}';
    return {
      element: textarea,
      reader: {
        name,
        read: () => {
          if (!textarea.value.trim()) return definition.required ? invalid('不能为空') : undefined;
          let parsed: unknown;
          try { parsed = JSON.parse(textarea.value); } catch { return invalid('格式不正确，请使用有效的 JSON'); }
          if (definition.type === 'array' && !Array.isArray(parsed)) return invalid('请输入列表，例如 [1, 2, 3]');
          if (definition.type === 'object' && !isPlainObject(parsed)) return invalid('请输入对象，例如 {"名称": "值"}');
          if (Array.isArray(parsed) && definition.minItems !== undefined && parsed.length < definition.minItems) return invalid(`至少需要 ${definition.minItems} 项`);
          if (Array.isArray(parsed) && definition.maxItems !== undefined && parsed.length > definition.maxItems) return invalid(`最多允许 ${definition.maxItems} 项`);
          return parsed;
        },
        focus: () => textarea.focus(),
      },
    };
  }
  const input = document.createElement('input');
  input.className = 'overview-config-control';
  input.type = 'text';
  input.value = value === undefined ? '' : String(value);
  input.placeholder = definition.type === 'asset' ? 'assets/templates/…' : '';
  return {
    element: input,
    reader: {
      name,
      read: () => {
        const text = input.value.trim();
        if (!text && definition.required) return invalid('不能为空');
        if (!text) return undefined;
        if (definition.minLength !== undefined && text.length < definition.minLength) return invalid(`至少需要 ${definition.minLength} 个字符`);
        if (definition.maxLength !== undefined && text.length > definition.maxLength) return invalid(`最多允许 ${definition.maxLength} 个字符`);
        return text;
      },
      focus: () => input.focus(),
    },
  };
}

function renderOverviewConfigFields(workflow: WorkflowDescriptor): void {
  overviewConfigReaders = [];
  const stored = overviewConfigurations[workflow.rel] ?? {};
  const fields = (workflow.inputs ?? []).map(({ name, definition }) => {
    const field = document.createElement('section');
    field.className = 'overview-config-field';
    const heading = document.createElement('div');
    heading.className = 'overview-config-field-heading';
    const label = document.createElement('label');
    const displayName = document.createElement('span');
    displayName.textContent = definition.display_name || overviewInputDisplayName(name);
    const parameterName = document.createElement('code');
    parameterName.textContent = name;
    label.append(displayName);
    if (displayName.textContent !== name) label.append(parameterName);
    const badges = document.createElement('span');
    badges.textContent = `${overviewParameterTypeLabel(definition)} · ${definition.required ? '必填' : '可选'}`;
    heading.append(label, badges);
    const { element, reader } = createOverviewConfigControl(name, definition, overviewInputInitialValue(name, definition, stored));
    label.addEventListener('click', () => reader.focus());
    overviewConfigReaders.push(reader);
    const description = document.createElement('p');
    description.textContent = definition.description || '此参数暂无说明。';
    const hintText = overviewConfigHint(definition);
    field.append(heading, element, description);
    if (hintText) {
      const hint = document.createElement('small');
      hint.textContent = hintText;
      field.appendChild(hint);
    }
    return field;
  });
  if (fields.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'overview-config-empty';
    empty.innerHTML = '<i data-lucide="sliders-horizontal"></i><strong>没有可配置参数</strong><span>这个脚本可以直接加入队列运行。</span>';
    fields.push(empty);
  }
  overviewConfigFields.replaceChildren(...fields);
  createIconsRef({ icons: desktopIconsRef, root: overviewConfigModal });
}

function openOverviewConfiguration(workflow: WorkflowDescriptor): void {
  overviewConfigWorkflow = workflow;
  document.querySelector<HTMLElement>('#overview-config-title')!.textContent = `${overviewWorkflowName(workflow)} · 配置`;
  document.querySelector<HTMLElement>('#overview-config-path')!.textContent = workflow.rel;
  renderOverviewConfigFields(workflow);
  overviewConfigModal.classList.remove('hidden');
  overviewConfigModal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => overviewConfigReaders[0]?.focus(), 0);
}

function closeOverviewConfiguration(): void {
  overviewConfigModal.classList.add('hidden');
  overviewConfigModal.setAttribute('aria-hidden', 'true');
  overviewConfigWorkflow = undefined;
  overviewConfigReaders = [];
}

function saveOverviewConfiguration(): void {
  const workflow = overviewConfigWorkflow;
  if (!workflow) return;
  const values: Record<string, unknown> = {};
  try {
    for (const reader of overviewConfigReaders) {
      let value: unknown;
      try {
        value = reader.read();
      } catch (error) {
        reader.focus();
        throw error;
      }
      if (value !== undefined) values[reader.name] = value;
    }
  } catch (error) {
    showToast(errorMessage(error), true);
    return;
  }
  if (Object.keys(values).length > 0) overviewConfigurations[workflow.rel] = values;
  else delete overviewConfigurations[workflow.rel];
  persistOverviewConfigurations();
  closeOverviewConfiguration();
  renderOverview();
  showToast(`${overviewWorkflowName(workflow)} 的配置已保存`);
}

function restoreOverviewConfigurationDefaults(): void {
  const workflow = overviewConfigWorkflow;
  if (!workflow) return;
  delete overviewConfigurations[workflow.rel];
  persistOverviewConfigurations();
  closeOverviewConfiguration();
  renderOverview();
  showToast(`${overviewWorkflowName(workflow)} 已恢复默认配置`);
}

function overviewStatusLabel(status?: OverviewItemStatus, selected = false): string {
  if (status === 'queued') return '等待执行';
  if (status === 'running') return '运行中';
  if (status === 'succeeded') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已停止';
  if (status === 'skipped') return '已跳过';
  return selected ? '已选择' : '未选择';
}

function overviewRunItem(rel: string): { rel: string; status: OverviewItemStatus } | undefined {
  return overviewRun?.items.find((item) => item.rel === rel);
}

function resetOverviewRunResult(): void {
  if (!overviewRun?.active) overviewRun = undefined;
}

function updateOverviewSelection(rel: string, checked: boolean): void {
  if (overviewRun?.active) return;
  if (checked && !overviewSelection.includes(rel)) overviewSelection.push(rel);
  if (!checked) {
    overviewSelection = overviewSelection.filter((item) => item !== rel);
    if (selectedQueueRel === rel) selectedQueueRel = '';
    const target = getDeleteTarget();
    if (target?.kind === 'queue' && target.rel === rel) setDeleteTarget(undefined);
  }
  resetOverviewRunResult();
  persistOverviewSelection();
  renderOverview();
}

/** 点选执行队列里的一行：只做选中高亮，真正的移除由 Delete 键或行内按钮触发。 */
function selectOverviewQueueRow(rel: string): void {
  selectedQueueRel = rel;
  overviewQueueElement.querySelectorAll<HTMLElement>('.overview-queue-row').forEach((row) => {
    row.classList.toggle('selected', Boolean(rel) && row.dataset.queueRel === rel);
  });
}

function moveOverviewSelection(index: number, offset: number): void {
  if (overviewRun?.active) return;
  const target = index + offset;
  if (index < 0 || target < 0 || index >= overviewSelection.length || target >= overviewSelection.length) return;
  [overviewSelection[index], overviewSelection[target]] = [overviewSelection[target], overviewSelection[index]];
  resetOverviewRunResult();
  persistOverviewSelection();
  renderOverview();
}

function openOverviewWorkflow(workflow: WorkflowDescriptor): void {
  getWorkbenchFrame()?.show('workflow');
  desktopControl('switchWorkflow', workflow.uri);
}

function renderOverviewInstances(): void {
  const options = getRuntimeInstances().map((instance) => {
    const option = document.createElement('option');
    option.value = instance.id;
    option.textContent = instanceLabel(instance);
    return option;
  });
  if (options.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '未检测到实例';
    options.push(option);
  }
  overviewInstanceSelect.replaceChildren(...options);
  overviewInstanceSelect.value = getSelectedInstance();
  overviewInstanceSelect.disabled = getRuntimeInstances().length === 0 || Boolean(overviewRun?.active);
}

/** 卡片渲染的依赖：本模块的状态与共享操作，实例化一次供每张卡片复用。 */
const overviewCardDeps: OverviewCardDeps = {
  document,
  selectedIndex: (rel) => overviewSelection.indexOf(rel),
  isRunning: () => Boolean(overviewRun?.active),
  runItem: (rel) => overviewRunItem(rel),
  workflowName: (workflow) => overviewWorkflowName(workflow),
  workflowKind: (workflow) => overviewWorkflowKind(workflow),
  workflowValidation: (workflow) => overviewWorkflowValidation(workflow),
  workflowUpdated: (workflow) => overviewWorkflowUpdated(workflow),
  configuredInputs: (workflow) => overviewConfiguredInputs(workflow),
  statusLabel: (status, selected) => overviewStatusLabel(status, selected),
  updateSelection: (rel, checked) => updateOverviewSelection(rel, checked),
  openConfiguration: (workflow) => openOverviewConfiguration(workflow),
  openWorkflow: (workflow) => openOverviewWorkflow(workflow),
};

function renderOverviewQueueRow(rel: string, index: number): HTMLElement {
  const workflow = getBootstrap()?.workflows.find((item) => item.rel === rel);
  const runItem = overviewRunItem(rel);
  const status = runItem?.status;
  const current = Boolean(overviewRun?.active && overviewRun.index === index);
  const locked = Boolean(overviewRun?.active);
  const row = document.createElement('div');
  row.className = ['overview-queue-row', current ? 'current' : '', status ?? '', rel === selectedQueueRel ? 'selected' : ''].filter(Boolean).join(' ');
  row.dataset.queueRel = rel;
  row.title = 'Delete 移出队列';
  row.addEventListener('click', (event) => {
    if ((event.target as Element).closest('button')) return;
    selectOverviewQueueRow(rel);
    setDeleteTarget({ kind: 'queue', rel });
  });
  const order = document.createElement('span');
  order.className = 'overview-queue-index';
  order.textContent = String(index + 1);
  const main = document.createElement('div');
  main.className = 'overview-queue-main';
  const name = document.createElement('strong');
  name.textContent = workflow ? overviewWorkflowName(workflow) : rel;
  const meta = document.createElement('span');
  meta.textContent = `${overviewStatusLabel(status, true)} · ${rel.replace(/^workflows\//i, '')}`;
  main.append(name, meta);
  const actions = document.createElement('div');
  actions.className = 'overview-queue-actions';
  const up = document.createElement('button');
  up.type = 'button';
  up.title = '向前移动';
  up.innerHTML = '<i data-lucide="chevron-up"></i>';
  up.disabled = locked || index === 0;
  up.addEventListener('click', () => moveOverviewSelection(index, -1));
  const down = document.createElement('button');
  down.type = 'button';
  down.title = '向后移动';
  down.innerHTML = '<i data-lucide="chevron-down"></i>';
  down.disabled = locked || index === overviewSelection.length - 1;
  down.addEventListener('click', () => moveOverviewSelection(index, 1));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.title = '移出队列';
  remove.innerHTML = '<i data-lucide="x"></i>';
  remove.disabled = locked;
  remove.addEventListener('click', () => updateOverviewSelection(rel, false));
  actions.append(up, down, remove);
  row.append(order, main, actions);
  if (workflow) row.addEventListener('dblclick', () => openOverviewWorkflow(workflow));
  return row;
}

function renderOverview(): void {
  renderOverviewInstances();
  const workflows = filteredOverviewWorkflows();
  overviewWorkflowGrid.replaceChildren(...workflows.map((workflow) => renderOverviewCard(overviewCardDeps, workflow)));
  overviewQueueElement.replaceChildren(...overviewSelection.map(renderOverviewQueueRow));
  document.querySelector<HTMLElement>('#overview-empty')!.classList.toggle('hidden', workflows.length > 0);
  document.querySelector<HTMLElement>('#overview-queue-empty')!.classList.toggle('hidden', overviewSelection.length > 0);
  document.querySelector<HTMLElement>('#overview-workflow-count')!.textContent = overviewQuery
    ? `${workflows.length} / ${getBootstrap()?.workflows.length ?? 0} 个`
    : `${workflows.length} 个`;
  document.querySelector<HTMLElement>('#overview-selected-count')!.textContent = overviewSelection.length > 0
    ? `已选择 ${overviewSelection.length} 个`
    : '未选择脚本';
  const finished = overviewRun?.items.filter((item) => item.status === 'succeeded').length ?? 0;
  document.querySelector<HTMLElement>('#overview-queue-progress')!.textContent = `${finished} / ${overviewRun?.items.length ?? overviewSelection.length}`;
  document.querySelector<HTMLElement>('#overview-queue-status')!.textContent = overviewRun?.message
    ?? (overviewSelection.length > 0 ? '可以开始运行' : '等待选择');
  const active = Boolean(overviewRun?.active);
  overviewRunButton.disabled = active || isRuntimeBusy() || overviewSelection.length === 0 || getRuntimeInstances().length === 0;
  overviewStopButton.disabled = !active && !isRuntimeBusy();
  overviewStopButton.querySelector('span')!.textContent = overviewRun?.active && overviewRun.cancelling ? '停止中…' : '停止队列';
  document.querySelector<HTMLButtonElement>('#run-button')!.disabled = isRuntimeBusy() || active;
  document.querySelector<HTMLButtonElement>('#stop-button')!.disabled = !isRuntimeBusy() && !active;
  document.querySelector<HTMLButtonElement>('#overview-select-all')!.disabled = active || sortedOverviewWorkflows().length === 0;
  document.querySelector<HTMLButtonElement>('#overview-clear')!.disabled = active || overviewSelection.length === 0;
  document.querySelector<HTMLButtonElement>('#overview-refresh')!.disabled = active;
  createIconsRef({ icons: desktopIconsRef, root: document.querySelector<HTMLElement>('#module-overview')! });
}

function skipRemainingOverviewItems(state: OverviewRunState): void {
  for (let index = state.index + 1; index < state.items.length; index += 1) {
    if (state.items[index].status === 'queued') state.items[index].status = 'skipped';
  }
}

async function requestRuntimeStop(): Promise<void> {
  try {
    await api.stopWorkflow();
  } catch (error) {
    showToast(`停止失败：${errorMessage(error)}`, true);
  }
}

async function runNextOverviewWorkflow(): Promise<void> {
  const state = overviewRun;
  if (!state?.active || state.cancelling) return;
  if (state.index >= state.items.length) {
    state.active = false;
    state.message = `执行完成，共 ${state.items.length} 个脚本`;
    renderOverview();
    showToast(state.message);
    return;
  }
  const item = state.items[state.index];
  const workflow = getBootstrap()?.workflows.find((candidate) => candidate.rel === item.rel);
  if (!workflow) {
    item.status = 'failed';
    skipRemainingOverviewItems(state);
    state.active = false;
    state.message = `脚本不存在：${item.rel}`;
    renderOverview();
    showToast(state.message, true);
    return;
  }
  item.status = 'running';
  state.message = `正在启动 ${state.index + 1}/${state.items.length}：${overviewWorkflowName(workflow)}`;
  renderOverview();
  try {
    const init = await api.getWorkflowInit(workflow.uri, state.instanceId, false);
    if (!state.active || state.cancelling) return;
    const text = workflow.uri === getCurrentUri() ? getCurrentText() : init.document.text;
    await api.runWorkflow({
      uri: workflow.uri,
      instanceId: state.instanceId,
      text,
      inputs: overviewConfiguredInputs(workflow),
    });
    if (!state.active || state.cancelling) {
      await requestRuntimeStop();
      return;
    }
    const bridge = getSharedPanelDockBridge();
    if (bridge) bridge.show('runtime');
    else getDocking()?.showPanel('runtime');
  } catch (error) {
    item.status = 'failed';
    skipRemainingOverviewItems(state);
    state.active = false;
    state.message = `${overviewWorkflowName(workflow)} 启动失败`;
    renderOverview();
    showToast(`${state.message}：${errorMessage(error)}`, true);
  }
}

function handleOverviewRuntimeState(event: RuntimeStateEvent): void {
  const state = overviewRun;
  if (!state?.active) return;
  const item = state.items[state.index];
  if (!item) return;
  const workflow = getBootstrap()?.workflows.find((candidate) => candidate.rel === item.rel);
  const name = workflow ? overviewWorkflowName(workflow) : item.rel;
  if (event.state === 'running') {
    item.status = 'running';
    state.message = state.cancelling
      ? `正在停止：${name}`
      : `正在运行 ${state.index + 1}/${state.items.length}：${name}`;
    if (state.cancelling) void requestRuntimeStop();
  } else if (event.state === 'stopping') {
    state.message = `正在停止：${name}`;
  } else if (event.state === 'succeeded') {
    item.status = 'succeeded';
    if (state.cancelling) {
      skipRemainingOverviewItems(state);
      state.active = false;
      state.cancelling = false;
      state.message = '队列已停止';
    } else {
      state.index += 1;
      if (state.index >= state.items.length) {
        state.active = false;
        state.message = `执行完成，共 ${state.items.length} 个脚本`;
        showToast(state.message);
      } else {
        state.message = `准备执行 ${state.index + 1}/${state.items.length}`;
        window.setTimeout(() => void runNextOverviewWorkflow(), 0);
      }
    }
  } else if (event.state === 'failed') {
    item.status = 'failed';
    skipRemainingOverviewItems(state);
    state.active = false;
    state.cancelling = false;
    state.message = `${name} 执行失败，队列已停止`;
    showToast(state.message, true);
  } else if (event.state === 'idle') {
    item.status = 'cancelled';
    skipRemainingOverviewItems(state);
    state.active = false;
    state.cancelling = false;
    state.message = '队列已停止';
  }
  renderOverview();
}

async function startOverviewQueue(): Promise<void> {
  if (overviewRun?.active) return;
  if (isRuntimeBusy()) {
    showToast('已有工作流正在运行，请先停止', true);
    return;
  }
  if (overviewSelection.length === 0) {
    showToast('请先勾选要执行的脚本', true);
    return;
  }
  if (!getSelectedInstance() || !getRuntimeInstances().some((instance) => instance.id === getSelectedInstance())) {
    showToast('未检测到可运行实例', true);
    return;
  }
  overviewRun = {
    items: overviewSelection.map((rel) => ({ rel, status: 'queued' })),
    index: 0,
    instanceId: getSelectedInstance(),
    active: true,
    cancelling: false,
    message: `准备执行 1/${overviewSelection.length}`,
  };
  renderOverview();
  await runNextOverviewWorkflow();
}

async function stopOverviewQueue(): Promise<void> {
  const state = overviewRun;
  if (!state?.active || state.cancelling) return;
  state.cancelling = true;
  state.message = '正在停止队列';
  renderOverview();
  await requestRuntimeStop();
  if (!isRuntimeBusy() && state.active) {
    const item = state.items[state.index];
    if (item?.status === 'running') item.status = 'cancelled';
    skipRemainingOverviewItems(state);
    state.active = false;
    state.cancelling = false;
    state.message = '队列已停止';
    renderOverview();
  }
}

async function refreshOverviewCatalog(): Promise<void> {
  const refreshButton = document.querySelector<HTMLButtonElement>('#overview-refresh')!;
  refreshButton.disabled = true;
  refreshButton.classList.add('refreshing');
  try {
    const data = await api.bootstrap();
    const current = getBootstrap();
    if (current) {
      current.workflows = data.workflows;
      current.catalog = data.catalog;
      current.instances = data.instances;
      current.defaultWorkflow = data.defaultWorkflow;
    } else {
      setBootstrap(data);
    }
    reconcileOverviewSelection();
    reconcileOverviewConfigurations();
    renderWorkflowSelect(data.workflows);
    renderInstances(data.instances, getSelectedInstance());
    renderContentBrowser();
    renderOverview();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('refreshing');
  }
}

/** 绑定概览面板的搜索、队列、运行与配置弹层事件。 */
function bindOverviewUi(): void {
  overviewSearch.addEventListener('input', () => {
    overviewQuery = overviewSearch.value;
    renderOverview();
  });
  overviewInstanceSelect.addEventListener('change', () => selectRuntimeInstance(overviewInstanceSelect.value));
  document.querySelector('#overview-select-all')!.addEventListener('click', () => {
    if (overviewRun?.active) return;
    overviewSelection = sortedOverviewWorkflows().map((workflow) => workflow.rel);
    resetOverviewRunResult();
    persistOverviewSelection();
    renderOverview();
  });
  document.querySelector('#overview-clear')!.addEventListener('click', () => {
    if (overviewRun?.active) return;
    overviewSelection = [];
    resetOverviewRunResult();
    persistOverviewSelection();
    renderOverview();
  });
  document.querySelector('#overview-refresh')!.addEventListener('click', () => void refreshOverviewCatalog());
  overviewRunButton.addEventListener('click', () => void startOverviewQueue());
  overviewStopButton.addEventListener('click', () => {
    if (overviewRun?.active) void stopOverviewQueue();
    else void requestRuntimeStop();
  });
  document.querySelector('#overview-config-close')!.addEventListener('click', closeOverviewConfiguration);
  document.querySelector('#overview-config-cancel')!.addEventListener('click', closeOverviewConfiguration);
  document.querySelector('#overview-config-defaults')!.addEventListener('click', restoreOverviewConfigurationDefaults);
  document.querySelector('#overview-config-save')!.addEventListener('click', saveOverviewConfiguration);
  overviewConfigModal.addEventListener('pointerdown', (event) => {
    if (event.target === overviewConfigModal) closeOverviewConfiguration();
  });
}


export interface OverviewDeps {
  api: OnmyojiDesktopApi;
  createIcons: typeof createIcons;
  desktopIcons: IconSet;
  showToast: (message: string, error?: boolean) => void;
  errorMessage: (error: unknown) => string;
  desktopControl: (command: string, value?: unknown) => void;
  instanceLabel: (instance: RuntimeInstance) => string;
  renderWorkflowSelect: (workflows: WorkflowDescriptor[]) => void;
  renderInstances: (instances: RuntimeInstance[], requested?: string) => void;
  renderContentBrowser: () => void;
  selectRuntimeInstance: (instanceId: string, notify?: boolean) => void;
  getBootstrap: () => BootstrapData | undefined;
  setBootstrap: (value: BootstrapData) => void;
  isRuntimeBusy: () => boolean;
  getSelectedInstance: () => string;
  getRuntimeInstances: () => RuntimeInstance[];
  getCurrentUri: () => string;
  getCurrentText: () => string;
  getWorkbenchFrame: () => WorkbenchFrameController | undefined;
  getDocking: () => DockingController | undefined;
  getSharedPanelDockBridge: () => SharedPanelDockBridge | undefined;
  getDeleteTarget: () => QueueDeleteTarget | undefined;
  setDeleteTarget: (target: QueueDeleteTarget | undefined) => void;
}

export interface Overview {
  bind(): void;
  render(): void;
  renderInstances(): void;
  reconcileSelection(loadPersisted?: boolean): void;
  reconcileConfigurations(loadPersisted?: boolean): void;
  updateSelection(rel: string, checked: boolean): void;
  isSelected(rel: string): boolean;
  isRunning(): boolean;
  selectQueueRow(rel: string): void;
  handleRuntimeState(event: RuntimeStateEvent): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  requestStop(): Promise<void>;
  refreshCatalog(): Promise<void>;
  closeConfiguration(): void;
  isConfigurationOpen(): boolean;
}

export function createOverview(deps: OverviewDeps): Overview {
  api = deps.api;
  createIconsRef = deps.createIcons;
  desktopIconsRef = deps.desktopIcons;
  showToast = deps.showToast;
  errorMessage = deps.errorMessage;
  desktopControl = deps.desktopControl;
  instanceLabel = deps.instanceLabel;
  renderWorkflowSelect = deps.renderWorkflowSelect;
  renderInstances = deps.renderInstances;
  renderContentBrowser = deps.renderContentBrowser;
  selectRuntimeInstance = deps.selectRuntimeInstance;
  getBootstrap = deps.getBootstrap;
  setBootstrap = deps.setBootstrap;
  isRuntimeBusy = deps.isRuntimeBusy;
  getSelectedInstance = deps.getSelectedInstance;
  getRuntimeInstances = deps.getRuntimeInstances;
  getCurrentUri = deps.getCurrentUri;
  getCurrentText = deps.getCurrentText;
  getWorkbenchFrame = deps.getWorkbenchFrame;
  getDocking = deps.getDocking;
  getSharedPanelDockBridge = deps.getSharedPanelDockBridge;
  getDeleteTarget = deps.getDeleteTarget;
  setDeleteTarget = deps.setDeleteTarget;
  return {
    render: renderOverview,
  renderInstances: renderOverviewInstances,
    reconcileSelection: reconcileOverviewSelection,
  reconcileConfigurations: reconcileOverviewConfigurations,
    updateSelection: updateOverviewSelection,
  isSelected: (rel: string) => overviewSelection.includes(rel),
    isRunning: () => Boolean(overviewRun?.active),
  selectQueueRow: selectOverviewQueueRow,
    handleRuntimeState: handleOverviewRuntimeState,
  start: startOverviewQueue,
  stop: stopOverviewQueue,
    requestStop: requestRuntimeStop,
  refreshCatalog: refreshOverviewCatalog,
    closeConfiguration: closeOverviewConfiguration,
    isConfigurationOpen: () => !overviewConfigModal.classList.contains('hidden'),
    bind: bindOverviewUi,
  };
}
