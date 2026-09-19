/**
 * 概览卡片渲染：从 overview.ts 抽出的单卡片组装。
 * 选中态、运行态、名称/校验/更新时间与回调都由调用方注入，
 * 卡片细节不再埋在 overview.ts 的上千行里，也能脱离 DOM 单独测试。
 */
import type { WorkflowDescriptor } from '../../shared/contracts';

export type OverviewItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

/** 卡片只需要 createElement；真实 document 与测试桩都能满足。 */
export interface OverviewCardDocument {
  createElement(tag: string): any;
}

export interface OverviewCardDeps {
  document: OverviewCardDocument;
  /** 该工作流在选中队列里的下标，未选中为 -1。 */
  selectedIndex(rel: string): number;
  /** 执行队列是否正在运行（运行中锁住选择与配置）。 */
  isRunning(): boolean;
  runItem(rel: string): { status?: OverviewItemStatus } | undefined;
  workflowName(workflow: WorkflowDescriptor): string;
  workflowKind(workflow: WorkflowDescriptor): string;
  workflowValidation(workflow: WorkflowDescriptor): { label: string; title: string; className: string };
  workflowUpdated(workflow: WorkflowDescriptor): string | undefined;
  configuredInputs(workflow: WorkflowDescriptor): Record<string, unknown> | undefined;
  statusLabel(status: OverviewItemStatus | undefined, selected: boolean): string;
  updateSelection(rel: string, checked: boolean): void;
  openConfiguration(workflow: WorkflowDescriptor): void;
  openWorkflow(workflow: WorkflowDescriptor): void;
}

export function renderOverviewCard(deps: OverviewCardDeps, workflow: WorkflowDescriptor): HTMLElement {
  const { document } = deps;
  const rel = workflow.rel;
  const selectedIndex = deps.selectedIndex(rel);
  const selected = selectedIndex >= 0;
  const runItem = deps.runItem(rel);
  const status = runItem?.status;
  const locked = deps.isRunning();
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
  checkbox.setAttribute('aria-label', `选择 ${deps.workflowName(workflow)}`);
  checkbox.addEventListener('change', () => deps.updateSelection(rel, checkbox.checked));
  const title = document.createElement('div');
  title.className = 'overview-card-title';
  const strong = document.createElement('strong');
  strong.textContent = deps.workflowName(workflow);
  strong.title = deps.workflowName(workflow);
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
  kind.textContent = deps.workflowKind(workflow);
  const inputs = document.createElement('span');
  inputs.className = 'overview-card-tag';
  inputs.textContent = `${workflow.inputs?.length ?? 0} 个输入`;
  const validation = deps.workflowValidation(workflow);
  const validationTag = document.createElement('span');
  validationTag.className = `overview-card-tag workflow-validation-${validation.className}`;
  validationTag.textContent = validation.label;
  validationTag.title = validation.title;
  const updated = deps.workflowUpdated(workflow);
  const updatedTag = updated ? document.createElement('span') : undefined;
  if (updatedTag && updated !== undefined) {
    updatedTag.className = 'overview-card-tag workflow-updated';
    updatedTag.textContent = updated;
    updatedTag.title = `文件更新时间：${new Date(workflow.updatedAt!).toLocaleString('zh-CN')}`;
  }
  const configure = document.createElement('button');
  const configured = Boolean(deps.configuredInputs(workflow));
  configure.className = `overview-card-config${configured ? ' configured' : ''}`;
  configure.type = 'button';
  configure.textContent = configured ? '已配置' : '配置';
  configure.disabled = locked;
  configure.addEventListener('click', (event: any) => {
    event.stopPropagation();
    deps.openConfiguration(workflow);
  });
  const open = document.createElement('button');
  open.className = 'overview-card-open';
  open.type = 'button';
  open.textContent = '编辑';
  open.addEventListener('click', (event: any) => {
    event.stopPropagation();
    deps.openWorkflow(workflow);
  });
  const state = document.createElement('span');
  state.className = 'overview-card-status';
  state.textContent = deps.statusLabel(status, selected);
  metadata.append(kind, inputs, validationTag);
  if (updatedTag) metadata.appendChild(updatedTag);
  const actions = document.createElement('div');
  actions.className = 'overview-card-actions';
  actions.append(configure, open);
  footer.append(state, actions);
  card.append(header, description, metadata, footer);

  card.addEventListener('click', (event: any) => {
    if (locked || (event.target as Element).closest('button, input')) return;
    deps.updateSelection(rel, !selected);
  });
  card.addEventListener('dblclick', (event: any) => {
    if ((event.target as Element).closest('button, input')) return;
    deps.openWorkflow(workflow);
  });
  card.addEventListener('keydown', (event: any) => {
    if (event.target !== card) return;
    if (locked || event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    deps.updateSelection(rel, !selected);
  });
  return card;
}
