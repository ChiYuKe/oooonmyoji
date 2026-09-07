import {
  ArrowLeft,
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  CircleDot,
  CirclePlus,
  Columns3,
  Copy,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FileJson2,
  Flag,
  Folder,
  FolderOpen,
  FoldVertical,
  GitBranch,
  GitFork,
  Hash,
  Image,
  ImageDown,
  LayoutGrid,
  Link2,
  List,
  ListTree,
  Maximize,
  Minus,
  MonitorUp,
  Network,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Route,
  Save,
  Search,
  Settings2,
  Sigma,
  SlidersHorizontal,
  Scan,
  Square,
  Split,
  ToggleLeft,
  Type,
  UnfoldVertical,
  WandSparkles,
  Waypoints,
  Workflow,
  X,
  createIcons,
  createElement,
} from 'lucide';
import 'dockview/dist/styles/dockview.css';
import type {
  BootstrapData,
  AssetImage,
  ReferenceGraph,
  ReferenceItem,
  ReferenceNode,
  ParameterInfo,
  RuntimeInstance,
  RuntimeOutputEvent,
  RuntimeStateEvent,
  WorkflowDescriptor,
  WorkflowEditorInit,
} from '../shared/contracts';
import {
  createDockingWorkspace,
  createWorkbenchFrame,
  connectSharedPanelDocking,
  type DockPanelId,
  type DockingController,
  type SharedDockPanelId,
  type SharedPanelDockBridge,
  type WorkbenchFrameController,
  type WorkbenchPanelId,
} from './docking';
import './styles.css';

interface SidebarNode {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: string[];
}

interface SidebarVariable {
  name: string;
  type: string;
  scope: 'inputs' | 'variables';
}

interface EditorEnvelope {
  source?: string;
  frameId?: string;
  message?: Record<string, unknown>;
  state?: { dirty?: boolean };
}

interface RuntimeLogDescriptor {
  workflow: string;
  instance: string;
  startedAt: number;
  status: string;
  sources?: RuntimeStateEvent['sources'];
}

interface RuntimeLogEnvelope {
  source?: string;
  message?: { type?: string };
}

interface InspectorSelection {
  kind: 'none' | 'node' | 'run' | 'edge' | 'variables' | 'workflow';
  nodeId?: string;
  index?: number;
  parent?: string;
  child?: string;
  name?: string;
  scope?: 'inputs' | 'variables';
}

type ContentBrowserView = 'grid' | 'list';
type ContentBrowserItemKind = 'folder' | 'workflow' | 'asset';
type OverviewItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

interface ContentBrowserItem {
  kind: ContentBrowserItemKind;
  path: string;
  name: string;
  workflow?: WorkflowDescriptor;
  asset?: AssetImage;
}

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

const api = window.onmyoji;
const desktopIcons = {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDot,
  CirclePlus,
  Columns3,
  Copy,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  FileJson2,
  Flag,
  Folder,
  FolderOpen,
  FoldVertical,
  GitBranch,
  GitFork,
  Image,
  ImageDown,
  LayoutGrid,
  Link2,
  List,
  ListTree,
  Maximize,
  Minus,
  MonitorUp,
  Network,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Route,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Split,
  UnfoldVertical,
  WandSparkles,
  Waypoints,
  Workflow,
  X,
};

/** 将浏览器原生 title 提示迁移为工作台统一的自定义 tooltip。 */
function installCustomTooltips(): void {
  const htmlNamespace = 'http://www.w3.org/1999/xhtml';
  const scan = (): void => {
    document.querySelectorAll<HTMLElement>('[title]').forEach((element) => {
      if (element.namespaceURI !== htmlNamespace || element.tagName === 'IFRAME') return;
      const label = element.getAttribute('title')?.trim();
      if (!label) return;
      element.dataset.tooltip = label;
      element.removeAttribute('title');
      if (!element.getAttribute('aria-label') && /^(BUTTON|INPUT|SELECT)$/.test(element.tagName)) {
        element.setAttribute('aria-label', label.replace(/\s+/g, ' '));
      }
    });
  };

  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { attributes: true, attributeFilter: ['title'], childList: true, subtree: true });
}

const editorFrame = document.querySelector<HTMLIFrameElement>('#editor-frame')!;
const detailsFrame = document.querySelector<HTMLIFrameElement>('#details-frame')!;
const instancePicker = document.querySelector<HTMLDivElement>('#instance-picker')!;
const instanceSelect = document.querySelector<HTMLButtonElement>('#instance-select')!;
const instanceSelectLabel = document.querySelector<HTMLElement>('#instance-select-label')!;
const instanceMenu = document.querySelector<HTMLDivElement>('#instance-menu')!;
const structureView = document.querySelector<HTMLElement>('#structure-view')!;
const variablesView = document.querySelector<HTMLElement>('#variables-view')!;
const loadingMask = document.querySelector<HTMLElement>('#loading-mask')!;
const runtimeLogFrame = document.querySelector<HTMLIFrameElement>('#runtime-log-frame')!;
const contentBrowserTree = document.querySelector<HTMLElement>('#content-browser-tree')!;
const contentBrowserItems = document.querySelector<HTMLElement>('#content-browser-items')!;
const contentBrowserBreadcrumbs = document.querySelector<HTMLElement>('#content-browser-breadcrumbs')!;
const contentBrowserSearch = document.querySelector<HTMLInputElement>('#content-browser-search')!;
const settingsContentView = document.querySelector<HTMLSelectElement>('#settings-content-view')!;
const settingsAutoRefresh = document.querySelector<HTMLInputElement>('#settings-auto-refresh')!;
const settingsDefaultWorkflow = document.querySelector<HTMLInputElement>('#settings-default-workflow')!;
const settingsDebugEnabled = document.querySelector<HTMLInputElement>('#settings-debug-enabled')!;
const settingsDebugAnnotate = document.querySelector<HTMLInputElement>('#settings-debug-annotate')!;
const overviewSearch = document.querySelector<HTMLInputElement>('#overview-search')!;
const overviewInstanceSelect = document.querySelector<HTMLSelectElement>('#overview-instance-select')!;
const overviewWorkflowGrid = document.querySelector<HTMLElement>('#overview-workflow-grid')!;
const overviewQueueElement = document.querySelector<HTMLElement>('#overview-queue')!;
const overviewRunButton = document.querySelector<HTMLButtonElement>('#overview-run')!;
const overviewStopButton = document.querySelector<HTMLButtonElement>('#overview-stop')!;
const overviewConfigModal = document.querySelector<HTMLElement>('#overview-config-modal')!;
const overviewConfigFields = document.querySelector<HTMLElement>('#overview-config-fields')!;

let bootstrap: BootstrapData | undefined;
let currentUri = '';
let currentText = '';
let selectedInstance = '';
let runtimeInstances: RuntimeInstance[] = [];
let backStack: string[] = [];
let editorReady = false;
let currentEditorInit: WorkflowEditorInit | undefined;
let dirty = false;
let sidebarNodes: SidebarNode[] = [];
let sidebarVariables: SidebarVariable[] = [];
let selectedNode = '';
let selectedVariable = '';
let selectedVariableScope: 'inputs' | 'variables' = 'inputs';
/** 结构树手动收起的分支节点 ID：重渲染（如切换选中节点）时保持折叠状态。 */
let collapsedTreeNodes = new Set<string>();
let toastTimer: number | undefined;
let instanceRefreshTimer: number | undefined;
let docking: DockingController | undefined;
let workbenchFrame: WorkbenchFrameController | undefined;
let sharedPanelDockBridge: SharedPanelDockBridge | undefined;
let contentAssets: AssetImage[] = [];
let contentBrowserFolder = '';
let contentBrowserQuery = '';
let contentBrowserView: ContentBrowserView = 'grid';
let selectedContentPath = '';
let runtimeLogReady = false;
let runtimeLogDescriptor: RuntimeLogDescriptor | undefined;
let runtimeLogEvents: Record<string, unknown>[] = [];
let runtimeEngineOutput = '';
let runtimeProcessResult: { code: number | null; signal: string | null; stopped: boolean } | undefined;
let autoRefreshInstances = true;
let loadDefaultWorkflowOnStart = true;
let moreMenu: { menu: HTMLElement; dismiss: (event: Event) => void; keyHandler: (event: KeyboardEvent) => void } | undefined;
let overviewSelection: string[] = [];
let overviewQuery = '';
let overviewRun: OverviewRunState | undefined;
let runtimeBusy = false;
let overviewConfigurations: Record<string, Record<string, unknown>> = {};
let overviewConfigWorkflow: WorkflowDescriptor | undefined;
let overviewConfigReaders: OverviewConfigReader[] = [];
let visionTestOpening = false;

const OVERVIEW_SELECTION_KEY = 'onmyoji-studio.overview-selection.v1';
const OVERVIEW_CONFIG_KEY = 'onmyoji-studio.overview-inputs.v1';
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

function overviewInputDisplayName(name: string): string {
  const exact = OVERVIEW_INPUT_LABELS[name];
  if (exact) return exact;
  const words = name.split('_').map((word) => OVERVIEW_INPUT_WORDS[word] ?? word);
  const translated = words.join('');
  return translated === name.replaceAll('_', '') ? name : translated;
}

function postToEditor(payload: Record<string, unknown>): void {
  postToFrame(editorFrame, payload);
}

function postToFrame(frame: HTMLIFrameElement, payload: Record<string, unknown>): void {
  frame.contentWindow?.postMessage({ source: 'desktop-shell', payload }, '*');
}

function postToEditors(payload: Record<string, unknown>): void {
  postToFrame(editorFrame, payload);
  postToFrame(detailsFrame, payload);
}

function postToRuntimeLog(payload: Record<string, unknown>): void {
  if (runtimeLogReady) runtimeLogFrame.contentWindow?.postMessage(payload, '*');
}

function sendRuntimeLogInit(): void {
  postToRuntimeLog({
    type: 'init',
    descriptor: runtimeLogDescriptor ?? null,
    events: runtimeLogEvents,
    engineOutput: runtimeEngineOutput,
    processResult: runtimeProcessResult,
  });
}

function clearRuntimeLog(): void {
  runtimeLogDescriptor = undefined;
  runtimeLogEvents = [];
  runtimeEngineOutput = '';
  runtimeProcessResult = undefined;
  postToRuntimeLog({ type: 'cleared' });
}

function markRuntimeLogReady(): void {
  runtimeLogReady = true;
  sendRuntimeLogInit();
}

runtimeLogFrame.addEventListener('load', markRuntimeLogReady);
if (runtimeLogFrame.contentDocument?.readyState === 'complete') window.queueMicrotask(markRuntimeLogReady);

function editorCommand(command: string, value?: unknown): void {
  postToEditor({ type: 'editorCommand', command, value });
}

function desktopControl(command: string, value?: unknown): void {
  postToEditor({ type: 'desktopControl', command, value });
}

function setStatus(message: string): void {
  document.querySelector<HTMLElement>('#status-message')!.textContent = message;
}

function showToast(message: string, error = false): void {
  const toast = document.querySelector<HTMLElement>('#app-toast')!;
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.remove('hidden');
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 3600);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setDirty(value: boolean): void {
  dirty = value;
}

function workflowReference(file: WorkflowDescriptor): string {
  return file.rel.replace(/\\/g, '/').replace(/^workflows\//i, '');
}

function displayFileUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    return decodeURIComponent(parsed.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1');
  } catch {
    return uri;
  }
}

function workflowTrail(): Array<{ uri: string; name: string }> {
  const uris = [...backStack, currentUri].filter(Boolean);
  return uris.map((uri) => {
    const descriptor = bootstrap?.workflows.find((item) => item.uri === uri);
    const file = displayFileUri(uri).split(/[\\/]/).pop() || '';
    return { uri, name: descriptor?.id || descriptor?.name?.replace(/\.json$/i, '') || file.replace(/\.json$/i, '') || '工作流' };
  });
}

