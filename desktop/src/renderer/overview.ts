/**
 * 脚本概览：工作流卡片、执行队列、输入配置与运行调度。
 * 状态由本模块持有，通过 createOverview 注入主窗口的实时状态读写与共享操作。
 * 注意：overview-layout.test.cjs 会按函数名切片执行，故函数保持顶层声明。
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

type OverviewItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

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
const OVERVIEW_INPUT_LABELS: Record<string, string> = {
  attack_point: '攻击点击位置',
  attack_points: '攻击目标位置列表',
  battle_roi: '战斗识别区域',
  battle_texts: '战斗页面识别文字',
  battle_timeout: '战斗超时时间',
  bounty_reject_template: '悬赏拒绝按钮模板',
  buff_auto_disabled_template: '自动加成关闭提示模板',
  cancel_button_template: '取消按钮模板',
  category: '任务类别',
  challenge_template: '挑战按钮模板',
  challenge_timeout: '挑战超时时间',
  completed_templates: '完成状态模板列表',
  completed_texts: '完成状态文字列表',
  confirm_timeout: '确认超时时间',
  continue_cancel_template: '继续邀请取消按钮模板',
  continue_prompt_template: '继续邀请提示模板',
  courtyard_template: '庭院入口模板',
  enable_realm_raid: '启用结界突破',
  entry_point: '入口点击位置',
  exit_confirm_point: '退出确认点击位置',
  exit_confirm_roi: '退出确认识别区域',
  exit_confirm_texts: '退出确认文字列表',
  experience_template: '经验结算模板',
  invite_popup_template: '邀请弹窗模板',
  invite_target_template: '邀请目标模板',
  layer: '奖励层级',
  leave_current_screen: '离开当前页面',
  map_realm_template: '结界突破地图入口模板',
  map_souls_template: '御魂地图入口模板',
  max_return_attempts: '最大返回尝试次数',
  max_settlement_clicks: '最大结算点击次数',
  member_departure_grace_seconds: '队员离开宽限时间',
  member_join_timeout: '队员加入超时时间',
  member_present_template: '队员已在场模板',
  minimum_passes: '最少通关次数',
  page_roi: '页面识别区域',
  page_texts: '页面识别文字列表',
  party_browser_template: '组队界面模板',
  party_exit_button_template: '退出队伍按钮模板',
  party_exit_confirm_template: '退出队伍确认模板',
  party_room_template: '组队房间模板',
  pass_roi: '通关状态识别区域',
  passes_available: '是否有可挑战次数',
  phase: '执行阶段',
  prepare_point: '准备按钮点击位置',
  prepare_timeout: '准备超时时间',
  ready_template: '准备按钮模板',
  realm_close_point: '结界突破关闭位置',
  realm_completed_templates: '结界完成模板列表',
  realm_completed_texts: '结界完成文字列表',
  realm_entry_point: '结界突破入口位置',
  realm_pass_roi: '结界通关识别区域',
  realm_pass_template: '结界通关模板',
  realm_popup_close_point: '结界弹窗关闭位置',
  realm_popup_roi: '结界弹窗识别区域',
  realm_target_points: '结界目标点击位置列表',
  realm_target_rois: '结界目标识别区域列表',
  realm_template: '结界突破页面模板',
  realm_threshold: '结界突破阈值',
  recovery_timeout: '页面恢复超时时间',
  resume_souls: '恢复御魂任务',
  retry_confirm_checkbox_point: '再次挑战复选框位置',
  retry_confirm_point: '再次挑战确认位置',
  retry_confirm_roi: '再次挑战确认区域',
  retry_confirm_texts: '再次挑战确认文字列表',
  retry_point: '再次挑战点击位置',
  reward_advance_delay_seconds: '奖励页前进等待时间',
  reward_advance_x: '奖励页点击横坐标',
  reward_advance_y: '奖励页点击纵坐标',
  rounds: '运行轮数',
  settlement_roi: '结算识别区域',
  settlement_template: '结算页面模板',
  settlement_timeout: '结算超时时间',
  should_enter_realm: '进入结界突破',
  souls_courtyard_template: '御魂庭院入口模板',
  souls_type_entry_point: '御魂类型入口位置',
  souls_type_template: '御魂类型页面模板',
  target_limit: '目标数量上限',
  target_points: '目标点击位置列表',
  target_rois: '目标识别区域列表',
  target_states: '目标状态列表',
  timeout_seconds: '总超时时间',
  track_realm_pass: '统计结界通关',
  treasure_close_point: '宝箱关闭位置',
  treasure_template: '宝箱页面模板',
  victory_texts: '胜利页面识别文字',
};
const OVERVIEW_INPUT_WORDS: Record<string, string> = {
  attack: '攻击', target: '目标', battle: '战斗', bounty: '悬赏', buff: '加成', auto: '自动',
  cancel: '取消', category: '类别', challenge: '挑战', completed: '完成', confirm: '确认', continue: '继续',
  courtyard: '庭院', enable: '启用', entry: '入口', exit: '退出', experience: '经验', invite: '邀请',
  layer: '层级', leave: '离开', map: '地图', max: '最大', member: '队员', minimum: '最少', page: '页面',
  party: '队伍', pass: '通关', passes: '次数', phase: '阶段', prepare: '准备', ready: '就绪', realm: '结界',
  recovery: '恢复', resume: '恢复', retry: '重试', reward: '奖励', rounds: '轮数', settlement: '结算',
  should: '是否', souls: '御魂', timeout: '超时', track: '统计', treasure: '宝箱', victory: '胜利',
  point: '点击位置', points: '位置列表', roi: '识别区域', rois: '区域列表', template: '模板', templates: '模板列表',
  text: '文字', texts: '文字列表', seconds: '秒', limit: '上限', threshold: '阈值', available: '可用',
  current: '当前', screen: '页面', return: '返回', attempts: '尝试次数', clicks: '点击次数', join: '加入',
  departure: '离开', grace: '宽限', popup: '弹窗', close: '关闭', checkbox: '复选框', advance: '前进',
  delay: '等待', x: '横坐标', y: '纵坐标', type: '类型', states: '状态列表', browser: '界面', room: '房间',
};



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
  return workflow.id || workflow.name.replace(/\.json$/i, '');
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

function renderOverviewCard(workflow: WorkflowDescriptor): HTMLElement {
  const rel = workflow.rel;
  const selectedIndex = overviewSelection.indexOf(rel);
  const selected = selectedIndex >= 0;
  const runItem = overviewRunItem(rel);
  const status = runItem?.status;
  const locked = Boolean(overviewRun?.active);
  const card = document.createElement('article');
  card.className = ['overview-card', selected ? 'selected' : '', status ?? ''].filter(Boolean).join(' ');
  card.tabIndex = locked ? -1 : 0;
  card.setAttribute('role', 'checkbox');
  card.setAttribute('aria-checked', String(selected));
  card.dataset.workflowRel = rel;

  const header = document.createElement('div');
  header.className = 'overview-card-header';
  const checkbox = document.createElement('input');
  checkbox.className = 'overview-card-check';
  checkbox.type = 'checkbox';
  checkbox.checked = selected;
  checkbox.disabled = locked;
  checkbox.setAttribute('aria-label', `选择 ${overviewWorkflowName(workflow)}`);
  checkbox.addEventListener('change', () => updateOverviewSelection(rel, checkbox.checked));
  const title = document.createElement('div');
  title.className = 'overview-card-title';
  const strong = document.createElement('strong');
  strong.textContent = overviewWorkflowName(workflow);
  strong.title = overviewWorkflowName(workflow);
  const path = document.createElement('span');
  path.textContent = rel.replace(/^workflows\//i, '');
  path.title = rel;
  title.append(strong, path);
  header.append(checkbox, title);
  if (selected) {
    const badge = document.createElement('span');
    badge.className = 'overview-order-badge';
    badge.textContent = String(selectedIndex + 1);
    badge.setAttribute('aria-label', `执行顺序 ${selectedIndex + 1}`);
    header.appendChild(badge);
  }

  const description = document.createElement('div');
  description.className = 'overview-card-description';
  description.textContent = workflow.description || '暂无说明，双击或点“编辑”查看工作流。';
  description.title = workflow.description || '';

  const metadata = document.createElement('div');
  metadata.className = 'overview-card-metadata';

  const footer = document.createElement('div');
  footer.className = 'overview-card-footer';
  const kind = document.createElement('span');
  kind.className = 'overview-card-tag';
  kind.textContent = overviewWorkflowKind(workflow);
  const inputs = document.createElement('span');
  inputs.className = 'overview-card-tag';
  inputs.textContent = `${workflow.inputs?.length ?? 0} 个输入`;
  const validation = overviewWorkflowValidation(workflow);
  const validationTag = document.createElement('span');
  validationTag.className = `overview-card-tag workflow-validation-${validation.className}`;
  validationTag.textContent = validation.label;
  validationTag.title = validation.title;
  const updated = overviewWorkflowUpdated(workflow);
  const updatedTag = updated ? document.createElement('span') : undefined;
  if (updatedTag && updated !== undefined) {
    updatedTag.className = 'overview-card-tag workflow-updated';
    updatedTag.textContent = updated;
    updatedTag.title = `文件更新时间：${new Date(workflow.updatedAt!).toLocaleString('zh-CN')}`;
  }
  const configure = document.createElement('button');
  const configured = Boolean(overviewConfiguredInputs(workflow));
  configure.className = `overview-card-config${configured ? ' configured' : ''}`;
  configure.type = 'button';
  configure.textContent = configured ? '已配置' : '配置';
  configure.disabled = locked;
  configure.addEventListener('click', (event) => {
    event.stopPropagation();
    openOverviewConfiguration(workflow);
  });
  const open = document.createElement('button');
  open.className = 'overview-card-open';
  open.type = 'button';
  open.textContent = '编辑';
  open.addEventListener('click', (event) => {
    event.stopPropagation();
    openOverviewWorkflow(workflow);
  });
  const state = document.createElement('span');
  state.className = 'overview-card-status';
  state.textContent = overviewStatusLabel(status, selected);
  metadata.append(kind, inputs, validationTag);
  if (updatedTag) metadata.appendChild(updatedTag);
  const actions = document.createElement('div');
  actions.className = 'overview-card-actions';
  actions.append(configure, open);
  footer.append(state, actions);
  card.append(header, description, metadata, footer);

  card.addEventListener('click', (event) => {
    if (locked || (event.target as Element).closest('button, input')) return;
    updateOverviewSelection(rel, !selected);
  });
  card.addEventListener('dblclick', (event) => {
    if ((event.target as Element).closest('button, input')) return;
    openOverviewWorkflow(workflow);
  });
  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (locked || event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    updateOverviewSelection(rel, !selected);
  });
  return card;
}

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
  overviewWorkflowGrid.replaceChildren(...workflows.map(renderOverviewCard));
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

function overviewInputDisplayName(name: string): string {
  const exact = OVERVIEW_INPUT_LABELS[name];
  if (exact) return exact;
  const words = name.split('_').map((word) => OVERVIEW_INPUT_WORDS[word] ?? word);
  const translated = words.join('');
  return translated === name.replaceAll('_', '') ? name : translated;
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

export { overviewInputDisplayName };
