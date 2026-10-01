import { emptyEditingLibrary, literalPresetParams, parseEditingLibrary, type ActionPreset, type EditingLibraryChange } from '../../shared/editing-library';
import type { CanvasBridge } from '../bridge';
import { editingDialog, editingElement as el } from '../ui/editing-dialog';
import { planParameterReplacement, replacementStillCurrent } from '../model/parameter-replacement';
import { nodeReferenceValidator, parameterValueAccepted } from '../model/parameter-edits';

export interface CreationContext { connection?: any; reference?: any; point?: { x: number; y: number } }
export interface CreationChoice { id: string; title: string; type: string; action?: string; params?: Record<string, unknown>; preset?: ActionPreset; description?: string }
export interface EfficiencyDeps {
  state: any; bridge: CanvasBridge;
  nodes(): any[];
  actionLabel(name: string): string;
  fieldLabel(name: string): string;
  typeNames: Record<string, string>;
  accept(choice: CreationChoice, context: CreationContext): boolean;
  create(choice: CreationChoice, context: CreationContext): boolean;
  createAsset(path: string, mode: 'wait' | 'match' | 'click', point: { x: number; y: number }): boolean;
  applyPreset(preset: ActionPreset): boolean;
  mutate(fn: () => void): void;
  clearParameterLiteralCache(nodeId: string, name?: string): void;
  toast(message: string, error?: boolean): void;
}