function resolveWorkflow(reference: string): WorkflowDescriptor | undefined {
  if (!bootstrap) return undefined;
  const normalized = reference.trim().replace(/\\/g, '/').replace(/^workflows\//i, '');
  const withExtension = normalized.toLowerCase().endsWith('.json') ? normalized : `${normalized}.json`;
  return bootstrap.workflows.find((file) => {
    const candidate = workflowReference(file);
    return file.id === normalized || candidate === normalized || candidate === withExtension
      || candidate.endsWith(`/${normalized}`) || candidate.endsWith(`/${withExtension}`);
  });
}

function renderWorkflowSelect(workflows: WorkflowDescriptor[]): void {
  document.querySelector<HTMLElement>('#workflow-count')!.textContent = `${workflows.length} 个工作流`;
}

function overviewWorkflowName(workflow: WorkflowDescriptor): string {
  return workflow.id || workflow.name.replace(/\.json$/i, '');
}

function overviewWorkflowKind(workflow: WorkflowDescriptor): string {
  const rel = workflow.rel.replace(/\\/g, '/').toLowerCase();
  if (rel.includes('/entrypoints/')) return '入口脚本';
  if (rel.includes('/examples/')) return '示例';
  if (rel.includes('/shared/')) return '共享流程';
  return '工作流';
}

function overviewWorkflowRank(workflow: WorkflowDescriptor): number {
  const kind = overviewWorkflowKind(workflow);
  return kind === '入口脚本' ? 0 : kind === '工作流' ? 1 : kind === '共享流程' ? 2 : 3;
}

function sortedOverviewWorkflows(): WorkflowDescriptor[] {
  return [...(bootstrap?.workflows ?? [])].sort((left, right) => (
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
  const available = new Set((bootstrap?.workflows ?? []).map((workflow) => workflow.rel));
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
  for (const workflow of bootstrap?.workflows ?? []) {
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
    displayName.textContent = overviewInputDisplayName(name);
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
  createIcons({ icons: desktopIcons, root: overviewConfigModal });
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
  if (!checked) overviewSelection = overviewSelection.filter((item) => item !== rel);
  resetOverviewRunResult();
  persistOverviewSelection();
  renderOverview();
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
  workbenchFrame?.show('workflow');
  desktopControl('switchWorkflow', workflow.uri);
}

function renderOverviewInstances(): void {
  const options = runtimeInstances.map((instance) => {
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
  overviewInstanceSelect.value = selectedInstance;
  overviewInstanceSelect.disabled = runtimeInstances.length === 0 || Boolean(overviewRun?.active);
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

  const footer = document.createElement('div');
  footer.className = 'overview-card-footer';
  const kind = document.createElement('span');
  kind.className = 'overview-card-tag';
  kind.textContent = overviewWorkflowKind(workflow);
  const inputs = document.createElement('span');
  inputs.className = 'overview-card-tag';
  inputs.textContent = `${workflow.inputs?.length ?? 0} 个输入`;
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
  footer.append(kind, inputs, configure, open, state);
  card.append(header, description, footer);

  card.addEventListener('click', (event) => {
    if (locked || (event.target as Element).closest('button, input')) return;
    updateOverviewSelection(rel, !selected);
  });
  card.addEventListener('dblclick', (event) => {
    if ((event.target as Element).closest('button, input')) return;
    openOverviewWorkflow(workflow);
  });
  card.addEventListener('keydown', (event) => {
    if (locked || event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    updateOverviewSelection(rel, !selected);
  });
  return card;
}

function renderOverviewQueueRow(rel: string, index: number): HTMLElement {
  const workflow = bootstrap?.workflows.find((item) => item.rel === rel);
  const runItem = overviewRunItem(rel);
  const status = runItem?.status;
  const current = Boolean(overviewRun?.active && overviewRun.index === index);
  const locked = Boolean(overviewRun?.active);
  const row = document.createElement('div');
  row.className = ['overview-queue-row', current ? 'current' : '', status ?? ''].filter(Boolean).join(' ');
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
    ? `${workflows.length} / ${bootstrap?.workflows.length ?? 0} 个`
    : `${workflows.length} 个`;
  document.querySelector<HTMLElement>('#overview-selected-count')!.textContent = overviewSelection.length > 0
    ? `已选择 ${overviewSelection.length} 个`
    : '未选择脚本';
  const finished = overviewRun?.items.filter((item) => item.status === 'succeeded').length ?? 0;
  document.querySelector<HTMLElement>('#overview-queue-progress')!.textContent = `${finished} / ${overviewRun?.items.length ?? overviewSelection.length}`;
  document.querySelector<HTMLElement>('#overview-queue-status')!.textContent = overviewRun?.message
    ?? (overviewSelection.length > 0 ? '可以开始运行' : '等待选择');
  const active = Boolean(overviewRun?.active);
  overviewRunButton.disabled = active || runtimeBusy || overviewSelection.length === 0 || runtimeInstances.length === 0;
  overviewStopButton.disabled = !active && !runtimeBusy;
  overviewStopButton.querySelector('span')!.textContent = overviewRun?.active && overviewRun.cancelling ? '停止中…' : '停止队列';
  document.querySelector<HTMLButtonElement>('#run-button')!.disabled = runtimeBusy || active;
  document.querySelector<HTMLButtonElement>('#stop-button')!.disabled = !runtimeBusy && !active;
  document.querySelector<HTMLButtonElement>('#overview-select-all')!.disabled = active || sortedOverviewWorkflows().length === 0;
  document.querySelector<HTMLButtonElement>('#overview-clear')!.disabled = active || overviewSelection.length === 0;
  document.querySelector<HTMLButtonElement>('#overview-refresh')!.disabled = active;
  createIcons({ icons: desktopIcons, root: document.querySelector<HTMLElement>('#module-overview')! });
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
  const workflow = bootstrap?.workflows.find((candidate) => candidate.rel === item.rel);
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
    const text = workflow.uri === currentUri ? currentText : init.document.text;
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
    if (workflow.uri === currentUri) setDirty(false);
    if (sharedPanelDockBridge) sharedPanelDockBridge.show('runtime');
    else docking?.showPanel('runtime');
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
  const workflow = bootstrap?.workflows.find((candidate) => candidate.rel === item.rel);
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
  if (runtimeBusy) {
    showToast('已有工作流正在运行，请先停止', true);
    return;
  }
  if (overviewSelection.length === 0) {
    showToast('请先勾选要执行的脚本', true);
    return;
  }
  if (!selectedInstance || !runtimeInstances.some((instance) => instance.id === selectedInstance)) {
    showToast('未检测到可运行实例', true);
    return;
  }
  overviewRun = {
    items: overviewSelection.map((rel) => ({ rel, status: 'queued' })),
    index: 0,
    instanceId: selectedInstance,
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
  if (!runtimeBusy && state.active) {
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
    if (bootstrap) {
      bootstrap.workflows = data.workflows;
      bootstrap.catalog = data.catalog;
      bootstrap.instances = data.instances;
    } else {
      bootstrap = data;
    }
    reconcileOverviewSelection();
    reconcileOverviewConfigurations();
    renderWorkflowSelect(data.workflows);
    renderInstances(data.instances, selectedInstance);
    renderContentBrowser();
    renderOverview();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('refreshing');
  }
}

function instanceLabel(instance: RuntimeInstance): string {
  return instance.displayName
    || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
}

function closeInstancePicker(restoreFocus = false): void {
  if (instanceMenu.hidden) return;
  instanceMenu.hidden = true;
  instancePicker.classList.remove('open');
  instanceSelect.setAttribute('aria-expanded', 'false');
  if (restoreFocus) instanceSelect.focus();
}

function positionInstanceMenu(): void {
  const triggerRect = instanceSelect.getBoundingClientRect();
  const menuWidth = Math.max(triggerRect.width, instanceMenu.offsetWidth, 92);
  const left = Math.min(
    Math.max(8, triggerRect.left),
    Math.max(8, window.innerWidth - menuWidth - 8),
  );
  instanceMenu.style.left = `${Math.round(left)}px`;
  instanceMenu.style.top = `${Math.round(triggerRect.bottom + 4)}px`;
  instanceMenu.style.minWidth = `${Math.round(triggerRect.width)}px`;
}

function updateInstancePicker(): void {
  const selected = runtimeInstances.find((instance) => instance.id === selectedInstance);
  instanceSelectLabel.textContent = selected ? instanceLabel(selected) : '未检测到运行实例';
  instanceSelect.disabled = runtimeInstances.length === 0;
  instanceSelect.setAttribute('aria-label', selected ? `运行实例：${instanceLabel(selected)}` : '运行实例');
  instanceMenu.querySelectorAll<HTMLButtonElement>('[data-instance-id]').forEach((option) => {
    const isSelected = option.dataset.instanceId === selectedInstance;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-selected', String(isSelected));
  });
}

function selectRuntimeInstance(instanceId: string, notify = true): void {
  if (!runtimeInstances.some((instance) => instance.id === instanceId)) return;
  selectedInstance = instanceId;
  updateInstancePicker();
  renderOverviewInstances();
  closeInstancePicker();
  if (notify) desktopControl('selectInstance', selectedInstance);
}

function toggleInstancePicker(): void {
  if (instanceSelect.disabled) return;
  if (!instanceMenu.hidden) {
    closeInstancePicker();
    return;
  }
  // Keep the popup outside the toolbar's layout and stacking context. Dockview
  // reparents the workbench module while tabs change; a menu inside that module
  // can otherwise invalidate the toolbar paint layer when it receives focus.
  if (instanceMenu.parentElement !== document.body) document.body.appendChild(instanceMenu);
  instanceMenu.hidden = false;
  instancePicker.classList.add('open');
  instanceSelect.setAttribute('aria-expanded', 'true');
  positionInstanceMenu();
  instanceMenu.querySelector<HTMLButtonElement>(`[data-instance-id="${CSS.escape(selectedInstance)}"]`)?.focus();
}

function renderInstances(instances: RuntimeInstance[], requested = selectedInstance): void {
  runtimeInstances = instances;
  const options = instances.map((instance) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'instance-option';
    option.dataset.instanceId = instance.id;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    const label = document.createElement('span');
    label.className = 'instance-option-label';
    label.textContent = instanceLabel(instance);
    const check = document.createElement('span');
    check.className = 'instance-option-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    option.append(label, check);
    option.addEventListener('click', () => selectRuntimeInstance(instance.id));
    return option;
  });
  const ids = new Set(instances.map((instance) => instance.id));
  selectedInstance = ids.has(requested) ? requested : instances[0]?.id ?? '';
  instanceMenu.replaceChildren(...options);
  closeInstancePicker();
  updateInstancePicker();
  renderOverviewInstances();
  document.querySelector<HTMLElement>('#instance-count')!.textContent = instances.length > 0
    ? `${instances.length} 个实例`
    : '未检测到实例';
}

function contentParent(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function contentName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function contentFolders(): string[] {
  const folders = new Set<string>(['']);
  const paths = [
    ...(bootstrap?.workflows.map((workflow) => workflow.rel.replace(/\\/g, '/')) ?? []),
    ...contentAssets.map((asset) => asset.path.replace(/\\/g, '/')),
  ];
  for (const itemPath of paths) {
    const parts = itemPath.split('/');
    parts.pop();
    let folder = '';
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      folders.add(folder);
    }
  }
  return [...folders];
}

function contentBrowserEntries(): ContentBrowserItem[] {
  const query = contentBrowserQuery.trim().toLocaleLowerCase('zh-CN');
  const workflows: ContentBrowserItem[] = (bootstrap?.workflows ?? []).map((workflow) => ({
    kind: 'workflow',
    path: workflow.rel.replace(/\\/g, '/'),
    name: workflow.name,
    workflow,
  }));
  const assets: ContentBrowserItem[] = contentAssets.map((asset) => ({
    kind: 'asset',
    path: asset.path.replace(/\\/g, '/'),
    name: contentName(asset.path),
    asset,
  }));
  if (query) {
    return [...workflows, ...assets].filter((item) => `${item.name} ${item.path}`.toLocaleLowerCase('zh-CN').includes(query));
  }
  const folders: ContentBrowserItem[] = contentFolders()
    .filter((folder) => folder && contentParent(folder) === contentBrowserFolder)
    .map((folder) => ({ kind: 'folder', path: folder, name: contentName(folder) }));
  return [
    ...folders,
    ...workflows.filter((item) => contentParent(item.path) === contentBrowserFolder),
    ...assets.filter((item) => contentParent(item.path) === contentBrowserFolder),
  ].sort((left, right) => {
    const order: Record<ContentBrowserItemKind, number> = { folder: 0, workflow: 1, asset: 2 };
    return order[left.kind] - order[right.kind] || left.name.localeCompare(right.name, 'zh-CN');
  });
}

function navigateContentBrowser(folder: string): void {
  contentBrowserFolder = folder;
  contentBrowserQuery = '';
  contentBrowserSearch.value = '';
  selectedContentPath = '';
  renderContentBrowser();
}

function selectContentItem(button: HTMLButtonElement, item: ContentBrowserItem): void {
  selectedContentPath = item.path;
  contentBrowserItems.querySelectorAll('.content-item.selected').forEach((element) => element.classList.remove('selected'));
  button.classList.add('selected');
  document.querySelector<HTMLElement>('#content-browser-selection')!.textContent = item.path;
}

function createContentItem(item: ContentBrowserItem): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `content-item ${item.kind}${item.workflow?.uri === currentUri ? ' current' : ''}${item.path === selectedContentPath ? ' selected' : ''}`;
  button.type = 'button';
  button.title = item.path;
  button.setAttribute('role', 'listitem');

  const preview = document.createElement('span');
  preview.className = 'content-item-preview';
  if (item.kind === 'asset' && item.asset) {
    const image = document.createElement('img');
    image.src = item.asset.uri;
    image.alt = '';
    image.loading = 'lazy';
    preview.appendChild(image);
  } else {
    preview.innerHTML = `<i data-lucide="${item.kind === 'folder' ? 'folder' : 'file-json-2'}"></i>`;
  }
  const label = document.createElement('span');
  label.className = 'content-item-name';
  label.textContent = item.name;
  const path = document.createElement('span');
  path.className = 'content-item-path';
  path.textContent = contentBrowserQuery ? item.path : item.kind === 'folder' ? '文件夹' : item.kind === 'workflow' ? '工作流' : '模板图片';
  button.append(preview, label, path);
  button.addEventListener('click', () => selectContentItem(button, item));
  button.addEventListener('dblclick', () => {
    if (item.kind === 'folder') navigateContentBrowser(item.path);
    else if (item.workflow) desktopControl('switchWorkflow', item.workflow.uri);
    else if (item.asset) void api.openContentItem(item.asset.path).catch((error) => showToast(errorMessage(error), true));
  });
  if (item.kind !== 'folder') {
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      selectContentItem(button, item);
      showContentContextMenu(event, item, button);
    });
  }
  return button;
}

function renderContentBrowserTree(): void {
  contentBrowserTree.replaceChildren();
  const folders = contentFolders();
  const appendFolder = (folder: string, depth: number): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `content-folder-row${folder === contentBrowserFolder ? ' selected' : ''}`;
    button.style.setProperty('--depth', String(depth));
    button.innerHTML = `<i data-lucide="${folder === contentBrowserFolder ? 'folder-open' : 'folder'}"></i><span></span>`;
    button.querySelector('span')!.textContent = folder ? contentName(folder) : '项目内容';
    button.title = folder || '项目内容';
    button.addEventListener('click', () => navigateContentBrowser(folder));
    contentBrowserTree.appendChild(button);
    for (const child of folders.filter((candidate) => candidate && contentParent(candidate) === folder).sort((left, right) => left.localeCompare(right, 'zh-CN'))) {
      appendFolder(child, depth + 1);
    }
  };
  appendFolder('', 0);
}

function renderContentBrowserBreadcrumbs(): void {
  contentBrowserBreadcrumbs.replaceChildren();
  const folders = contentBrowserFolder ? contentBrowserFolder.split('/') : [];
  const paths = ['', ...folders.map((_, index) => folders.slice(0, index + 1).join('/'))];
  for (const path of paths) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'content-crumb';
    button.textContent = path ? contentName(path) : '项目内容';
    button.title = path || '项目内容';
    button.addEventListener('click', () => navigateContentBrowser(path));
    contentBrowserBreadcrumbs.appendChild(button);
  }
}

function renderContentBrowser(): void {
  const folders = new Set(contentFolders());
  if (!folders.has(contentBrowserFolder)) contentBrowserFolder = '';
  renderContentBrowserTree();
  renderContentBrowserBreadcrumbs();
  const entries = contentBrowserEntries();
  contentBrowserItems.className = `content-browser-items ${contentBrowserView}`;
  contentBrowserItems.replaceChildren(...entries.map(createContentItem));
  document.querySelector<HTMLElement>('#content-browser-empty')!.classList.toggle('hidden', entries.length > 0);
  document.querySelector<HTMLElement>('#content-browser-summary')!.textContent = `${entries.length} 项`;
  document.querySelector<HTMLElement>('#content-browser-selection')!.textContent = selectedContentPath;
  document.querySelector<HTMLButtonElement>('#content-browser-up')!.disabled = contentBrowserFolder === '';
  document.querySelectorAll<HTMLButtonElement>('[data-content-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.contentView === contentBrowserView);
  });
  createIcons({ icons: desktopIcons, root: document.querySelector<HTMLElement>('#module-content-browser')! });
}

async function refreshContentBrowser(): Promise<void> {
  const refreshButton = document.querySelector<HTMLButtonElement>('#content-browser-refresh')!;
  refreshButton.disabled = true;
  refreshButton.classList.add('refreshing');
  try {
    const [assets, data] = await Promise.all([api.listAssets(), api.bootstrap()]);
    contentAssets = assets;
    if (bootstrap) {
      bootstrap.workflows = data.workflows;
      bootstrap.catalog = data.catalog;
    } else {
      bootstrap = data;
    }
    reconcileOverviewSelection();
    reconcileOverviewConfigurations();
    renderWorkflowSelect(data.workflows);
    renderContentBrowser();
    renderOverview();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('refreshing');
  }
}

/* ---------- 内容浏览器右键菜单 + 引用查看器 ---------- */

let contentContextMenu: { owner: Document; menu: HTMLElement; dismiss: (event: Event) => void; keyHandler: (event: KeyboardEvent) => void } | undefined;
let referenceViewerDocument: Document | undefined;
let referenceViewerPanel: HTMLElement | undefined;
let referenceViewerBody: HTMLElement | undefined;
let referenceViewerTrailEl: HTMLElement | undefined;
let referenceViewerKeyHandler: ((event: KeyboardEvent) => void) | undefined;
let referenceTrail: string[] = [];
let referenceViewerToken = 0;
let referenceViewerGraph: ReferenceGraph | undefined;
let referenceViewerCanvas: HTMLElement | undefined;
let referenceViewerZoom = 1;
let referenceViewerQuery = '';
let referenceViewerPan = { x: 0, y: 0 };
let referenceViewerResizeObserver: ResizeObserver | undefined;
let referenceViewerLocationDisposable: { dispose(): void } | undefined;

/** 把绝对路径转成项目相对路径（正斜杠）；不在项目内时原样返回。 */
function relativeToProject(absolutePath: string): string {
  const root = bootstrap?.projectRoot ?? '';
  const absolute = absolutePath.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedRoot) return absolute;
  if (absolute.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return absolute.slice(normalizedRoot.length + 1);
  }
  if (absolute.toLowerCase() === normalizedRoot.toLowerCase()) return '';
  return absolute;
}

