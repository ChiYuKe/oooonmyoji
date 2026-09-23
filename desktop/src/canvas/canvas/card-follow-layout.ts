/**
 * 「自动排列」之后的卡片/组内成员归位：不能留下任何「还在原地」的东西。
 *
 * 自动排列只重排**当前投影里的节点**（写 `_layout[nodeId]`）。这些东西不会自己跟着走：
 * - 变量卡片存的是自己的绝对坐标（`_variableCards[id].x/y`）；
 * - 折叠起来的节点组：组卡会被排进新网格，但组内成员的 `_layout` 不会更新，
 *   于是进组/解散组时成员又出现在空白处。
 * 而 `fitView` 的包围盒把这些还留在原地的对象也算进去，整张图会被缩得很小、
 * 东西孤零零飘在空白处——看起来就是「没显示，要滚动才找到」。
 *
 * 归位规则（只在用户主动「自动排列」时执行；载入时的兜底布局不碰这些坐标）：
 * - 变量卡片：跟着它绑定的节点搬同样的位移（同一节点上的卡片保持相对位置）；没有绑定的
 *   卡片按整张图的包围盒位移跟随（保持相对图左上角的偏移）。
 * - **跑到图外的卡片**（在画布远处、甚至几千像素外）：一律收回图的左侧一列，不再保留原来的
 *   偏移。只跟着位移走是不够的——卡片绑定的节点自己没动时位移是 0，卡片就留在原地，
 *   而 `fitView` 会把它算进包围盒，于是整张图被缩小、卡片孤零零飘在空白处，
 *   看起来与主图断开。
 * - 折叠的组：成员按组卡的位移整组平移，组内相对关系不变。
 * - **组内视图（进了某个组再排列）完全隔离**：只动本组成员的位移与挂在本组成员上的卡片；
 *   组卡在外层的坐标、组外节点与组外卡片一律不碰——外层布局是用户自己排的。
 * - **组内不画的卡片也不碰**：被组边界行代表的变量（`groupRepresentedRefs`）在组内视图里
 *   根本没有画布卡片（左侧边界卡的那一行代替了它），组内排列就不该改它的坐标——否则用户
 *   在组内看不见任何变化，出组才发现外层那张卡片被搬走了（「组内操作改了组外布局」）。
 *   这条规则必须与 `editor.variableCardList()` 的过滤规则同源。
 */

export interface FollowCardLayoutDeps {
  /** 工作流文档（读写 `_variableCards` / `_variableLinks` / `_nodeGroups`）。 */
  raw: any;
  /** 自动排列**之后**的布局表（含当前投影里的节点与节点组卡片）。 */
  layout: Record<string, any>;
  /** 自动排列**之前**的布局表快照；缺坐标的节点视为「没有旧位置」。 */
  previous: Record<string, any>;
  /** 当前投影里参与排列的节点（含折叠组卡，不含折叠起来的成员）。 */
  nodes(): Array<{ id: string }>;
  nodeHeight(node: any): number;
  /** 真实节点的变量端点；缺省时只按显式连线判断卡片归属。 */
  nodeVariablePins?(node: any): Array<{ param?: string; scope?: string; variable?: string }>;
  /** 参数行的几何：把卡片纵向对齐到它绑定的那一行（`baseHeight` + 行号×行高 + 行高/2）。 */
  baseHeight?: number;
  nodeRowHeight?(node: any): number;
  /** 变量卡输出口在卡片内的纵向位置，用来让连线落在卡片端口上。 */
  variableCardPortY?: number;
  nodeWidth: number;
  variableCardWidth: number;
  variableCardHeight: number;
  /**
   * 当前进着的节点组 id（`state.nodeGroupId`）。给了它就意味着这次排的是**组内视图**：
   * 只有本组成员的位移会作用到变量卡片上，组卡位置与组外卡片一律不碰——
   * 组外布局是用户在外层自己排的，进组排一次不该把外面也改掉。
   */
  groupScopeId?: string;
  /**
   * 组内视图里被「组边界行」代表的变量（`作用域.变量名`，即 `boundaryVariableRefs()`）：
   * 这些卡片在组内根本不画（组左侧边界卡的那一行代替了它），组内排列一律不碰它们的坐标。
   * 缺省（或不在组内）时为空——外层排列照旧处理所有卡片。
   */
  groupRepresentedRefs?: Set<string>;
}

