/**
 * 值卡片（布尔判断 / 拆分）的**进阶**编辑内容：嵌套条件表达式与拆分字段映射。
 *
 * UE 里这类节点没有详情面板（`K2Node_BreakStruct` / `K2Node_PromotableOperator` 都没有
 * IDetailCustomization）：结构体/运算符走节点右键菜单，值就在引脚上编辑。这里只保留
 * UE 没有对应物的两件进阶能力——`fields` 字段映射与 and/or/not 嵌套条件——
 * 由卡片右键菜单里的「进阶…」入口打开。
 */

export interface ValueCardFieldDeps {
  el(tag: string, className?: string, text?: string): any;
  field(parent: any, label: string): any;
  section(parent: any, title: string): any;
  textInput(value: unknown, onChange: (value: string) => void, options?: { className?: string }): any;
  iconButton(className: string, tip: string, icon: string, onClick: () => void): any;
  addRowButton(label: string, onClick: () => void): any;
  conditionControl(value: any, onChange: (value: any) => void, ctx?: any): any;
  conditionToText(expression: any): string;
  referenceLabel(ref: string): string;
  mutate(fn: () => void): void;
}

/** 布尔判断卡片：只有一个条件表达式，结果登记为 `nodes.<id>.output.value`。 */
export function renderBoolJudgeFields(body: any, node: any, deps: ValueCardFieldDeps): void {
  const { el, field, conditionControl, conditionToText, mutate } = deps;
  const row = field(body, '判断条件');
  row.classList.add('tall-control');
  row.appendChild(conditionControl(node.expression === undefined ? { eq: [1, 1] } : node.expression, (value) => mutate(() => { node.expression = value; }), { node }));
  // 中文回读是给新手的保险：只要这句话读得通，条件就是对的。
  const text = conditionToText(node.expression);
  if (text) body.appendChild(el('div', 'condition-readback', `当 ${text} 时为真`));
  body.appendChild(el('div', 'field-hint', `输出引用：nodes.${node.id || ''}.output.value`));
}

/** 拆分卡片：按字段列表把来源输出拆成可单独引用的引用（UE 没有的进阶能力）。 */
export function renderBreakFields(body: any, node: any, deps: ValueCardFieldDeps): void {
  const { el, field, section, textInput, iconButton, addRowButton, referenceLabel, mutate } = deps;
  // 来源只做回读：UE 里结构体是创建时选的 / 拖引脚确定的，用卡片右键菜单「更改拆分来源」改。
  const binding = node.ref && typeof node.ref === 'object' && !Array.isArray(node.ref) && typeof node.ref.ref === 'string' ? String(node.ref.ref) : '';
  body.appendChild(el('div', 'field-hint', binding ? `拆分来源：${referenceLabel(binding)}（右键卡片可更改）` : '未绑定来源：把来源卡片的输出口拖到「拆分来源」行，或右键卡片选择来源'));
  const fields = node.fields && typeof node.fields === 'object' && !Array.isArray(node.fields)
    ? node.fields as Record<string, unknown>
    : null;
  const entries = fields ? Object.entries(fields) : [];
  section(body, `拆分字段（${entries.length ? `${entries.length} 项` : '未设置 · 输出镜像来源'}）`);
  const wrap = el('div', 'object-array');
  entries.forEach(([name, path], index) => {
    const card = el('div', 'object-array-card');
    const head = el('div', 'object-array-head');
    head.appendChild(el('span', 'object-array-title', `字段 ${index + 1}`));
    const actions = el('div', 'object-array-actions');
    actions.appendChild(iconButton('object-array-remove', '删除该字段', 'trash', () => mutate(() => {
      const next: Record<string, unknown> = { ...(node.fields as Record<string, unknown>) };
      // 按行号找当前键名：改名会让闭包里的旧键过期，行号才是行的稳定身份。
      const currentName = Object.keys(next)[index];
      if (currentName === undefined) return;
      delete next[currentName];
      if (Object.keys(next).length) node.fields = next;
      else delete node.fields;
    })));
    head.appendChild(actions);
    card.appendChild(head);
    const nameRow = field(card, '输出字段名');
    nameRow.appendChild(textInput(name, (value) => mutate(() => {
      const text = String(value || '').trim();
      const next: Record<string, unknown> = { ...(node.fields as Record<string, unknown>) };
      const currentName = Object.keys(next)[index];
      if (currentName === undefined) return;
      const currentPath = next[currentName];
      delete next[currentName];
      if (text) next[text] = currentPath;
      if (Object.keys(next).length) node.fields = next;
      else delete node.fields;
    }), { className: 'full' }));
    const pathRow = field(card, '来源路径');
    pathRow.appendChild(textInput(String(path ?? ''), (value) => mutate(() => {
      const next: Record<string, unknown> = { ...(node.fields as Record<string, unknown>) };
      const currentName = Object.keys(next)[index];
      if (currentName === undefined) return;
      next[currentName] = String(value || '').trim();
      node.fields = next;
    }), { className: 'full' }));
    wrap.appendChild(card);
  });
  wrap.appendChild(addRowButton('添加字段', () => mutate(() => {
    // 从 node.fields 现读：不能沿用渲染时捕获的快照，改名/加行后快照就过期了。
    const current = node.fields && typeof node.fields === 'object' && !Array.isArray(node.fields)
      ? node.fields as Record<string, unknown>
      : {};
    const next: Record<string, unknown> = { ...current };
    let name = 'field_1';
    let counter = 1;
    while (Object.prototype.hasOwnProperty.call(next, name)) { counter += 1; name = `field_${counter}`; }
    next[name] = '';
    node.fields = next;
  })));
  body.appendChild(wrap);
  body.appendChild(el('div', 'field-hint', '来源路径用点号逐层深入：value、items.0.score（0 是数组第 1 项）。字段名是输出引用的最后一层：nodes.<id>.output.<字段名>。'));
}