function closeContentContextMenu(): void {
  if (!contentContextMenu) return;
  const { owner, menu, dismiss, keyHandler } = contentContextMenu;
  owner.removeEventListener('pointerdown', dismiss, true);
  owner.removeEventListener('keydown', keyHandler, true);
  menu.remove();
  contentContextMenu = undefined;
}

function showContentContextMenu(event: MouseEvent, item: ContentBrowserItem, button: HTMLButtonElement): void {
  closeContentContextMenu();
  const doc = button.ownerDocument;
  const menu = doc.createElement('div');
  menu.className = 'content-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '内容操作');

  const addEntry = (label: string, icon: IconComponent, action: () => void): void => {
    const entry = doc.createElement('button');
    entry.type = 'button';
    entry.setAttribute('role', 'menuitem');
    entry.appendChild(createElement(icon, { width: '13', height: '13', 'aria-hidden': 'true' }));
    entry.appendChild(doc.createTextNode(label));
    entry.addEventListener('click', () => {
      closeContentContextMenu();
      action();
    });
    menu.appendChild(entry);
  };

  addEntry('引用查看器', Network, () => openReferenceViewer(item.path, doc));
  const separator = doc.createElement('div');
  separator.className = 'content-context-separator';
  menu.appendChild(separator);
  if (item.workflow) {
    addEntry('在编辑器中打开', FileJson2, () => desktopControl('switchWorkflow', item.workflow!.uri));
  } else if (item.asset) {
    addEntry('打开图片', Image, () => void api.openContentItem(item.asset!.path).catch((error) => showToast(errorMessage(error), true)));
  }

  doc.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const viewportWidth = doc.documentElement.clientWidth;
  const viewportHeight = doc.documentElement.clientHeight;
  menu.style.left = `${Math.max(4, Math.min(event.clientX, viewportWidth - rect.width - 6))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, viewportHeight - rect.height - 6))}px`;

  const dismiss = (pointerEvent: Event): void => {
    if (menu.contains(pointerEvent.target as Node)) return;
    closeContentContextMenu();
  };
  const keyHandler = (keyEvent: KeyboardEvent): void => {
    if (keyEvent.key === 'Escape') closeContentContextMenu();
  };
  doc.addEventListener('pointerdown', dismiss, true);
  doc.addEventListener('keydown', keyHandler, true);
  contentContextMenu = { owner: doc, menu, dismiss, keyHandler };
}

function closeReferenceViewer(): void {
  referenceViewerToken += 1;
  if (referenceViewerPanel && referenceViewerKeyHandler) {
    referenceViewerPanel.removeEventListener('keydown', referenceViewerKeyHandler, true);
  }
  workbenchFrame?.dockviewApi.getPanel('referenceViewer')?.api.close();
  referenceViewerPanel?.remove();
  referenceViewerResizeObserver?.disconnect();
  referenceViewerLocationDisposable?.dispose();
  referenceViewerPanel = undefined;
  referenceViewerBody = undefined;
  referenceViewerTrailEl = undefined;
  referenceViewerKeyHandler = undefined;
  referenceViewerDocument = undefined;
  referenceViewerGraph = undefined;
  referenceViewerCanvas = undefined;
  referenceViewerZoom = 1;
  referenceViewerQuery = '';
  referenceViewerPan = { x: 0, y: 0 };
  referenceViewerResizeObserver = undefined;
  referenceViewerLocationDisposable = undefined;
  referenceTrail = [];
}

function referenceKindIcon(kind: ReferenceNode['kind']): SVGSVGElement {
  const icon = kind === 'workflow' ? FileJson2 : kind === 'asset' ? Image : kind === 'catalog' ? Box : Waypoints;
  return createElement(icon, { width: '15', height: '15', 'aria-hidden': 'true' }) as SVGSVGElement;
}

