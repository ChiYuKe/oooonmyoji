/**
 * 变量连线的对账：参数里的 `variables.x` / `inputs.x` 引用应当有一条对应的
 * `_variableLinks` 连线项（值 = 变量卡片 id）。
 *
 * 为什么需要：连线项只在「从卡片拖到端点」这类路径上写入，走别的入口
 * （详情栏/参数行菜单里选变量、手工改 JSON、旧文档）绑出来的引用就会缺这一项。
 * 缺项不影响画连线（渲染会退回按引用匹配卡片），但会让「谁连着谁」的说明、
 * 断开与清理逻辑各说各话——同一件事出现两种描述。
 *
 * 纯函数：只按 id 规则补写，不依赖 state，方便单测。
 */

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bindingRef(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.ref !== 'string' || !value.ref) return '';
  // 只有「纯引用」（对象里只有 ref）才算画布连线；带别的一起写的是别的东西。
  return Object.keys(value).length === 1 ? value.ref : '';
}

/** 卡片 id → 它代表的引用（`variables.时长`），只收当前文档里确实存在的变量。 */
function cardReferences(raw: Record<string, any>): Map<string, string> {
  const cards = isRecord(raw._variableCards) ? raw._variableCards : {};
  const byId = new Map<string, string>();
  for (const [id, value] of Object.entries(cards)) {
    if (!isRecord(value)) continue;
    const name = typeof value.name === 'string' && value.name ? value.name : id;
    const scope = value.scope === 'variables' ? 'variables' : 'inputs';
    const scopeValues = isRecord(raw[scope]) ? raw[scope] : {};
    if (!Object.prototype.hasOwnProperty.call(scopeValues, name)) continue;
    byId.set(id, `${scope}.${name}`);
  }
  return byId;
}

/**
 * 补写缺失/失效的连线项。返回补写的条数。
 *
 * 「失效」= 指向不存在的卡片，或指向的卡片代表的引用与参数里的引用不一致
 * （例如参数已改绑到别的变量）。已经正确的连线项保持不动。
 */
export function reconcileVariableLinks(raw: unknown): number {
  if (!isRecord(raw)) return 0;
  const byId = cardReferences(raw);
  // 引用 → 卡片 id：同名多卡时取第一个，和渲染时画的线保持一致。
  const byRef = new Map<string, string>();
  for (const [id, ref] of byId) if (!byRef.has(ref)) byRef.set(ref, id);
  if (!isRecord(raw._variableLinks)) raw._variableLinks = {};
  const links = raw._variableLinks as Record<string, any>;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  let repaired = 0;

  const repair = (key: string, value: unknown): void => {
    const cardId = byRef.get(bindingRef(value));
    if (!cardId) return;
    const current = links[key];
    // 已经指向正确卡片：不动。指向别的**还活着**的卡片：可能是刻意选的重复卡片，也不动。
    if (current === cardId) return;
    if (typeof current === 'string' && byId.has(current) && byId.get(current) === bindingRef(value)) return;
    if (typeof current === 'string' && byId.has(current) && current !== cardId) return;
    links[key] = cardId;
    repaired += 1;
  };

  for (const node of nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id) continue;
    if (isRecord(node.params)) {
      for (const [param, value] of Object.entries(node.params)) repair(`${node.id}:${param}`, value);
    }
    if (Array.isArray(node.runs)) {
      node.runs.forEach((run, index) => {
        if (!isRecord(run) || !isRecord(run.inputs)) return;
        for (const [param, value] of Object.entries(run.inputs)) repair(`${node.id}:runs.${index}.inputs.${param}`, value);
      });
    }
  }
  return repaired;
}

/** 某个参数端点当前连着的变量卡片 id（没有连线项时为空串），供说明文案使用。 */
export function variableCardIdForLink(raw: unknown, nodeId: string, param: string): string {
  if (!isRecord(raw) || !isRecord(raw._variableLinks)) return '';
  const value = raw._variableLinks[`${nodeId}:${param}`];
  return typeof value === 'string' ? value : '';
}