export function createEfficiencyTools(deps: EfficiencyDeps) {
  let library = emptyEditingLibrary();
  let redraw: (() => void) | undefined;
  const update = (change: EditingLibraryChange) => deps.bridge.post({ type: 'updateEditingLibrary', change });
  deps.bridge.subscribe((message) => {
    if (message.type === 'init') deps.bridge.post({ type: 'getEditingLibrary' });
    if (message.type === 'editingLibrary') { library = parseEditingLibrary(message.library); redraw?.(); }
    if (message.type === 'editingLibraryError') deps.toast(String(message.error || '读取预设失败'), true);
  });
  const catalog = () => ({ byName: (name: string) => deps.state.catalog.find((item: any) => item.name === name), names: () => deps.state.catalog.map((item: any) => item.name) });
  const selected = () => deps.nodes().find((node) => deps.state.selected.size === 1 && deps.state.selected.has(node.id) && node.type === 'task');

  function savePreset(existing?: ActionPreset) {
    const node = selected();
    if (!existing && !node) { deps.toast('请先选择一个已配置的任务节点', true); return; }
    const { dialog, close } = editingDialog(existing ? '重命名项目预设' : '保存项目参数预设');
    const name = el('input', 'ui-input'); name.placeholder = '预设名称'; name.setAttribute('aria-label', '预设名称'); name.maxLength = 100; name.value = existing?.name || node.name || deps.actionLabel(node.action);
    dialog.append(name, el('p', 'field-hint', '预设可在本项目的其他工作流中使用。只保存固定参数值，变量和节点引用不会带入。'));
    const save = el('button', '', '保存预设'); save.type = 'button';
    const commit = () => {
      if (!name.value.trim()) { name.focus(); return; }
      const preset: ActionPreset = existing ? { ...existing, name: name.value.trim() } : { id: crypto.randomUUID(), name: name.value.trim(), action: node.action, params: literalPresetParams(node.params || {}), favorite: false };
      const definitions = catalog().byName(preset.action)?.parameters;
      if (!definitions || Object.entries(preset.params).some(([key, value]) => !definitions[key] || !parameterValueAccepted(definitions[key], value))) { deps.toast('参数不符合当前动作要求，请修正后再保存预设', true); return; }
      update({ op: 'save', preset }); close();
    };
    save.addEventListener('click', commit); name.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); } });
    dialog.append(save); name.focus(); name.select();
  }

  function openPicker(context: CreationContext = {}, initialScope = 'all') {
    const { overlay, dialog, close } = editingDialog(context.connection || context.reference ? '选择节点并自动连接' : '快捷创建节点 / 项目预设');
    const controls = el('div', 'editing-dialog-controls');
    const input = el('input', 'ui-input'); input.type = 'search'; input.placeholder = '搜索动作、节点类型或参数预设'; input.setAttribute('aria-label', '搜索新节点');
    const scope = el('select', 'ui-input'); scope.setAttribute('aria-label', '节点范围');
    for (const [value, text] of [['all', '全部'], ['favorites', '收藏'], ['recent', '最近使用'], ['presets', '项目预设']]) { const option = el('option', '', text); option.value = value; scope.append(option); }
    scope.value = initialScope;
    const save = el('button', '', '保存选中节点为预设'); save.type = 'button'; save.disabled = !selected(); save.addEventListener('click', () => { close(); savePreset(); });
    controls.append(input, scope, save);
    const hint = el('div', 'field-hint', '↑ ↓ 选择，回车创建。星标收藏；项目预设跨工作流共享。');
    const list = el('div', 'editing-choice-list'); dialog.append(controls, hint, list);
    let active = 0, visible: CreationChoice[] = [];
    const favorite = (choice: CreationChoice) => choice.preset ? choice.preset.favorite : Boolean(choice.action && library.favoriteActions.includes(choice.action));
    const create = (choice: CreationChoice) => {
      if (deps.create(choice, context)) { update({ op: 'use', id: choice.id }); close(); redraw = undefined; }
    };
    const render = () => {
      if (!overlay.isConnected) { redraw = undefined; return; }
      const choices: CreationChoice[] = [
        ...deps.state.catalog.map((item: any) => ({ id: `action:${item.name}`, title: deps.actionLabel(item.name), type: 'task', action: item.name, description: item.description })),
        ...['sequence', 'selector', 'condition', 'bool_judge', 'break', 'parallel', 'simple_parallel', 'branch', 'switch', 'repeat_until', 'state_machine', 'instance_parallel'].map((type) => ({ id: `type:${type}`, title: deps.typeNames[type] || type, type })),
        ...library.presets.map((preset) => ({ id: `preset:${preset.id}`, title: preset.name, type: 'task', action: preset.action, params: preset.params, preset })),
      ];
      const words = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      visible = choices.filter((choice) => {
        if (scope.value === 'presets' && !choice.preset) return false;
        if (scope.value === 'favorites' && !favorite(choice)) return false;
        if (scope.value === 'recent' && !library.recent.includes(choice.id)) return false;
        const text = `${choice.title} ${choice.action || choice.type} ${choice.description || ''}`.toLocaleLowerCase();
        return words.every((word) => text.includes(word)) && deps.accept(choice, context);
      }).sort((a, b) => {
        const rank = (item: CreationChoice) => library.recent.indexOf(item.id) < 0 ? 100 : library.recent.indexOf(item.id);
        return Number(favorite(b)) - Number(favorite(a)) || rank(a) - rank(b);
      });
      active = Math.min(active, Math.max(0, visible.length - 1)); list.replaceChildren();
      if (!visible.length) list.append(el('p', 'field-hint', '没有匹配项。可更换关键词或范围；拖线创建只显示兼容节点。'));
      visible.forEach((choice, index) => {
        const row = el('div', `editing-choice${index === active ? ' active' : ''}`);
        const button = el('button', 'editing-choice-main'); button.type = 'button';
        button.append(el('strong', '', choice.title), el('span', '', `${choice.preset ? '项目预设 · ' : ''}${choice.action || choice.type}`)); button.title = choice.description || choice.title;
        button.addEventListener('click', () => create(choice)); row.append(button);
        if (choice.action) {
          const star = el('button', '', favorite(choice) ? '★' : '☆'); star.type = 'button'; star.setAttribute('aria-label', `${favorite(choice) ? '取消收藏' : '收藏'} ${choice.title}`); star.addEventListener('click', () => update({ op: 'favorite', id: choice.id })); row.append(star);
        }
        if (choice.preset) {
          const apply = el('button', '', '套用'); apply.type = 'button'; apply.title = '应用到同动作的选中任务节点'; apply.disabled = selected()?.action !== choice.action;
          apply.addEventListener('click', () => { if (deps.applyPreset(choice.preset!)) { update({ op: 'use', id: choice.id }); close(); } });
          const rename = el('button', '', '改名'); rename.type = 'button'; rename.addEventListener('click', () => { close(); savePreset(choice.preset); });
          const remove = el('button', '', '删除'); remove.type = 'button'; remove.addEventListener('click', () => { if (window.confirm(`删除项目预设「${choice.title}」？已创建的节点会保留。`)) update({ op: 'remove', id: choice.preset!.id }); });
          row.append(apply, rename, remove);
        }
        list.append(row);
      });
    };
    input.addEventListener('input', () => { active = 0; render(); }); scope.addEventListener('change', () => { active = 0; render(); });
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, Math.min(visible.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))); render(); list.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); }
      if (event.key === 'Enter' && visible[active]) { event.preventDefault(); create(visible[active]); }
    });
    redraw = render; render(); input.focus(); deps.bridge.post({ type: 'getEditingLibrary' });
  }

  function dropAsset(path: string, point: { x: number; y: number }) {
    path = path.replace(/\\/g, '/');
    if (!/^assets\/.+\.(png|jpe?g|bmp|webp)$/i.test(path) || path.split('/').includes('..')) return;
    const { dialog, close } = editingDialog('用模板图片创建节点');
    dialog.append(el('p', 'editing-asset-path', path));
    for (const [mode, text, required] of [
      ['wait', '等待图片出现', ['vision.wait_template']],
      ['match', '判断图片是否存在', ['vision.match_template']],
      ['click', '等待出现并点击', ['vision.wait_template', 'input.tap_match']],
    ] as const) {
      const button = el('button', 'full-command', text); button.type = 'button'; button.disabled = !required.every((action) => catalog().byName(action));
      button.addEventListener('click', () => { if (deps.createAsset(path, mode, point)) close(); }); dialog.append(button);
    }
  }

  function openReplacement(find = '') {
    const { dialog, close } = editingDialog('搜索并批量替换参数');
    dialog.append(el('p', 'field-hint', '范围为当前工作流的已配置固定参数（含数组、对象）；不会改动变量或节点引用。先预览并勾选，再统一替换。'));
    const controls = el('div', 'editing-replacement-controls');
    const makeInput = (label: string, value = '') => { const input = el('input', 'ui-input'); input.placeholder = label; input.setAttribute('aria-label', label); input.value = value; controls.append(input); return input; };
    const oldValue = makeInput('查找值', find), newValue = makeInput('替换为'), param = makeInput('参数名（可留空）');
    const action = el('select', 'ui-input'); action.setAttribute('aria-label', '限制动作'); const all = el('option', '', '全部动作'); all.value = ''; action.append(all);
    for (const spec of deps.state.catalog) { const option = el('option', '', deps.actionLabel(spec.name)); option.value = spec.name; action.append(option); }
    const mode = el('select', 'ui-input'); mode.setAttribute('aria-label', '匹配方式');
    for (const [value, title] of [['exact', '完整值匹配'], ['text', '文本中的片段']]) { const option = el('option', '', title); option.value = value; mode.append(option); }
    const preview = el('button', '', '预览替换'); preview.type = 'button'; controls.append(action, mode, preview);
    const status = el('p', 'field-hint'), list = el('div', 'editing-replacement-list'), apply = el('button', '', '确认替换'); apply.type = 'button'; apply.disabled = true;
    dialog.append(controls, status, list, apply);
    let plan: ReturnType<typeof planParameterReplacement> = [], checked = new Set<number>();
    const invalidate = () => { plan = []; checked.clear(); list.replaceChildren(); status.textContent = '点击预览查看将要改动的参数。'; apply.disabled = true; };
    const count = () => { apply.disabled = !checked.size; apply.textContent = `确认替换 ${checked.size} 个参数`; };
    for (const control of [oldValue, newValue, param, action, mode]) control.addEventListener('input', invalidate);
    preview.addEventListener('click', () => {
      plan = planParameterReplacement(deps.state.raw, deps.nodes(), catalog(), { find: oldValue.value, replacement: newValue.value, mode: mode.value as 'exact' | 'text', action: action.value, param: param.value.trim() });
      checked.clear(); list.replaceChildren();
      status.textContent = `${plan.length} 个参数匹配，其中 ${plan.filter((entry) => entry.error).length} 个不符合要求；可取消勾选不需要修改的项。`;
      plan.forEach((entry, index) => {
        const row = el('label', 'editing-replacement-row'); const check = el('input'); check.type = 'checkbox'; check.disabled = Boolean(entry.error); check.checked = !entry.error;
        if (check.checked) checked.add(index);
        check.addEventListener('change', () => { if (check.checked) checked.add(index); else checked.delete(index); count(); });
        const node = deps.nodes().find((item) => item.id === entry.nodeId);
        const text = el('div'); text.append(el('strong', '', `${node?.name || entry.nodeId} · ${deps.fieldLabel(entry.param)} (${entry.count} 处)`), el('pre', '', `${JSON.stringify(entry.before)}\n→ ${JSON.stringify(entry.after)}`));
        if (entry.error) text.append(el('span', 'editing-error', entry.error)); row.append(check, text); list.append(row);
      }); count();
    });
    apply.addEventListener('click', () => {
      const changes = plan.filter((_, index) => checked.has(index));
      if (!changes.length) return;
      if (!replacementStillCurrent(deps.nodes(), changes)) { deps.toast('参数已发生变化，请重新预览后替换', true); invalidate(); return; }
      for (const entry of changes) {
        const node = deps.nodes().find((item) => item.id === entry.nodeId), def = catalog().byName(node.action)?.parameters?.[entry.param];
        if (!def || !parameterValueAccepted(def, entry.after, nodeReferenceValidator(deps.state.raw, catalog(), node.id))) { deps.toast('参数定义或引用发生了变化，请重新预览', true); invalidate(); return; }
      }
      deps.mutate(() => { for (const entry of changes) { deps.nodes().find((node) => node.id === entry.nodeId).params[entry.param] = JSON.parse(JSON.stringify(entry.after)); deps.clearParameterLiteralCache(entry.nodeId, entry.param); } });
      deps.toast(`已替换 ${changes.length} 个参数，可用 Ctrl+Z 一次撤销`); close();
    });
    invalidate(); oldValue.focus();
  }
  return { openPicker, savePreset, dropAsset, openReplacement };
}