export interface FollowCardLayoutResult {
  /** 被移动的变量卡片数。 */
  cards: number;
  /** 被重新居中的节点组卡片数。 */
  groups: number;
  /** 跟着组卡平移的组内成员数。 */
  members: number;
  /** 被收回图左侧的「跑远了」的卡片数。 */
  strays: number;
}

/** 卡片与节点坐标一律落在 8 的网格上（与放置/拖拽时的取整一致）。 */
const SNAP = 8;
/** 节点组卡片高度的一半：与打组时「成员包围盒中心 - 48」同一个常量。 */
const GROUP_CARD_HALF_HEIGHT = 48;
/** 图的余量：卡片可以停在图的边上，但跑到一个叶子间距以外就算「跑远了」。 */
const STRAY_MARGIN = 332;
/** 收回来的卡片之间的行距（卡片高度 58 + 14 的间隙）。 */
const CARD_STACK_GAP = 14;
/** 绑定卡片与所属节点之间的横向净空（与创建卡片时的 `- 卡片宽 - 56` 一致）。 */
const CARD_LANE_GAP = 56;
/** 卡片与节点/其它卡片之间至少要留的净空。 */
const CARD_CLEARANCE = 16;
/** 同一个参数行上多张卡片时依次尝试的纵向偏移（先正对齐，再上下错开）。 */
const CARD_SLOT_OFFSETS = [0, -72, 72, -144, 144];

const snap = (value: number): number => Math.round(value / SNAP) * SNAP;
const isFinitePoint = (value: any): boolean => Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.y);

/**
 * 卡片代表的变量引用（`作用域.变量名`）：与 `workflow-model.variableCardList()` /
 * `editor.variableCardList()` 的键完全同一套规则（缺省作用域 inputs、缺省名字用卡片 id），
 * 「组内画不画这张卡」与「组内排不排这张卡」才不会各说各话。
 */
function cardReferenceOf(id: string, card: any): string {
  const scope = card?.scope === 'variables' ? 'variables' : 'inputs';
  const name = typeof card?.name === 'string' && card.name ? card.name : id;
  return `${scope}.${name}`;
}

/**
 * 节点组卡片的位置：成员包围盒中心（与打组时同一个公式，打组与自动排列共用）。
 */
export function groupCardPosition(
  members: Array<{ pos: { x: number; y: number }; height: number }>,
  nodeWidth: number,
): { x: number; y: number } | null {
  const valid = members.filter((member) => isFinitePoint(member.pos));
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((member) => member.pos.x));
  const maxX = Math.max(...valid.map((member) => member.pos.x + nodeWidth));
  const minY = Math.min(...valid.map((member) => member.pos.y));
  const maxY = Math.max(...valid.map((member) => member.pos.y + member.height));
  return {
    x: snap((minX + maxX) / 2 - nodeWidth / 2),
    y: snap((minY + maxY) / 2 - GROUP_CARD_HALF_HEIGHT),
  };
}