function referenceKindLabel(kind: ReferenceNode['kind']): string {
  if (kind === 'workflow') return '工作流';
  if (kind === 'asset') return '模板图片';
  if (kind === 'catalog') return '奖励目录';
  return '其他';
}

function renderReferenceTrail(doc: Document): void {
  if (!referenceViewerTrailEl) return;
  const backButton = doc.querySelector<HTMLButtonElement>('.reference-viewer-nav button');
  if (backButton) backButton.disabled = referenceTrail.length <= 1;
  referenceViewerTrailEl.replaceChildren();
  referenceTrail.forEach((path, index) => {
    const crumb = doc.createElement('button');
    crumb.type = 'button';
    crumb.className = `reference-trail-crumb${index === referenceTrail.length - 1 ? ' current' : ''}`;
    crumb.textContent = contentName(path);
    crumb.title = path;
    crumb.addEventListener('click', () => {
      referenceTrail = referenceTrail.slice(0, index + 1);
      void renderReferenceViewer();
    });
    referenceViewerTrailEl!.appendChild(crumb);
    if (index < referenceTrail.length - 1) {
      const sep = doc.createElement('span');
      sep.className = 'reference-trail-sep';
      sep.textContent = '/';
      referenceViewerTrailEl!.appendChild(sep);
    }
  });
}

