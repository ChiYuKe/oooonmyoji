import type { CanvasState } from '../state/canvas-state';
import type { CanvasBridge } from '../bridge';
import { documentText } from '../state/document-text';
import { editingDialog, editingElement as el } from '../ui/editing-dialog';
import { planReusableFunction, type ReusableFunctionPlan } from '../model/reusable-function';

export function createReusableFunctions(deps: {
  state: CanvasState; bridge: CanvasBridge;
  mutate(fn: () => void): void;
  toast(message: string, error?: boolean): void;
}) {
  const { state, bridge, mutate, toast } = deps;
  let pending: { requestId: string; uri: string; snapshot: string; plan: ReusableFunctionPlan; close(): void; button: HTMLButtonElement } | undefined;
  bridge.subscribe(message => {
    if (message.type !== 'reusableFunctionCreated' || !pending || message.requestId !== pending.requestId) return;
    const request = pending; pending = undefined;
    request.button.disabled = false;
    if (message.error) { toast(String(message.error), true); return; }
    if (state.docUri !== request.uri || documentText(state) !== request.snapshot) {
      request.close();
      toast('功能文件已创建；原流程在等待期间发生变化，请从“可复用功能”中添加调用节点', true);
      return;
    }
    mutate(() => {
      state.raw = request.plan.parent;
      state.selected = new Set([request.plan.nodeId]);
      state.selectedEdge = null; state.selectedRun = null;
      state.selectedVariableCardIds.clear(); state.selectedVariableCardId = '';
    });
    request.close();
    toast('已封装为可复用功能；原位置已接好输入和输出，可用 Ctrl+Z 撤销替换');
  });

  function extract(nodeId: string): void {
    if (!state.raw || pending) { if (pending) toast('正在创建功能文件，请稍候'); return; }
    const node = state.raw.nodes?.find((item: any) => item.id === nodeId);
    const catalog = { byName: (name: string) => state.catalog.find(item => item.name === name), names: () => state.catalog.map(item => item.name) };
    const id = `function_${crypto.randomUUID().replace(/-/g, '')}`;
    const nameValue = String(node?.name || '新功能');
    let plan: ReusableFunctionPlan;
    try { plan = planReusableFunction(state.raw, nodeId, nameValue, id, `functions/${nameValue}.owf`, catalog); }
    catch (error) { toast((error as Error).message, true); return; }
    const snapshot = documentText(state), uri = state.docUri;
    const { dialog, close } = editingDialog('封装为可复用功能');
    const name = el('input', 'ui-input'); name.value = nameValue; name.maxLength = 80; name.setAttribute('aria-label', '功能名称');
    const hint = el('p', 'field-hint', `包含入口及下游 ${plan.nodeCount} 个节点，自动接入 ${plan.inputs.length} 个输入。功能文件保存在 workflows/functions，其他工作流可直接调用。`);
    dialog.append(name, hint);
    if (plan.inputs.length) {
      const list = el('div', 'editing-choice-list');
      for (const input of plan.inputs) {
        const match = /^(inputs|variables)\.([^.]+)$/.exec(input.source);
        const sourceName = match ? state.raw?.[match[1]]?.[match[2]]?.display_name || match[2] : plan.child.inputs[input.name]?.display_name || input.name;
        list.append(el('p', 'field-hint', `${plan.child.inputs[input.name]?.display_name || input.name} ← ${sourceName}`));
      }
      dialog.append(list);
    }
    dialog.append(el('p', 'field-hint', '创建后原流程会替换为一张调用节点；双击它可编辑源功能。撤销会恢复原流程，功能文件仍保留。'));
    const button = el('button', '', '创建功能并替换'); button.type = 'button';
    const commit = () => {
      if (pending) return;
      const title = name.value.trim();
      if (!title || /[<>:"/\\|?*\x00-\x1f]/.test(title) || /[. ]$/.test(title)) { toast('请填写有效的功能名称', true); name.focus(); return; }
      if (state.docUri !== uri || documentText(state) !== snapshot) { toast('原流程已变化，请重新打开封装窗口', true); close(); return; }
      try { plan = planReusableFunction(state.raw!, nodeId, title, id, `functions/${title}.owf`, catalog); }
      catch (error) { toast((error as Error).message, true); return; }
      const requestId = crypto.randomUUID();
      button.disabled = true;
      pending = { requestId, uri, snapshot, plan, close, button };
      bridge.post({ type: 'createReusableFunction', requestId, name: title, text: documentText({ raw: plan.child }) });
    };
    button.addEventListener('click', commit);
    name.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); } });
    dialog.append(button); name.focus(); name.select();
  }
  return { extract };
}