function recordOf(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function nodeListOf(raw: any, fallback: Array<{ id: string }>): Array<{ id: string }> {
  return Array.isArray(raw?.nodes) ? raw.nodes as Array<{ id: string }> : fallback;
}

function groupTable(raw: any): Record<string, any> {
  return recordOf(raw?._nodeGroups);
}

/** 布局后可见节点的包围盒（含卡片尺寸），用来判「跑远了」和给收回来的卡片定位。 */
function nodeBox(
  nodes: Array<{ id: string }>,
  layout: Record<string, any>,
  nodeHeight: (node: any) => number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const boxes = nodes
    .map((node) => (isFinitePoint(layout[node.id]) ? { pos: layout[node.id], height: nodeHeight(node) } : null))
    .filter(Boolean) as Array<{ pos: { x: number; y: number }; height: number }>;
  if (!boxes.length) return null;
  return {
    minX: Math.min(...boxes.map((box) => box.pos.x)),
    minY: Math.min(...boxes.map((box) => box.pos.y)),
    maxX: Math.max(...boxes.map((box) => box.pos.x)),
    maxY: Math.max(...boxes.map((box) => box.pos.y + box.height)),
  };
}

/** 卡片是否还在图的范围内（外扩一个叶子间距）：超出这个范围就算跑远了。 */
function isWithinBox(card: { x: number; y: number }, box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return card.x >= box.minX - STRAY_MARGIN && card.x <= box.maxX + STRAY_MARGIN
    && card.y >= box.minY - STRAY_MARGIN && card.y <= box.maxY + STRAY_MARGIN;
}

/** 第 `index` 张被收回来的卡片落在图左侧第几列、第几行。 */
function straySlot(
  index: number,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  deps: { variableCardWidth: number; variableCardHeight: number },
): { x: number; y: number } {
  const step = deps.variableCardHeight + CARD_STACK_GAP;
  const height = Math.max(deps.variableCardHeight, box.maxY - box.minY);
  // 一列的高度与图相当，装不下就往左再起一列，收回来的卡片不会把画布撑得又窄又长。
  const rows = Math.max(1, Math.floor((height + deps.variableCardHeight) / step));
  const column = Math.floor(index / rows);
  const row = index % rows;
  return {
    x: snap(box.minX - (column + 1) * (deps.variableCardWidth + 56)),
    y: snap(box.minY + row * step),
  };
}

interface CardRect { x: number; y: number; width: number; height: number }

/** 两个矩形是否靠得太近（留出 `gap` 的净空）。 */
function tooClose(a: CardRect, b: CardRect, gap: number): boolean {
  return a.x - gap < b.x + b.width && b.x - gap < a.x + a.width
    && a.y - gap < b.y + b.height && b.y - gap < a.y + a.height;
}

/**
 * 绑定卡片贴到所属节点左侧的落点（与创建时同一个偏移：`节点左边 - 卡片宽 - 56`），
 * 纵向与该参数行对齐（连线就是一条水平短线）。位置被节点或别的卡片占了就换上下一个
 * 位置试试，全占满则返回 null（退回图的左侧列）。
 */
function cardSlotBeside(
  owner: CardOwner,
  node: any,
  pos: { x: number; y: number },
  deps: FollowCardLayoutDeps,
  occupied: CardRect[],
): { x: number; y: number } | null {
  if (!isFinitePoint(pos)) return null;
  const width = deps.variableCardWidth;
  const height = deps.variableCardHeight;
  const x = snap(pos.x - width - CARD_LANE_GAP);
  const base = Number.isFinite(deps.baseHeight) ? Number(deps.baseHeight) : 96;
  const portY = Number.isFinite(deps.variableCardPortY) ? Number(deps.variableCardPortY) : 29;
  const rowHeight = Math.max(1, node && deps.nodeRowHeight ? deps.nodeRowHeight(node) : 24);
  const rowY = owner.index >= 0 ? pos.y + base + owner.index * rowHeight + rowHeight / 2 : pos.y;
  const center = snap(rowY - portY);
  for (const offset of CARD_SLOT_OFFSETS) {
    const rect = { x, y: snap(center + offset), width, height };
    if (occupied.some((item) => tooClose(rect, item, CARD_CLEARANCE))) continue;
    return { x: rect.x, y: rect.y };
  }
  return null;
}

function memberIdsOf(value: any): string[] {
  const rawIds = Array.isArray(value?.nodeIds) ? value.nodeIds : [];
  return [...new Set<string>(rawIds.map((nodeId: any) => String(nodeId)))];
}

/** 某个节点组的成员 id（组不存在或没有合法成员时是空数组）。 */
export function groupMemberIdsOf(raw: any, groupId: string): string[] {
  const id = String(groupId || '');
  if (!id) return [];
  return memberIdsOf(groupTable(raw)[id]);
}

/** 变量卡片 → 它绑定的节点（供 `bounds()` 判断组内视图该算哪些卡片）。 */
export function variableCardOwners(
  raw: any,
  nodes: Array<{ id: string }>,
  pinsOf: (node: any) => any[],
): Map<string, CardOwner> {
  return cardOwnerIndex(raw, nodes, pinsOf);
}

/** 卡片 id → 它绑定的节点、参数与参数行序号；两条来源：显式连线优先，其次「作用域.变量名」唯一匹配。 */
interface CardOwner {
  nodeId: string;
  param: string;
  /** 参数端点在节点上的行序号；实例子输入等找不到行时是 -1（退回按节点顶部对齐）。 */
  index: number;
}

function cardOwnerIndex(
  raw: any,
  nodes: Array<{ id: string }>,
  pinsOf: (node: any) => any[],
): Map<string, CardOwner> {
  const owners = new Map<string, CardOwner>();
  const cards = recordOf(raw?._variableCards);
  const cardIds = new Set(Object.keys(cards));
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const nodeById = new Map(nodes.map((node: any) => [String(node.id), node]));
  const claim = (cardId: unknown, nodeId: unknown, param: unknown): void => {
    const card = String(cardId ?? '');
    const owner = String(nodeId ?? '');
    if (!card || !owner || owners.has(card) || !cardIds.has(card) || !nodeIds.has(owner)) return;
    const wanted = String(param ?? '');
    const pins = pinsOf(nodeById.get(owner)) || [];
    owners.set(card, { nodeId: owner, param: wanted, index: pins.findIndex((pin: any) => String(pin?.param || '') === wanted) });
  };

  // 1) 显式连线：键是 `nodeId:param`（实例子输入为 `nodeId:runs.N.inputs.param`）。
  for (const [key, cardId] of Object.entries(recordOf(raw?._variableLinks))) {
    const separator = String(key).indexOf(':');
    if (separator <= 0) continue;
    claim(cardId, String(key).slice(0, separator), String(key).slice(separator + 1));
  }

  // 2) 旧文档没有连线记录：同一个变量只有一张卡片时才认。
  const byName = new Map<string, string[]>();
  for (const [id, card] of Object.entries(cards)) {
    if (!card || typeof card !== 'object') continue;
    const scope = card.scope === 'variables' ? 'variables' : 'inputs';
    const key = `${scope}.${String(card.name || '')}`;
    const list = byName.get(key);
    if (list) list.push(id);
    else byName.set(key, [id]);
  }
  const claimByName = (reference: unknown, nodeId: string, param: unknown): void => {
    const match = /^(inputs|variables)\.([^\.]+)/.exec(String(reference || ''));
    if (!match) return;
    const candidates = byName.get(`${match[1]}.${match[2]}`);
    if (!candidates || candidates.length !== 1) return;
    claim(candidates[0], nodeId, param);
  };
  for (const node of nodes) {
    for (const pin of pinsOf(node) || []) {
      if (!pin || !pin.variable) continue;
      const scope = pin.scope === 'variables' ? 'variables' : 'inputs';
      claimByName(`${scope}.${String(pin.variable)}`, node.id, pin.param);
    }
  }

  // 3) 连端点元数据都没有的文档：直接扫节点里所有 `{ref: '作用域.变量名'}`。
  //    （序列 / 装饰器等位置没有端点列表，引用只体现在 params、decorators、runs 里。）
  for (const node of nodes) {
    for (const reference of collectVariableRefs(node)) {
      claimByName(reference, node.id, '');
    }
  }
  return owners;
}

/** 递归收集对象里的 `{ref: '作用域.变量'}` 引用（最深 6 层）。 */
function collectVariableRefs(value: any, depth = 0, out: string[] = []): string[] {
  if (depth > 6 || !value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectVariableRefs(item, depth + 1, out);
    return out;
  }
  if (typeof value.ref === 'string' && /^(inputs|variables)\./.test(value.ref)) out.push(value.ref);
  for (const child of Object.values(value)) collectVariableRefs(child, depth + 1, out);
  return out;
}

/**
 * 组内视图里还该画哪些变量卡片（卡 id 集合）。
 *
 * 组内视图只画**和这个组有关**的卡片：归属于本组成员的，或还没有归属任何节点的
 * （刚放下、还没连线，组内也得看得见）。归属在组外的卡片一律不画——否则进组之后画布上
 * 还飘着组外节点的变量卡，看起来就是「组里混进了别人的卡片」。
 *
 * 例外一条：**本组成员引用到的变量**，卡片即使归属在组外也照画。变量卡是端点右键菜单里
 * 「定位到变量卡片」的目标，卡片一旦不画，菜单会以为这个变量没有卡片，于是
 * 「创建变量卡片（Get）」会再建一张同名卡——同一个变量两张卡。
 *
 * 与 `viewport.scopedVariableCards()` 的差别是**故意的**：包围盒比这里更严，没有归属的
 * 卡片不算进去，免得一张飘在几千像素外的卡片把 `fitView` 拉远。
 */
export function groupVariableCardIds(
  raw: any,
  groupId: string,
  nodes: Array<{ id: string }>,
  pinsOf: (node: any) => any[],
): Set<string> {
  const cards = recordOf(raw?._variableCards);
  const ids = Object.keys(cards);
  const members = new Set(groupMemberIdsOf(raw, groupId));
  // 组没有合法成员（已解散、成员被删光）时不隐藏任何卡片：宁可多画，也不要整屏空掉。
  if (!members.size) return new Set(ids);
  const owners = cardOwnerIndex(raw, nodes, pinsOf);
  // 本组成员引用到的变量（`作用域.变量名`）：端点与节点里任意位置的 `{ref}` 都算。
  const memberRefs = new Set<string>();
  for (const node of nodes) {
    if (!members.has(String(node.id))) continue;
    for (const pin of pinsOf(node) || []) {
      if (!pin || !pin.variable) continue;
      memberRefs.add(`${pin.scope === 'variables' ? 'variables' : 'inputs'}.${String(pin.variable)}`);
    }
    for (const reference of collectVariableRefs(node)) {
      const match = /^(inputs|variables)\.([^\.]+)/.exec(reference);
      if (match) memberRefs.add(`${match[1]}.${match[2]}`);
    }
  }
  const visible = new Set<string>();
  for (const id of ids) {
    const owner = owners.get(id);
    if (!owner || members.has(owner.nodeId)) {
      visible.add(id);
      continue;
    }
    if (memberRefs.has(cardReferenceOf(id, cards[id]))) visible.add(id);
  }
  return visible;
}

/** 整张图的包围盒位移：没有绑定的卡片按它跟随，保持相对图左上角的偏移。 */
function graphDelta(previous: Record<string, any>, layout: Record<string, any>, nodes: Array<{ id: string }>): { x: number; y: number } {
  const before = nodes.map((node) => previous[node.id]).filter(isFinitePoint);
  const after = nodes.map((node) => layout[node.id]).filter(isFinitePoint);
  if (!before.length || !after.length) return { x: 0, y: 0 };
  return {
    x: Math.min(...after.map((pos) => pos.x)) - Math.min(...before.map((pos) => pos.x)),
    y: Math.min(...after.map((pos) => pos.y)) - Math.min(...before.map((pos) => pos.y)),
  };
}

/**
 * 把变量卡片、节点组卡片与（折叠的）组内成员搬到新布局上。
 * 就地修改 `raw` 与 `layout`；调用方负责放进同一次 mutate（一次自动排列 = 一条历史）。
 */
export function followCardsAfterLayout(deps: FollowCardLayoutDeps): FollowCardLayoutResult {
  const { raw, layout, previous, nodes, nodeHeight, nodeWidth, groupScopeId } = deps;
  const pinsOf = deps.nodeVariablePins ?? (() => []);
  const result: FollowCardLayoutResult = { cards: 0, groups: 0, members: 0, strays: 0 };
  if (!raw || typeof raw !== 'object') return result;

  const visible = nodes();
  /** 每个节点搬了多远：只会包含「这一次真的被重新排列」的节点。 */
  const delta = new Map<string, { x: number; y: number }>();
  for (const node of visible) {
    const before = previous[node.id];
    const after = layout[node.id];
    if (!isFinitePoint(before) || !isFinitePoint(after)) continue;
    delta.set(String(node.id), { x: after.x - before.x, y: after.y - before.y });
  }
  const fallback = graphDelta(previous, layout, visible);

  // 组内视图：这一次排的是某个组内部的成员。组外的东西（组卡位置、组外卡片）一律不碰——
  // 组外布局是用户在外层自己排的，进组排一次不该把外面也改掉。
  const scopeMembers = groupScopeId ? new Set(memberIdsOf(groupTable(raw)[groupScopeId])) : null;
  const scoped = Boolean(scopeMembers && scopeMembers.size);
  /** 这次该不该动「归属于 ownerId 的东西」：组内视图只认本组成员。 */
  const inScope = (ownerId: string): boolean => !scoped || (Boolean(ownerId) && scopeMembers!.has(ownerId));
  /** 组内被边界行代表的变量：这些卡片组内不画，组内排列也不碰（与 variableCardList 同源）。 */
  const represented = scoped ? (deps.groupRepresentedRefs ?? new Set<string>()) : new Set<string>();

  // 节点组：折叠时成员跟着组卡搬（组外排列）；进组排列时不动组卡（组卡位置属于组外布局）。
  const groups = groupTable(raw);
  const visibleIds = new Set(visible.map((node) => String(node.id)));
  const documentNodes = nodeListOf(raw, visible);
  const documentById = new Map(documentNodes.map((node: any) => [String(node.id), node]));
  for (const [id, value] of Object.entries(groups)) {
    if (!value || typeof value !== 'object') continue;
    const memberIds = memberIdsOf(value);
    // 成员出现在投影里 = 这就是当前进着的那个组：它在外层的组卡位置不动（组内排列不影响组外）。
    if (memberIds.some((memberId) => visibleIds.has(memberId))) continue;

    // 折叠的组卡这次被排进了新位置：成员整组平移，组内相对关系不变。
    const before = previous[id];
    const after = layout[id];
    if (!isFinitePoint(before) || !isFinitePoint(after)) continue;
    const move = { x: after.x - before.x, y: after.y - before.y };
    if (!move.x && !move.y) continue;
    for (const memberId of memberIds) {
      const member = layout[memberId];
      if (!isFinitePoint(member)) continue;
      if (move.x) member.x = snap(member.x + move.x);
      if (move.y) member.y = snap(member.y + move.y);
      delta.set(memberId, move);
      result.members += 1;
    }
  }

  const cards = recordOf(raw._variableCards);
  const owners = cardOwnerIndex(raw, documentNodes, pinsOf);
  const graphBox = nodeBox(visible, layout, nodeHeight);
  const moved = new Set<string>();
  /** 贴不到节点旁边、又留在图外的卡片：最后统一收回图的左侧列。 */
  const strays: Array<{ id: string; card: any; anchorY: number }> = [];
  /** 已占用的矩形：同排节点本体 + 已经就位的卡片，用来避免「排得好看」变成互相压住。 */
  const occupied: CardRect[] = visible
    .map((node) => {
      const pos = layout[node.id];
      return isFinitePoint(pos) ? { x: pos.x, y: pos.y, width: nodeWidth, height: nodeHeight(node) } : null;
    })
    .filter(Boolean) as CardRect[];
  for (const [id, card] of Object.entries(cards)) {
    if (!card || typeof card !== 'object' || !isFinitePoint(card)) continue;
    // 组内视图：这张卡由组边界行代表、组内根本不画——排列也不许动它（否则出组才发现卡片跳了）。
    if (scoped && represented.has(cardReferenceOf(id, card))) continue;
    const owner = owners.get(id) || null;
    const ownerId = owner ? owner.nodeId : '';
    // 组内视图：只有挂在**本组成员**上的卡片跟着走；组外卡片（含未绑定卡片）原地不动。
    if (scoped && !inScope(ownerId)) continue;

    // 1) 绑定卡片优先贴到所属节点的参数行旁边（创建卡片时就是这么放的，也是最好看的形状）。
    const beside = owner
      ? cardSlotBeside(owner, documentById.get(ownerId), layout[ownerId], deps, occupied)
      : null;
    if (beside) {
      if (card.x !== beside.x || card.y !== beside.y) {
        card.x = beside.x;
        card.y = beside.y;
        moved.add(id);
      }
      occupied.push({ x: beside.x, y: beside.y, width: deps.variableCardWidth, height: deps.variableCardHeight });
      continue;
    }

    // 2) 贴不上（旁边被占满）：跟着所属节点搬同样的位移，保持原来的相对位置。
    const move = delta.get(ownerId) || (ownerId ? null : fallback);
    if (move && (move.x || move.y)) {
      // 只对真的动过的轴取整：位移为 0 的轴保持原值，避免「跟着横向搬家却被顺手挪了一下纵向」。
      if (move.x) card.x = snap(card.x + move.x);
      if (move.y) card.y = snap(card.y + move.y);
      moved.add(id);
    }

    // 3) 还留在图外的卡片：收回图的左侧列（组内视图只处理本组成员上的卡片）。
    if (!graphBox || isWithinBox(card, graphBox)) continue;
    const anchor = ownerId ? layout[ownerId] : null;
    strays.push({ id, card, anchorY: isFinitePoint(anchor) ? anchor.y : card.y });
  }
  // 收回来的卡片按「离所属节点的行位置」排序，码放到图的左侧；一列装不下就往左再起一列。
  strays.sort((a, b) => (a.anchorY - b.anchorY) || (a.card.y - b.card.y) || a.id.localeCompare(b.id));
  for (const [index, stray] of strays.entries()) {
    const at = straySlot(index, graphBox!, deps);
    if (stray.card.x === at.x && stray.card.y === at.y) continue;
    stray.card.x = at.x;
    stray.card.y = at.y;
    moved.add(stray.id);
    result.strays += 1;
  }
  result.cards = moved.size;

  return result;
}