function referenceNodeMatches(node: ReferenceNode, query: string): boolean {
  if (!query) return true;
  const haystack = `${node.name} ${node.path} ${node.workflowId ?? ''}`.toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function appendReferenceNode(doc: Document, layer: HTMLElement, item: ReferenceItem | undefined, node: ReferenceNode, side: 'target' | 'incoming' | 'outgoing', x: number, y: number, width: number): void {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = `reference-graph-node ${side} kind-${node.kind}${node.exists ? '' : ' missing'}`;
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.width = `${width}px`;
  button.setAttribute('aria-label', `${referenceKindLabel(node.kind)} ${node.name}`);
  if (side !== 'target') {
    button.title = '点击查看该内容的引用';
    button.addEventListener('click', () => navigateReferenceViewer(node.path));
  }
  const icon = doc.createElement('span');
  icon.className = 'reference-graph-node-icon';
  icon.appendChild(referenceKindIcon(node.kind));
  const text = doc.createElement('span');
  text.className = 'reference-graph-node-text';
  const name = doc.createElement('strong');
  name.textContent = node.name;
  const pathEl = doc.createElement('small');
  pathEl.textContent = node.path;
  text.append(name, pathEl);
  if (item && item.contexts.length) {
    const count = doc.createElement('em');
    count.textContent = `${item.contexts.length} 处引用`;
    text.appendChild(count);
  }
  button.append(icon, text);
  layer.appendChild(button);
}

function renderReferenceGraph(doc: Document, graph: ReferenceGraph): void {
  const canvas = referenceViewerCanvas;
  if (!canvas) return;
  const zoomControls = canvas.querySelector<HTMLElement>('.reference-zoom-controls');
  canvas.replaceChildren();
  const edges = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edges.classList.add('reference-graph-edges');
  edges.setAttribute('aria-hidden', 'true');
  const layer = doc.createElement('div');
  layer.className = 'reference-graph-nodes';
  canvas.append(edges, layer);
  const width = Math.max(canvas.clientWidth, 320);
  const height = Math.max(canvas.clientHeight, 440);
  const hasBothSides = graph.referencedBy.length > 0 && graph.references.length > 0;
  const nodeWidth = hasBothSides
    ? Math.min(188, Math.max(108, (width - 80) / 3))
    : Math.min(188, Math.max(142, (width - 64) / 2));
  const nodeHeight = 70;
  const filteredIncoming = graph.referencedBy.filter((item) => referenceNodeMatches(item.target, referenceViewerQuery));
  const filteredOutgoing = graph.references.filter((item) => referenceNodeMatches(item.target, referenceViewerQuery));
  const centerX = hasBothSides
    ? width / 2 - nodeWidth / 2
    : filteredIncoming.length > 0
      ? width * .7 - nodeWidth / 2
      : filteredOutgoing.length > 0
        ? width * .3 - nodeWidth / 2
        : width / 2 - nodeWidth / 2;
  const centerY = height / 2 - nodeHeight / 2;
  const sideMargin = width >= 720 ? 70 : 18;
  const incomingX = sideMargin;
  const outgoingX = width - nodeWidth - sideMargin;
  const placeY = (index: number, total: number): number => Math.max(26, height / 2 - (total - 1) * 48 + index * 96 - nodeHeight / 2);
  const paths: string[] = [];
  filteredIncoming.forEach((item, index) => {
    const y = placeY(index, filteredIncoming.length);
    appendReferenceNode(doc, layer, item, item.target, 'incoming', incomingX, y, nodeWidth);
    const sy = y + nodeHeight / 2;
    paths.push(`M ${incomingX + nodeWidth} ${sy} C ${incomingX + nodeWidth + 80} ${sy}, ${centerX - 80} ${centerY + nodeHeight / 2}, ${centerX} ${centerY + nodeHeight / 2}`);
  });
  filteredOutgoing.forEach((item, index) => {
    const y = placeY(index, filteredOutgoing.length);
    appendReferenceNode(doc, layer, item, item.target, 'outgoing', outgoingX, y, nodeWidth);
    const sy = y + nodeHeight / 2;
    paths.push(`M ${centerX + nodeWidth} ${centerY + nodeHeight / 2} C ${centerX + nodeWidth + 80} ${centerY + nodeHeight / 2}, ${outgoingX - 80} ${sy}, ${outgoingX} ${sy}`);
  });
  appendReferenceNode(doc, layer, undefined, graph.target, 'target', centerX, centerY, nodeWidth);
  edges.setAttribute('viewBox', `0 0 ${width} ${height}`);
  edges.setAttribute('preserveAspectRatio', 'none');
  for (const pathData of paths) {
    const edge = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    edge.setAttribute('d', pathData);
    edge.classList.add('reference-graph-edge');
    edges.appendChild(edge);
  }
  if (zoomControls) canvas.appendChild(zoomControls);
  canvas.style.setProperty('--reference-zoom', String(referenceViewerZoom));
  canvas.style.setProperty('--reference-pan-x', `${referenceViewerPan.x}px`);
  canvas.style.setProperty('--reference-pan-y', `${referenceViewerPan.y}px`);
}

function observeReferenceCanvas(): void {
  const canvas = referenceViewerCanvas;
  if (!canvas) return;
  referenceViewerResizeObserver?.disconnect();
  const ownerWindow = canvas.ownerDocument.defaultView;
  const ResizeObserverCtor = ownerWindow?.ResizeObserver;
  if (!ownerWindow || !ResizeObserverCtor) return;
  let frameId: number | undefined;
  referenceViewerResizeObserver = new ResizeObserverCtor(() => {
    if (frameId !== undefined) ownerWindow.cancelAnimationFrame(frameId);
    frameId = ownerWindow.requestAnimationFrame(() => {
      frameId = undefined;
      const graph = referenceViewerGraph;
      if (graph && referenceViewerCanvas === canvas) renderReferenceGraph(canvas.ownerDocument, graph);
    });
  });
  referenceViewerResizeObserver.observe(canvas);
}

function createReferenceControl(doc: Document, label: string, value: string, type: 'number' | 'checkbox' = 'number'): HTMLElement {
  const row = doc.createElement('label');
  row.className = 'reference-filter-row';
  row.appendChild(doc.createTextNode(label));
  const input = doc.createElement('input');
  input.type = type;
  if (type === 'checkbox') input.checked = true;
  else { input.value = value; input.min = '1'; input.max = '20'; }
  row.appendChild(input);
  return row;
}

async function renderReferenceViewer(): Promise<void> {
  const doc = referenceViewerDocument;
  const body = referenceViewerBody;
  if (!doc || !body || referenceTrail.length === 0) return;
  const current = referenceTrail[referenceTrail.length - 1];
  const token = ++referenceViewerToken;

  renderReferenceTrail(doc);
  body.replaceChildren();
  const loading = doc.createElement('div');
  loading.className = 'reference-loading';
  const spinner = doc.createElement('span');
  spinner.className = 'loading-spinner';
  loading.append(spinner, doc.createTextNode('正在分析引用…'));
  body.appendChild(loading);

  let graph: ReferenceGraph;
  try {
    graph = await api.getReferenceGraph(current);
  } catch (error) {
    if (referenceViewerDocument !== doc || referenceViewerToken !== token || referenceTrail[referenceTrail.length - 1] !== current) return;
    body.replaceChildren();
    const failure = doc.createElement('div');
    failure.className = 'reference-section-empty';
    failure.textContent = `引用分析失败：${errorMessage(error)}`;
    body.appendChild(failure);
    showToast(errorMessage(error), true);
    return;
  }
  if (referenceViewerDocument !== doc || referenceViewerToken !== token || referenceTrail[referenceTrail.length - 1] !== current) return;

  referenceViewerGraph = graph;
  body.replaceChildren();
  const workspace = doc.createElement('div');
  workspace.className = 'reference-workspace';
  const sidebar = doc.createElement('aside');
  sidebar.className = 'reference-sidebar';
  const search = doc.createElement('label');
  search.className = 'reference-search';
  search.appendChild(createElement(Search, { width: '15', height: '15', 'aria-hidden': 'true' }));
  const searchInput = doc.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索...';
  searchInput.value = referenceViewerQuery;
  searchInput.addEventListener('input', () => { referenceViewerQuery = searchInput.value.trim(); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  search.appendChild(searchInput);
  sidebar.appendChild(search);
  sidebar.appendChild(createReferenceControl(doc, '搜索引用者深度', '1'));
  sidebar.appendChild(createReferenceControl(doc, '搜索依赖性深度', '1'));
  sidebar.appendChild(createReferenceControl(doc, '搜索宽度限制', '20', 'checkbox'));
  const filter = doc.createElement('label');
  filter.className = 'reference-filter-row';
  filter.appendChild(doc.createTextNode('集过滤器'));
  const select = doc.createElement('select');
  select.innerHTML = '<option>None</option><option>工作流</option><option>模板图片</option><option>奖励目录</option>';
  filter.appendChild(select);
  sidebar.appendChild(filter);
  const summary = doc.createElement('div');
  summary.className = 'reference-sidebar-summary';
  summary.innerHTML = `<strong>${graph.target.name}</strong><span>${graph.target.path}</span><span>${graph.referencedBy.length} 个引用者 · ${graph.references.length} 个依赖</span>`;
  sidebar.appendChild(summary);
  const canvas = doc.createElement('div');
  canvas.className = 'reference-graph-canvas';
  referenceViewerCanvas = canvas;
  let dragOrigin: { x: number; y: number; panX: number; panY: number } | undefined;
  canvas.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragOrigin = { x: event.clientX, y: event.clientY, panX: referenceViewerPan.x, panY: referenceViewerPan.y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragOrigin) return;
    referenceViewerPan = { x: dragOrigin.panX + event.clientX - dragOrigin.x, y: dragOrigin.panY + event.clientY - dragOrigin.y };
    canvas.style.setProperty('--reference-pan-x', `${referenceViewerPan.x}px`);
    canvas.style.setProperty('--reference-pan-y', `${referenceViewerPan.y}px`);
  });
  const stopGraphDrag = (event: PointerEvent): void => {
    if (!dragOrigin) return;
    dragOrigin = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', stopGraphDrag);
  canvas.addEventListener('pointercancel', stopGraphDrag);
  const zoom = doc.createElement('div');
  zoom.className = 'reference-zoom-controls';
  const zoomOut = doc.createElement('button');
  zoomOut.type = 'button'; zoomOut.title = '缩小'; zoomOut.appendChild(createElement(Minus, { width: '14', height: '14', 'aria-hidden': 'true' }));
  zoomOut.addEventListener('click', () => { referenceViewerZoom = Math.max(.6, referenceViewerZoom - .1); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  const zoomIn = doc.createElement('button');
  zoomIn.type = 'button'; zoomIn.title = '放大'; zoomIn.appendChild(createElement(Plus, { width: '14', height: '14', 'aria-hidden': 'true' }));
  zoomIn.addEventListener('click', () => { referenceViewerZoom = Math.min(1.6, referenceViewerZoom + .1); if (referenceViewerGraph) renderReferenceGraph(doc, referenceViewerGraph); });
  zoom.append(zoomOut, zoomIn);
  canvas.appendChild(zoom);
  workspace.append(sidebar, canvas);
  body.appendChild(workspace);
  observeReferenceCanvas();
  window.requestAnimationFrame(() => renderReferenceGraph(doc, graph));
}

function openReferenceViewer(path: string, _sourceDocument: Document): void {
  closeReferenceViewer();
  const doc = document;
  referenceViewerDocument = doc;
  referenceTrail = [path];

  workbenchFrame?.show('referenceViewer');
  const host = doc.querySelector<HTMLElement>('#module-reference-viewer');
  if (!host) return;

  const panel = doc.createElement('div');
  panel.className = 'reference-viewer';
  panel.tabIndex = -1;

  const header = doc.createElement('div');
  header.className = 'reference-viewer-header';
  const trailEl = doc.createElement('div');
  trailEl.className = 'reference-viewer-trail';
  const nav = doc.createElement('div');
  nav.className = 'reference-viewer-nav';
  const backButton = doc.createElement('button');
  backButton.type = 'button'; backButton.className = 'panel-action'; backButton.title = '后退';
  backButton.disabled = true;
  backButton.appendChild(createElement(ArrowLeft, { width: '14', height: '14', 'aria-hidden': 'true' }));
  backButton.addEventListener('click', () => { if (referenceTrail.length > 1) { referenceTrail.pop(); void renderReferenceViewer(); } });
  nav.appendChild(backButton);
  const refreshButton = doc.createElement('button');
  refreshButton.type = 'button'; refreshButton.className = 'panel-action'; refreshButton.title = '刷新';
  refreshButton.appendChild(createElement(RefreshCw, { width: '14', height: '14', 'aria-hidden': 'true' }));
  refreshButton.addEventListener('click', () => void renderReferenceViewer());
  nav.appendChild(refreshButton);
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'panel-action';
  closeButton.title = '关闭 (Esc)';
  closeButton.setAttribute('aria-label', '关闭');
  closeButton.appendChild(createElement(X, { width: '14', height: '14', 'aria-hidden': 'true' }));
  closeButton.addEventListener('click', closeReferenceViewer);
  header.append(nav, trailEl, closeButton);

  const body = doc.createElement('div');
  body.className = 'reference-viewer-body';

  const footer = doc.createElement('div');
  footer.className = 'reference-viewer-footer';
  footer.textContent = '拖动画布可浏览引用关系 · 点击节点逐层跳转 · Esc 关闭';

  panel.append(header, body, footer);
  host.replaceChildren(panel);

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeReferenceViewer();
  };
  panel.addEventListener('keydown', keyHandler, true);

  referenceViewerPanel = panel;
  referenceViewerBody = body;
  referenceViewerTrailEl = trailEl;
  referenceViewerKeyHandler = keyHandler;

  const dockPanel = workbenchFrame?.dockviewApi.getPanel('referenceViewer');
  referenceViewerLocationDisposable = dockPanel?.api.onDidLocationChange(() => {
    window.setTimeout(() => {
      const ownerDocument = referenceViewerPanel?.ownerDocument;
      if (dockPanel.api.location.type === 'popout' && ownerDocument && ownerDocument !== document) {
        ownerDocument.title = '引用查看器 - Onmyoji Studio';
        const popoutTitle = ownerDocument.querySelector<HTMLElement>('.popout-title');
        if (popoutTitle) popoutTitle.textContent = '引用查看器';
      }
      observeReferenceCanvas();
      if (referenceViewerGraph && referenceViewerCanvas) renderReferenceGraph(referenceViewerCanvas.ownerDocument, referenceViewerGraph);
    }, 0);
  });

  void renderReferenceViewer();
  window.setTimeout(() => workbenchFrame?.popout('referenceViewer'), 0);
}

/** 跳转到引用图中的另一个节点（层层跳转）。 */
function navigateReferenceViewer(path: string): void {
  referenceTrail.push(path);
  referenceViewerQuery = '';
  referenceViewerPan = { x: 0, y: 0 };
  void renderReferenceViewer();
}

type IconComponent = typeof Box;

/** 结构树节点类型 → Lucide 图标与语义色（保持低饱和，遵循设计规则）。 */
const treeNodeGlyphs: Record<string, { icon: IconComponent; className: string }> = {
  root: { icon: Flag, className: 'type-root' },
  sequence: { icon: ListTree, className: 'type-sequence' },
  selector: { icon: GitBranch, className: 'type-selector' },
  simple_parallel: { icon: Columns3, className: 'type-parallel' },
  instance_parallel: { icon: MonitorUp, className: 'type-instance-parallel' },
  task: { icon: Workflow, className: 'type-task' },
};
const treeNodeFallbackGlyph = { icon: CircleDot, className: 'type-default' };

/** 工作流变量类型 → 图标；颜色由类型 class 统一控制。 */
const variableTypeGlyphs: Record<string, { icon: IconComponent; className: string }> = {
  string: { icon: Type, className: 'type-string' },
  number: { icon: Sigma, className: 'type-number' },
  integer: { icon: Hash, className: 'type-integer' },
  boolean: { icon: ToggleLeft, className: 'type-boolean' },
  rect: { icon: Scan, className: 'type-rect' },
  asset: { icon: Image, className: 'type-asset' },
  path: { icon: Folder, className: 'type-path' },
  array: { icon: List, className: 'type-array' },
  object: { icon: Braces, className: 'type-object' },
  any: { icon: CircleHelp, className: 'type-any' },
};
const variableTypeFallbackGlyph = { icon: CircleHelp, className: 'type-any' };

/** 内联创建 Lucide SVG，供动态树行使用（data-lucide + createIcons 无法覆盖局部更新）。 */
function createTreeIcon(icon: IconComponent, className: string): SVGSVGElement {
  return createElement(icon, { width: '14', height: '14', 'aria-hidden': 'true', class: className }) as SVGSVGElement;
}

function createTreeRows(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const byId = new Map(sidebarNodes.map((node) => [node.id, node]));
  const childIds = new Set(sidebarNodes.flatMap((node) => node.children));
  const roots = sidebarNodes.filter((node) => !childIds.has(node.id));
  const visited = new Set<string>();

  const appendNode = (node: SidebarNode, depth: number, container: ParentNode & { append: (parent: Node) => void }): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const glyph = treeNodeGlyphs[node.type] ?? treeNodeFallbackGlyph;
    const hasChildren = node.children.some((childId) => byId.has(childId));
    const branchOpen = hasChildren && !collapsedTreeNodes.has(node.id);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `tree-row${node.id === selectedNode ? ' selected' : ''}`;
    row.title = `${node.name}\n${node.meta}`;
    row.dataset.nodeId = node.id;
    if (hasChildren) row.setAttribute('aria-expanded', String(branchOpen));

    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron';
    if (hasChildren) chevron.appendChild(createTreeIcon(ChevronRight, 'chevron-closed'));

    const icon = document.createElement('span');
    icon.className = `node-type-glyph ${glyph.className}`;
    icon.appendChild(createTreeIcon(glyph.icon, 'glyph-svg'));

    const label = document.createElement('span');
    label.className = 'tree-label';

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    const meta = document.createElement('span');
    meta.className = 'tree-meta';
    meta.textContent = node.meta;

    const children = document.createElement('div');
    children.className = 'tree-children';

    label.append(name, meta);
    row.append(chevron, icon, label);
    row.addEventListener('click', (event) => {
      if (hasChildren && event.target instanceof Node && chevron.contains(event.target)) {
        toggleTreeNode(node.id, row, children);
        return;
      }
      docking?.showPanel('details');
      editorCommand('focusNode', node.id);
    });
    container.append(row, children);
    if (hasChildren) {
      if (branchOpen) row.classList.add('open');
      else children.classList.add('closed');
      for (const childId of node.children) {
        const child = byId.get(childId);
        if (child) appendNode(child, depth + 1, children);
      }
    }
  };
  for (const root of roots) appendNode(root, 0, fragment);
  for (const node of sidebarNodes) appendNode(node, 0, fragment);
  return fragment;
}

/** 展开/收起单个结构树分支（状态记录在 collapsedTreeNodes，重渲染后保持）。 */
function toggleTreeNode(nodeId: string, row: HTMLButtonElement, children: HTMLElement): void {
  const open = row.classList.toggle('open');
  children.classList.toggle('closed', !open);
  if (open) collapsedTreeNodes.delete(nodeId);
  else collapsedTreeNodes.add(nodeId);
  row.setAttribute('aria-expanded', String(open));
}

function setAllTreeBranches(open: boolean): void {
  collapsedTreeNodes = open ? new Set() : new Set(collectAllBranchNodeIds());
  structureView.querySelectorAll<HTMLButtonElement>('.tree-row').forEach((row) => {
    if (!hasTreeChildren(row)) return;
    row.classList.toggle('open', open);
    row.setAttribute('aria-expanded', String(open));
  });
  structureView.querySelectorAll<HTMLElement>('.tree-children').forEach((children) => {
    children.classList.toggle('closed', !open);
  });
}

function collectAllBranchNodeIds(): Set<string> {
  return new Set(sidebarNodes.filter((node) => node.children.length > 0).map((node) => node.id));
}

function hasTreeChildren(row: HTMLButtonElement): boolean {
  return Boolean(row.nextElementSibling?.classList.contains('tree-children')
    && row.nextElementSibling.childElementCount > 0);
}

/** 结构树内容指纹：id、子级、名称、类型、meta 都没变时无需重建 DOM。 */
function treeSignature(): string {
  return sidebarNodes.map((node) => `${node.id}\u0001${node.type}\u0001${node.name}\u0001${node.meta}\u0002${node.children.join('\u0003')}`).join('\u0004');
}

/** 仅更新结构树选中行（含祖先），不重建 DOM，保持滚动位置与展开状态。 */
function syncTreeSelection(previousNode: string): void {
  if (previousNode === selectedNode) return;
  const view = structureView;
  if (previousNode) {
    const previousRow = view.querySelector<HTMLButtonElement>(`.tree-row[data-node-id="${CSS.escape(previousNode)}"]`);
    if (previousRow) previousRow.classList.remove('selected');
  }
  if (!selectedNode) return;
  const nextRow = view.querySelector<HTMLButtonElement>(`.tree-row[data-node-id="${CSS.escape(selectedNode)}"]`);
  if (!nextRow) return;
  nextRow.classList.add('selected');
  // 保证选中的行自身可见：仅展开其祖先链，不动其他手动折叠的分支。
  for (let parent = nextRow.parentElement; parent && parent !== view; parent = parent.parentElement) {
    if (parent.classList.contains('tree-children') && parent.classList.contains('closed')) {
      parent.classList.remove('closed');
      const branchRow = parent.previousElementSibling as HTMLElement | null;
      branchRow?.classList.add('open');
      if (branchRow?.dataset.nodeId) collapsedTreeNodes.delete(branchRow.dataset.nodeId);
    }
  }
  const rowRect = nextRow.getBoundingClientRect();
  const viewRect = view.getBoundingClientRect();
  if (rowRect.bottom < viewRect.top || rowRect.top > viewRect.bottom) {
    nextRow.scrollIntoView({ block: 'nearest' });
  }
}

/** 仅更新变量列表选中行，避免整体重建导致滚动跳动。 */
function syncVariableSelection(previousVariable: string, previousScope: 'inputs' | 'variables'): void {
  if (previousVariable === selectedVariable && previousScope === selectedVariableScope) return;
  const previousRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-scope="${previousScope}"][data-variable-name="${CSS.escape(previousVariable)}"]`);
  if (previousRow) previousRow.classList.remove('selected');
  const nextRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-scope="${selectedVariableScope}"][data-variable-name="${CSS.escape(selectedVariable)}"]`);
  nextRow?.classList.add('selected');
}

/** 输入与状态列表内容指纹。 */
function variableSignature(): string {
  return sidebarVariables.map((variable) => `${variable.scope}\u0001${variable.name}\u0001${variable.type}`).join('\u0004');
}

function renderVariables(): void {
  variablesView.replaceChildren();
  if (sidebarVariables.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel';
    empty.textContent = '此工作流还没有输入或运行变量';
    variablesView.appendChild(empty);
    return;
  }
  for (const scope of ['inputs', 'variables'] as const) {
    const heading = document.createElement('div');
    heading.className = 'variable-group-heading';
    heading.textContent = scope === 'inputs' ? '工作流输入' : '运行变量';
    variablesView.appendChild(heading);
    const scoped = sidebarVariables.filter((variable) => variable.scope === scope);
    if (scoped.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'variable-group-empty';
      empty.textContent = scope === 'inputs' ? '无调用参数' : '无可变状态';
      variablesView.appendChild(empty);
    }
    for (const variable of scoped) {
    const row = document.createElement('button');
    row.className = `variable-row scope-${scope}${variable.name === selectedVariable && scope === selectedVariableScope ? ' selected' : ''}`;
    row.title = `${overviewInputDisplayName(variable.name)} (${variable.name})\n类型：${variable.type}\n${scope === 'inputs' ? '调用方传入，只读' : '流程内状态，可更新'}\n拖到画布可创建引用卡片`;
    row.dataset.variableName = variable.name;
    row.dataset.variableScope = scope;
    row.innerHTML = '<span class="variable-icon"></span><span class="variable-name"></span><span class="variable-flags"></span>';
    const variableGlyph = variableTypeGlyphs[variable.type.toLowerCase()] ?? variableTypeFallbackGlyph;
    const icon = row.querySelector<HTMLElement>('.variable-icon')!;
    icon.classList.add(variableGlyph.className);
    icon.appendChild(createTreeIcon(variableGlyph.icon, 'variable-icon-svg'));
    row.querySelector<HTMLElement>('.variable-name')!.textContent = overviewInputDisplayName(variable.name);
    const flags = row.querySelector<HTMLElement>('.variable-flags')!;
    flags.innerHTML = `<span>${variable.type}</span><span class="variable-scope">${scope === 'inputs' ? 'INPUT' : 'STATE'}</span>`;
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.setData('application/x-onmyoji-variable', JSON.stringify({ name: variable.name, scope }));
      transfer.effectAllowed = 'copy';
    });
    row.addEventListener('click', () => {
      docking?.showPanel('details');
      editorCommand('selectVariable', { name: variable.name, scope });
    });
    variablesView.appendChild(row);
    }
  }
}

function renderSidebar(): void {
  const keepScroll = structureView.scrollTop;
  structureView.replaceChildren();
  if (sidebarNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-panel';
    empty.textContent = '打开工作流后显示节点结构';
    structureView.appendChild(empty);
  } else {
    structureView.appendChild(createTreeRows());
  }
  structureView.scrollTop = keepScroll;
  renderVariables();
  createIcons({ icons: desktopIcons, root: structureView });
}

async function loadWorkflow(uri: string, addToBackStack = false): Promise<void> {
  if (!uri) return;
  loadingMask.classList.remove('hidden');
  try {
    if (addToBackStack && currentUri && currentUri !== uri) backStack.push(currentUri);
    const init = await api.getWorkflowInit(uri, selectedInstance, backStack.length > 0);
    currentEditorInit = init;
    if (init.document.uri !== currentUri) collapsedTreeNodes = new Set();
    currentUri = init.document.uri;
    init.workflowTrail = workflowTrail();
    currentText = init.document.text;
    selectedInstance = init.selectedInstance;
    if (bootstrap) {
      bootstrap.workflows = init.workflows;
      bootstrap.instances = init.instances;
    }
    renderWorkflowSelect(init.workflows);
    renderInstances(init.instances, init.selectedInstance);
    reconcileOverviewSelection();
    renderOverview();
    renderContentBrowser();
    document.querySelector<HTMLElement>('#document-path')!.textContent = displayFileUri(init.document.uri);
    setDirty(false);
    postToEditors(init as unknown as Record<string, unknown>);
    setStatus(init.issues.length > 0 ? `${init.issues.length} 个校验问题` : '工作流已载入');
  } catch (error) {
    showToast(errorMessage(error), true);
    setStatus('载入失败');
  } finally {
    loadingMask.classList.add('hidden');
  }
}

async function refreshInstances(): Promise<void> {
  try {
    const instances = await api.listInstances();
    renderInstances(instances, selectedInstance);
    renderOverview();
    postToEditors({ type: 'runtimeInstances', instances, selectedInstance });
  } catch {
    // Device discovery is best effort while the user edits offline.
  }
}

async function handleEditorMessage(message: Record<string, unknown>, sourceFrame: HTMLIFrameElement): Promise<void> {
  const type = String(message.type ?? '');
  try {
    if (type === 'ready') {
      if (sourceFrame === editorFrame) editorReady = true;
      if (currentEditorInit) postToFrame(sourceFrame, currentEditorInit as unknown as Record<string, unknown>);
      else if (sourceFrame === editorFrame && bootstrap?.defaultWorkflow) await loadWorkflow(currentUri || bootstrap.defaultWorkflow);
      return;
    }
    if (type === 'documentStateChanged') {
      const text = String(message.text ?? '');
      if (!text) return;
      currentText = text;
      if (currentEditorInit) currentEditorInit.document.text = text;
      setDirty(message.dirty !== false);
      const targetFrame = sourceFrame === editorFrame ? detailsFrame : editorFrame;
      postToFrame(targetFrame, { type: 'replaceDocument', text, recordHistory: true });
      return;
    }
    if (type === 'inspectorRequested') {
      if (sourceFrame !== editorFrame) return;
      const selection = message.inspectorSelection as unknown as InspectorSelection;
      docking?.showPanel('details');
      postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      return;
    }
    if (type === 'sidebarStateChanged') {
      if (sourceFrame !== editorFrame) return;
      const previousTreeSignature = treeSignature();
      const previousVariableSignature = variableSignature();
      const previousSelectedNode = selectedNode;
      const previousSelectedVariable = selectedVariable;
      const previousSelectedVariableScope = selectedVariableScope;
      sidebarVariables = Array.isArray(message.variables) ? message.variables as SidebarVariable[] : [];
      sidebarNodes = Array.isArray(message.nodes) ? message.nodes as SidebarNode[] : [];
      selectedVariable = typeof message.selectedVariable === 'string' ? message.selectedVariable : '';
      selectedVariableScope = message.selectedVariableScope === 'variables' ? 'variables' : 'inputs';
      selectedNode = typeof message.selectedNode === 'string' ? message.selectedNode : '';
      const treeUnchanged = sidebarNodes.length > 0 && treeSignature() === previousTreeSignature;
      const variablesUnchanged = variableSignature() === previousVariableSignature;
      if (treeUnchanged && variablesUnchanged) {
        // 结构与变量都没变（如仅在画布上切换选中节点）：只更新选中行，不重建树，
        // 展开状态、折叠状态与滚动位置都原样保留。
        syncTreeSelection(previousSelectedNode);
        syncVariableSelection(previousSelectedVariable, previousSelectedVariableScope);
      } else if (treeUnchanged) {
        // 结构没变但变量列表变了：仅重建变量列表。
        renderVariables();
      } else {
        renderSidebar();
      }
      const selection = message.inspectorSelection as unknown as InspectorSelection | undefined;
      if (selection && selection.kind !== 'none') {
        docking?.showPanel('details');
        postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      } else if (selection?.kind === 'none') {
        postToFrame(detailsFrame, { type: 'editorCommand', command: 'setInspectorSelection', value: selection });
      }
      return;
    }
    if (type === 'save') {
      const text = String(message.text ?? '');
      await api.saveWorkflow(currentUri, text);
      currentText = text;
      if (currentEditorInit) currentEditorInit.document.text = text;
      setDirty(false);
      setStatus('工作流已保存');
      showToast('工作流已保存');
      return;
    }
    if (type === 'switchWorkflow') {
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      backStack = [];
      await loadWorkflow(String(message.uri ?? ''));
      return;
    }
    if (type === 'openSubWorkflow') {
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      const reference = String(message.reference ?? '').trim();
      let resolved = reference ? resolveWorkflow(reference) : undefined;
      if (!resolved && typeof message.nodeId === 'string') {
        const source = JSON.parse(currentText) as { nodes?: Array<{ id?: string; action?: string; params?: { workflow?: string } }> };
        const node = source.nodes?.find((item) => item.id === message.nodeId && item.action === 'workflow.run');
        if (node?.params?.workflow) resolved = resolveWorkflow(node.params.workflow);
      }
      if (!resolved) throw new Error(`未找到子工作流：${reference || message.nodeId || ''}`);
      await loadWorkflow(resolved.uri, true);
      return;
    }
    if (type === 'goBackWorkflow') {
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      const previous = backStack.pop();
      if (previous) await loadWorkflow(previous);
      return;
    }
    if (type === 'navigateWorkflowTrail') {
      const index = Number(message.index);
      const trail = [...backStack, currentUri];
      if (!Number.isInteger(index) || index < 0 || index >= trail.length - 1) return;
      if (typeof message.saveText === 'string') {
        await api.saveWorkflow(currentUri, message.saveText);
        currentText = message.saveText;
      }
      backStack = trail.slice(0, index);
      await loadWorkflow(trail[index]);
      return;
    }
    if (type === 'reloadRequest') {
      await loadWorkflow(currentUri);
      return;
    }
    if (type === 'runWorkflow') {
      const text = String(message.text ?? currentText);
      currentText = text;
      await api.runWorkflow({ uri: currentUri, instanceId: String(message.instanceId ?? selectedInstance), text });
      setDirty(false);
      if (sharedPanelDockBridge) sharedPanelDockBridge.show('runtime');
      else docking?.showPanel('runtime');
      return;
    }
    if (type === 'stopWorkflow') {
      await api.stopWorkflow();
      return;
    }
    if (type === 'selectInstance') {
      selectRuntimeInstance(String(message.instanceId ?? selectedInstance), false);
      postToEditors({ type: 'instanceSelected', instanceId: selectedInstance });
      return;
    }
    if (type === 'pickRoi') {
      const referenceResolution: [number, number] = Array.isArray(message.referenceResolution)
        ? message.referenceResolution as [number, number]
        : [1920, 1080];
      const result = await api.captureRoi({ instanceId: String(message.instanceId ?? selectedInstance), referenceResolution });
      postToFrame(sourceFrame, { type: 'roiPickerImage', requestId: message.requestId, nodeId: message.nodeId ?? message.stepId, key: message.key, ...result, referenceResolution });
      return;
    }
    if (type === 'checkTemplate') {
      const result = await api.checkTemplate({
        template: String(message.template ?? ''),
        roi: Array.isArray(message.roi) ? message.roi as [number, number, number, number] : undefined,
        threshold: Number(message.threshold ?? .85),
        maxResults: Number(message.maxResults ?? 20),
        scaleSearch: Boolean(message.scaleSearch),
        referenceResolution: Array.isArray(message.referenceResolution) ? message.referenceResolution as [number, number] : [1920, 1080],
        instanceId: String(message.instanceId ?? selectedInstance),
      });
      postToFrame(sourceFrame, { type: 'templateCheckResult', requestId: message.requestId, ...result });
      return;
    }
    if (type === 'listAssetImages') {
      postToFrame(sourceFrame, { type: 'assetImages', requestId: message.requestId, images: await api.listAssets() });
      return;
    }
    if (type === 'requestAssetData') {
      const paths = Array.isArray(message.paths) ? message.paths.map(String) : [];
      postToFrame(sourceFrame, { type: 'assetData', requestId: message.requestId, items: await api.readAssetData(paths) });
      return;
    }
    if (type === 'saveTemplate') {
      const savedPath = await api.saveTemplate({
        targetPath: typeof message.targetPath === 'string' ? message.targetPath : undefined,
        filename: String(message.filename ?? 'template.png'),
        dataUrl: String(message.dataUrl ?? ''),
      });
      postToFrame(sourceFrame, { type: 'templateSaved', requestId: message.requestId, nodeId: message.nodeId ?? message.stepId, key: message.key, path: savedPath });
      return;
    }
    if (type === 'saveCanvasImage') {
      const savedPath = await api.saveCanvas({ filename: String(message.filename ?? 'workflow-layout.png'), dataUrl: String(message.dataUrl ?? '') });
      postToFrame(sourceFrame, savedPath ? { type: 'canvasImageSaved', path: savedPath } : { type: 'canvasImageCancelled' });
      return;
    }
    if (type === 'newWorkflow') {
      const uri = await api.createWorkflow();
      if (uri) {
        bootstrap!.workflows = (await api.bootstrap()).workflows;
        reconcileOverviewSelection();
        renderOverview();
        backStack = [];
        await loadWorkflow(uri);
      }
      return;
    }
    if (type === 'openFile') {
      await api.openWorkflowFile(currentUri);
      return;
    }
    if (type === 'openWorkflowPicker') {
      sharedPanelDockBridge?.show('contentBrowser');
      window.setTimeout(() => contentBrowserSearch.focus(), 0);
      return;
    }
    if (type === 'openWorkflowTree') {
      showToast('结构树已显示在左侧');
      return;
    }
    if (type === 'openReferences') {
      if (!currentUri) {
        showToast('请先打开一个工作流再查看引用', true);
        return;
      }
      const relative = relativeToProject(displayFileUri(currentUri));
      if (relative) openReferenceViewer(relative, document);
      else showToast('无法定位当前工作流的项目路径', true);
      return;
    }
    if (type === 'error') throw new Error(String(message.message ?? '编辑器错误'));
  } catch (error) {
    const text = errorMessage(error);
    if (type === 'pickRoi' || type === 'saveTemplate') postToFrame(sourceFrame, { type: 'roiPickerError', requestId: message.requestId, message: text });
    else if (type === 'checkTemplate') postToFrame(sourceFrame, { type: 'templateCheckError', requestId: message.requestId, message: text });
    else if (type === 'listAssetImages') postToFrame(sourceFrame, { type: 'assetImagesError', requestId: message.requestId, message: text });
    else if (type === 'requestAssetData') postToFrame(sourceFrame, { type: 'assetDataError', requestId: message.requestId, message: text });
    else if (type === 'saveCanvasImage') postToFrame(sourceFrame, { type: 'canvasImageError', message: text });
    showToast(text, true);
    setStatus('操作失败');
  }
}

function appendOutput(event: RuntimeOutputEvent): void {
  runtimeEngineOutput += event.text;
  if (runtimeEngineOutput.length > 300_000) runtimeEngineOutput = runtimeEngineOutput.slice(-300_000);
  postToRuntimeLog({ type: 'engineOutput', chunk: event.text, stream: event.stream });
}

function updateRuntimeState(event: RuntimeStateEvent): void {
  runtimeBusy = event.state === 'running' || event.state === 'stopping';
  if (event.state === 'running') {
    const workflow = String(event.workflow || currentUri).replace(/\\/g, '/').split('/').pop() || '工作流';
    runtimeLogDescriptor = {
      workflow,
      instance: event.sources?.length ? `${event.sources.length} 个实例` : event.instance || selectedInstance,
      startedAt: event.startedAt ?? Date.now(),
      status: 'running',
      sources: event.sources,
    };
    runtimeLogEvents = [];
    runtimeEngineOutput = '';
    runtimeProcessResult = undefined;
    sendRuntimeLogInit();
  } else if (event.state === 'succeeded' || event.state === 'failed' || event.state === 'idle') {
    runtimeProcessResult = {
      code: event.exitCode ?? (event.state === 'failed' ? -1 : 0),
      signal: null,
      stopped: event.state === 'idle',
    };
    postToRuntimeLog({ type: 'processFinished', ...runtimeProcessResult });
  }
  document.querySelector<HTMLButtonElement>('#run-button')!.disabled = runtimeBusy || Boolean(overviewRun?.active);
  document.querySelector<HTMLButtonElement>('#stop-button')!.disabled = !runtimeBusy && !overviewRun?.active;
  handleOverviewRuntimeState(event);
  renderOverview();
  setStatus(event.label);
}

function updateMaximizedState(maximized: boolean): void {
  const button = document.querySelector<HTMLButtonElement>('#window-maximize')!;
  const menuButton = document.querySelector<HTMLButtonElement>('#menu-window-maximize')!;
  button.title = maximized ? '还原' : '最大化';
  button.setAttribute('aria-label', maximized ? '还原' : '最大化');
  button.classList.toggle('maximized', maximized);
  button.innerHTML = `<i data-lucide="${maximized ? 'copy' : 'square'}"></i>`;
  menuButton.firstElementChild!.textContent = maximized ? '还原' : '最大化';
  createIcons({ icons: desktopIcons, root: button });
}

function closeMoreMenu(): void {
  if (!moreMenu) return;
  document.removeEventListener('pointerdown', moreMenu.dismiss, true);
  document.removeEventListener('keydown', moreMenu.keyHandler, true);
  window.removeEventListener('resize', closeMoreMenu);
  window.removeEventListener('scroll', closeMoreMenu, true);
  moreMenu.menu.remove();
  moreMenu = undefined;
  document.querySelector<HTMLButtonElement>('#more-button')?.setAttribute('aria-expanded', 'false');
}

function showMoreMenu(button: HTMLButtonElement): void {
  closeMoreMenu();
  const menu = document.createElement('div');
  menu.className = 'desktop-more-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '更多操作');

  const actions: Array<{ label: string; type: string } | 'separator'> = [
    { label: '新建工作流', type: 'newWorkflow' },
    { label: '选择其他工作流…', type: 'openWorkflowPicker' },
    { label: '打开 JSON', type: 'openFile' },
    'separator',
    { label: '在结构树窗口查看', type: 'openWorkflowTree' },
    'separator',
    { label: '查看引用', type: 'openReferences' },
    'separator',
    { label: '重新加载', type: 'reloadRequest' },
  ];
  for (const action of actions) {
    if (action === 'separator') {
      const separator = document.createElement('div');
      separator.className = 'desktop-more-separator';
      separator.setAttribute('role', 'separator');
      menu.appendChild(separator);
      continue;
    }
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.setAttribute('role', 'menuitem');
    entry.textContent = action.label;
    entry.addEventListener('click', () => {
      closeMoreMenu();
      void handleEditorMessage({ type: action.type }, editorFrame);
    });
    menu.appendChild(entry);
  }

  document.body.appendChild(menu);
  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const left = Math.min(
    Math.max(margin, buttonRect.right - menuRect.width),
    Math.max(margin, viewportWidth - menuRect.width - margin),
  );
  const top = Math.min(
    Math.max(margin, buttonRect.bottom + 4),
    Math.max(margin, viewportHeight - menuRect.height - margin),
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const dismiss = (event: Event): void => {
    if (menu.contains(event.target as Node) || event.target === button) return;
    closeMoreMenu();
  };
  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeMoreMenu();
  };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', keyHandler, true);
  window.addEventListener('resize', closeMoreMenu);
  window.addEventListener('scroll', closeMoreMenu, true);
  moreMenu = { menu, dismiss, keyHandler };
  button.setAttribute('aria-expanded', 'true');
}

function closeTitlebarMenus(): void {
  document.querySelectorAll<HTMLElement>('.menu-root.open').forEach((root) => {
    root.classList.remove('open');
    root.querySelector<HTMLButtonElement>('.menu-trigger')?.setAttribute('aria-expanded', 'false');
  });
  closeMoreMenu();
}

function updateDockMenuState(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
    const shared = panelId === 'contentBrowser' || panelId === 'runtime';
    const open = shared
      ? Boolean(workbenchFrame?.isOpen(panelId) || docking?.isOpen(panelId))
      : workbenchFrame?.isOpen(panelId) ?? false;
    button.setAttribute('aria-checked', String(open));
    button.classList.toggle('checked', open);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-dock-panel]').forEach((button) => {
    const panelId = button.dataset.dockPanel as DockPanelId;
    const open = docking?.isOpen(panelId) ?? false;
    button.setAttribute('aria-checked', String(open));
    button.classList.toggle('checked', open);
  });
}

function toggleSharedPanel(panelId: SharedDockPanelId): void {
  sharedPanelDockBridge?.toggle(panelId);
}

function popoutActivePanel(): void {
  const outerPanel = workbenchFrame?.activePanelId();
  if (outerPanel && outerPanel !== 'workflow') workbenchFrame?.popout(outerPanel);
  else docking?.popoutActivePanel();
}

async function refreshDebugSettings(): Promise<void> {
  const settings = await api.getDebugSettings();
  settingsDebugEnabled.checked = settings.enabled;
  settingsDebugAnnotate.checked = settings.annotateScreenshots;
  settingsDebugAnnotate.disabled = !settings.enabled;
}

function openSettingsPanel(): void {
  settingsContentView.value = contentBrowserView;
  settingsAutoRefresh.checked = autoRefreshInstances;
  settingsDefaultWorkflow.checked = loadDefaultWorkflowOnStart;
  void refreshDebugSettings().catch((error) => showToast(`读取 Debug 设置失败：${String(error)}`));
  workbenchFrame?.show('settings');
  window.setTimeout(() => workbenchFrame?.popout('settings'), 0);
}

/** 打开独立窗口的模拟器画面测试工具（实时画面 / 模板匹配 / ROI / 点击位置测试）。 */
async function openVisionTest(): Promise<void> {
  if (visionTestOpening) return;
  if (!selectedInstance) {
    showToast('未检测到运行实例，请先启动 MuMu 模拟器', true);
    return;
  }
  visionTestOpening = true;
  try {
    await api.openVisionTest(selectedInstance);
  } catch (error) {
    showToast(`打开画面测试工具失败：${errorMessage(error)}`, true);
  } finally {
    visionTestOpening = false;
  }
}

function readSettings(): void {
  autoRefreshInstances = window.localStorage.getItem('onmyoji-studio.settings.auto-refresh') !== 'false';
  loadDefaultWorkflowOnStart = window.localStorage.getItem('onmyoji-studio.settings.default-workflow') !== 'false';
}

function restartInstanceRefresh(): void {
  if (instanceRefreshTimer !== undefined) {
    window.clearInterval(instanceRefreshTimer);
    instanceRefreshTimer = undefined;
  }
  if (autoRefreshInstances) {
    instanceRefreshTimer = window.setInterval(() => void refreshInstances(), 5000);
  }
}

function bindUi(): void {
  document.querySelectorAll<HTMLElement>('[data-editor-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = button.dataset.editorCommand ?? '';
      if (command === 'workflowSettings') {
        docking?.showPanel('details');
        // 工作流设置属于详细信息面板自己的 inspector 状态，不能只发给画布 iframe。
        postToFrame(detailsFrame, { type: 'editorCommand', command });
      }
      editorCommand(command);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-desktop-command]').forEach((button) => {
    button.addEventListener('click', () => desktopControl(button.dataset.desktopCommand ?? ''));
  });
  document.querySelectorAll<HTMLElement>('[data-app-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.appCommand === 'settings') openSettingsPanel();
      if (button.dataset.appCommand === 'visionTest') void openVisionTest();
    });
  });
  settingsContentView.addEventListener('change', () => {
    contentBrowserView = settingsContentView.value === 'list' ? 'list' : 'grid';
    window.localStorage.setItem('onmyoji-studio.content-browser-view', contentBrowserView);
    renderContentBrowser();
  });
  settingsAutoRefresh.addEventListener('change', () => {
    autoRefreshInstances = settingsAutoRefresh.checked;
    window.localStorage.setItem('onmyoji-studio.settings.auto-refresh', String(autoRefreshInstances));
    restartInstanceRefresh();
  });
  settingsDefaultWorkflow.addEventListener('change', () => {
    loadDefaultWorkflowOnStart = settingsDefaultWorkflow.checked;
    window.localStorage.setItem('onmyoji-studio.settings.default-workflow', String(loadDefaultWorkflowOnStart));
  });
  const saveDebugSettings = async (): Promise<void> => {
    settingsDebugEnabled.disabled = true;
    settingsDebugAnnotate.disabled = true;
    try {
      const settings = await api.updateDebugSettings({
        enabled: settingsDebugEnabled.checked,
        annotateScreenshots: settingsDebugAnnotate.checked,
      });
      settingsDebugEnabled.checked = settings.enabled;
      settingsDebugAnnotate.checked = settings.annotateScreenshots;
      showToast(settings.enabled ? 'Debug 逐步截图已开启，下次运行生效' : 'Debug 逐步截图已关闭');
    } catch (error) {
      showToast(`保存 Debug 设置失败：${String(error)}`);
      await refreshDebugSettings().catch(() => undefined);
    } finally {
      settingsDebugEnabled.disabled = false;
      settingsDebugAnnotate.disabled = !settingsDebugEnabled.checked;
    }
  };
  settingsDebugEnabled.addEventListener('change', () => void saveDebugSettings());
  settingsDebugAnnotate.addEventListener('change', () => void saveDebugSettings());
  document.querySelectorAll<HTMLButtonElement>('[data-dock-panel]').forEach((button) => {
    button.addEventListener('click', () => docking?.togglePanel(button.dataset.dockPanel as DockPanelId));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-workbench-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const panelId = button.dataset.workbenchPanel as WorkbenchPanelId;
      if (panelId === 'settings') {
        if (workbenchFrame?.isOpen('settings')) workbenchFrame.toggle('settings');
        else openSettingsPanel();
      }
      else if (panelId === 'referenceViewer') {
        if (workbenchFrame?.isOpen('referenceViewer')) closeReferenceViewer();
        else if (currentUri) {
          const relative = relativeToProject(displayFileUri(currentUri));
          if (relative) openReferenceViewer(relative, document);
        }
      } else if (panelId === 'contentBrowser' || panelId === 'runtime') {
        toggleSharedPanel(panelId);
      } else if (panelId !== 'workflow') {
        workbenchFrame?.toggle(panelId);
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-dock-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.dockCommand === 'popoutActive') popoutActivePanel();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-layout-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.layoutCommand === 'reset') docking?.resetLayout();
      if (button.dataset.layoutCommand === 'reset') workbenchFrame?.resetLayout();
      if (button.dataset.layoutCommand === 'reset') sharedPanelDockBridge?.resetSurfaces();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.menu-trigger').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const root = trigger.closest<HTMLElement>('.menu-root')!;
      const shouldOpen = !root.classList.contains('open');
      closeTitlebarMenus();
      root.classList.toggle('open', shouldOpen);
      trigger.setAttribute('aria-expanded', String(shouldOpen));
    });
    trigger.closest<HTMLElement>('.menu-root')!.addEventListener('mouseenter', () => {
      if (!document.querySelector('.menu-root.open')) return;
      closeTitlebarMenus();
      const root = trigger.closest<HTMLElement>('.menu-root')!;
      root.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    });
  });
  document.querySelectorAll<HTMLElement>('.titlebar-dropdown').forEach((menu) => {
    menu.addEventListener('click', () => closeTitlebarMenus());
  });
  document.querySelectorAll<HTMLElement>('[data-window-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.windowCommand === 'minimize') void api.minimizeWindow();
      if (button.dataset.windowCommand === 'toggleMaximize') void api.toggleMaximizeWindow().then(updateMaximizedState);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-left-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-left-tab]').forEach((item) => item.classList.toggle('active', item === tab));
      structureView.classList.toggle('hidden', tab.dataset.leftTab !== 'structure');
      document.querySelector<HTMLElement>('#palette-view')!.classList.toggle('hidden', tab.dataset.leftTab !== 'palette');
    });
  });
  document.querySelector('#structure-expand-all')!.addEventListener('click', () => setAllTreeBranches(true));
  document.querySelector('#structure-collapse-all')!.addEventListener('click', () => setAllTreeBranches(false));
  document.querySelector('#add-input-button')!.addEventListener('click', () => editorCommand('addVariable', 'inputs'));
  document.querySelector('#add-variable-button')!.addEventListener('click', () => editorCommand('addVariable', 'variables'));
  document.querySelector('#new-workflow-button')!.addEventListener('click', () => void handleEditorMessage({ type: 'newWorkflow' }, editorFrame));
  document.querySelector('#run-button')!.addEventListener('click', () => desktopControl('run'));
  document.querySelector('#stop-button')!.addEventListener('click', () => {
    if (overviewRun?.active) void stopOverviewQueue();
    else desktopControl('stop');
  });
  document.querySelector('#save-button')!.addEventListener('click', () => desktopControl('save'));
  document.querySelector<HTMLButtonElement>('#more-button')!.addEventListener('click', (event) => {
    event.stopPropagation();
    const button = event.currentTarget as HTMLButtonElement;
    if (moreMenu) closeMoreMenu();
    else showMoreMenu(button);
  });
  document.querySelector('#window-minimize')!.addEventListener('click', () => void api.minimizeWindow());
  document.querySelector('#window-maximize')!.addEventListener('click', async () => updateMaximizedState(await api.toggleMaximizeWindow()));
  document.querySelector('#window-close')!.addEventListener('click', () => void api.closeWindow());
  instanceSelect.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleInstancePicker();
  });
  instanceSelect.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeInstancePicker(true);
    } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleInstancePicker();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (!instancePicker.contains(target) && !instanceMenu.contains(target)) closeInstancePicker();
  }, true);
  window.addEventListener('resize', () => closeInstancePicker());
  window.addEventListener('scroll', () => closeInstancePicker(), true);
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
  document.querySelector('#content-browser-up')!.addEventListener('click', () => navigateContentBrowser(contentParent(contentBrowserFolder)));
  document.querySelector('#content-browser-refresh')!.addEventListener('click', () => void refreshContentBrowser());
  contentBrowserSearch.addEventListener('input', () => {
    contentBrowserQuery = contentBrowserSearch.value;
    selectedContentPath = '';
    renderContentBrowser();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-content-view]').forEach((button) => {
    button.addEventListener('click', () => {
      contentBrowserView = button.dataset.contentView === 'list' ? 'list' : 'grid';
      window.localStorage.setItem('onmyoji-studio.content-browser-view', contentBrowserView);
      renderContentBrowser();
    });
  });
  document.addEventListener('click', closeTitlebarMenus);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!overviewConfigModal.classList.contains('hidden')) closeOverviewConfiguration();
      closeTitlebarMenus();
      closeInstancePicker(true);
    }
    if (event.shiftKey && event.key === 'F6') {
      event.preventDefault();
      popoutActivePanel();
    }
  });
  window.addEventListener('blur', () => {
    closeTitlebarMenus();
    closeInstancePicker();
  });
}

window.addEventListener('message', (event: MessageEvent<EditorEnvelope>) => {
  const runtimeEnvelope = event.data as RuntimeLogEnvelope;
  if (event.source === runtimeLogFrame.contentWindow && runtimeEnvelope.source === 'desktop-run-log') {
    const type = runtimeEnvelope.message?.type;
    if (type === 'ready') {
      runtimeLogReady = true;
      sendRuntimeLogInit();
    } else if (type === 'stopWorkflow') {
      void api.stopWorkflow();
    } else if (type === 'clear') {
      clearRuntimeLog();
    }
    return;
  }

  const sourceFrame = event.data?.source === 'dockview-popout'
    ? event.data.frameId === editorFrame.id
      ? editorFrame
      : event.data.frameId === detailsFrame.id
        ? detailsFrame
        : undefined
    : event.source === editorFrame.contentWindow
      ? editorFrame
      : event.source === detailsFrame.contentWindow
        ? detailsFrame
        : undefined;
  if (!sourceFrame) return;
  if ((event.data?.source === 'legacy-editor' || event.data?.source === 'dockview-popout') && event.data.message) {
    void handleEditorMessage(event.data.message, sourceFrame);
  }
  if (event.data?.source === 'legacy-editor-state' || event.data?.source === 'dockview-popout' && event.data.state) {
    const frameDirty = Boolean(event.data.state?.dirty);
    if (sourceFrame === editorFrame || frameDirty) setDirty(frameDirty);
  }
});

async function start(): Promise<void> {
  const showPopoutFailure = (): void => showToast('无法打开独立模块窗口', true);
  installCustomTooltips();
  workbenchFrame = createWorkbenchFrame(updateDockMenuState, showPopoutFailure);
  docking = createDockingWorkspace(updateDockMenuState, showPopoutFailure);
  sharedPanelDockBridge = connectSharedPanelDocking(docking, workbenchFrame, updateDockMenuState);
  updateDockMenuState();
  createIcons({ icons: desktopIcons });
  bindUi();
  api.onRuntimeOutput(appendOutput);
  api.onRuntimeState(updateRuntimeState);
  api.onRunEvent((event) => {
    runtimeLogEvents.push(event);
    if (runtimeLogEvents.length > 5000) runtimeLogEvents = runtimeLogEvents.slice(-5000);
    postToRuntimeLog({ type: 'runEvent', event });
    postToEditors({ type: 'runEvent', event });
  });
  api.onWindowMaximized(updateMaximizedState);
  updateMaximizedState(await api.isWindowMaximized());
  try {
    const [bootstrapData, assets] = await Promise.all([api.bootstrap(), api.listAssets()]);
    bootstrap = bootstrapData;
    contentAssets = assets;
    readSettings();
    contentBrowserView = window.localStorage.getItem('onmyoji-studio.content-browser-view') === 'list' ? 'list' : 'grid';
    renderWorkflowSelect(bootstrap.workflows);
    renderInstances(bootstrap.instances);
    reconcileOverviewSelection(true);
    reconcileOverviewConfigurations(true);
    renderOverview();
    renderSidebar();
    renderContentBrowser();
    document.querySelector<HTMLElement>('#settings-project-root')!.textContent = bootstrap.projectRoot;
    setStatus('桌面端已连接');
    if (loadDefaultWorkflowOnStart && editorReady && bootstrap.defaultWorkflow) await loadWorkflow(bootstrap.defaultWorkflow);
    else postToEditors({ type: 'desktopPing' });
    restartInstanceRefresh();
  } catch (error) {
    loadingMask.classList.add('hidden');
    showToast(errorMessage(error), true);
    setStatus('初始化失败');
  }
}

window.addEventListener('beforeunload', () => {
  if (instanceRefreshTimer !== undefined) window.clearInterval(instanceRefreshTimer);
  sharedPanelDockBridge?.dispose();
  docking?.dispose();
  workbenchFrame?.dispose();
});

void start();
