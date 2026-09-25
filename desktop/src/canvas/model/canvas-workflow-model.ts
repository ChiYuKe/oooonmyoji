/**
 * 画布工作流模型访问：变量端点/卡片、公共输入、子工作流描述与实例运行卡片。
 * 原 `workflow-editor.js` 的 variableTypeOf 至 instanceRunInputPosition 区间。
 *
 * 只读文档与模型，不做文档修改；布局常量由调用方传入。
 */
import type { CanvasState } from '../state/canvas-state';
import { cardRowLabel, cardRowOf, cardRowParams, hasCardLayout } from '../render/card-layout';
import { nodeOutputSchema } from '../../shared/workflow/graph';
import { schemaAtPath } from '../../shared/workflow/schema-path';
import { schemaTypes } from '../../shared/workflow/bindings';
import { CONDITION_INPUT_X, CONDITION_INPUT_Y, boolJudgeShape, expressionInputOffset, isBoolJudgeBoolPin, isBoolJudgeNode, isBooleanInputNode, isBooleanInputPin, isBreakRefPin } from './exec-ports';

/** 清单声明了长度的数组输出，最多给到第几项的下标引用；单层对象字段最多展开几个。 */
const REFERENCE_INDEX_LIMIT = 4;
const REFERENCE_FIELD_LIMIT = 12;

export interface CanvasWorkflowModelDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  Model: any;
  VariableSystem: any;
  nodes(): any[];
  position(node: any): { x: number; y: number };
  variableCards(): Record<string, any>;
  compatibleRefType(expected: any, actual: any): boolean;
  definitionSchema(definition: any): any;
  nodeHeight(node: any): number;
  baseHeight: number;
  nodeWidth: number;
  decoHeight: number;
  variableCardWidth: number;
  variableCardHeight: number;
  variableCardPortY: number;
  variablePinX: number;
  runCardWidth: number;
  runCardBaseHeight: number;
  runVariableHeight: number;
  runCardGapX: number;
  runCardGapY: number;
  catalogByName(name: string): any;
  fieldLabel(name: string): string;
  workflowNodeInputs(node: any): any[];
  nextVariableCardId(): string;
  workflowReference(...args: any[]): any;
  /** 每个节点自己的参数行高；缺省时全部用 runVariableHeight。 */
  nodeRowHeight?(node: any): number;
  nodeVariablePins?(node: any): any[];
}

export function createCanvasWorkflowModel(deps: CanvasWorkflowModelDeps) {
  const {
    state, Model, VariableSystem, nodes, position, variableCards,
    compatibleRefType, definitionSchema, nodeHeight,
    baseHeight: BASE_H, nodeWidth: NODE_W, decoHeight: DECO_H,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    variableCardPortY: VARIABLE_CARD_PORT_Y, variablePinX: VARIABLE_PIN_X,
    runCardWidth: RUN_CARD_W, runCardBaseHeight: RUN_CARD_BASE_H, runVariableHeight: RUN_VARIABLE_H,
    runCardGapX: RUN_CARD_GAP_X, runCardGapY: RUN_CARD_GAP_Y,
    catalogByName, fieldLabel, workflowNodeInputs, nextVariableCardId, workflowReference,
  } = deps;
  /** 节点参数行的行高：清单声明了固定卡片的节点用双行行样式（更高）。 */
  const rowHeightOf = deps.nodeRowHeight ?? (() => RUN_VARIABLE_H);
  /** 参数行的世界坐标 Y（与 editor.nodeHeight 同一套公式，端点/连线才不会错位）。 */
  function rowCenterY(node: any, index: number): number {
    return position(node).y + BASE_H + index * rowHeightOf(node) + rowHeightOf(node) / 2;
  }

  function variableTypeOf(scope: string, name: string): string {
    const definition = state.raw[scope] && state.raw[scope][name];
    return definition && typeof definition === 'object' && definition.type ? definition.type : 'any';
  }

  const { displayNameOfDefinition, variableDisplayNameOf } = Model;

  /**
   * 卡片参数行显示哪些参数：清单声明了固定卡片的 Action 用声明里的端点顺序；
   * 其余默认「必填 + 已配置」，节点卡片箭头展开后显示动作定义里的全部参数。
   */
  function paramRowNames(node: any): string[] {
    const declared = cardRowParams(node && node.action ? catalogByName(node.action) : null);
    if (declared) return declared;
    const names = inputParameterNames(node);
    const expanded = paramRowsExpandedSet(state).has(node && node.id);
    if (!expanded) return names;
    const spec = node && node.action ? catalogByName(node.action) : null;
    const all = spec && spec.parameters ? Object.keys(spec.parameters) : [];
    return all.length ? all : names;
  }

  function expressionOperandPin(param: 'left' | 'right', value: any): any {
    const binding = value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string'
      ? value.ref
      : '';
    const scope = binding.startsWith('variables.') ? 'variables' : 'inputs';
    const variable = binding.startsWith(`${scope}.`) ? binding.slice(scope.length + 1) : '';
    const variableDefinition = variable && state.raw?.[scope] && typeof state.raw[scope] === 'object'
      ? state.raw[scope][variable]
      : null;
    const type = binding && variableDefinition && typeof variableDefinition.type === 'string'
      ? variableDefinition.type
      : literalOperandType(value);
    return {
      param,
      variable,
      scope,
      type,
      label: param === 'left' ? '左值' : '右值',
      definition: type === 'any' ? {} : { type },
      configured: value !== undefined,
      required: false,
      value,
    };
  }

  function literalOperandType(value: unknown): string {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (Array.isArray(value)) return 'array';
    if (value && typeof value === 'object' && typeof (value as { ref?: unknown }).ref !== 'string') return 'object';
    return 'any';
  }

  /** 节点卡片左侧的变量端点：bool_judge 暴露左/右操作数，condition 保持单一 bool 条件口。 */
  function nodeVariablePinsDefault(node: any): any[] {
    if (!node) return [];
    if (isBoolJudgeNode(node)) {
      // 卡面形态决定端点：比较卡两个操作数；整卡绑定 bool 来源时只有一个布尔口；
      // 嵌套条件（and/or/not/exists）没有可拖的端点——它的内容在「嵌套条件（进阶）」里编。
      const shape = boolJudgeShape(node);
      if (shape === 'comparison') {
        const expression = node.expression;
        const operator = Object.keys(expression)[0];
        const operands = Array.isArray(expression[operator]) ? expression[operator] : [];
        return [expressionOperandPin('left', operands[0]), expressionOperandPin('right', operands[1])];
      }
      if (shape === 'binding') {
        const expression = node.expression;
        const binding = expression && typeof expression === 'object' && !Array.isArray(expression)
          && typeof (expression as { ref?: unknown }).ref === 'string'
          ? (expression as { ref: string }).ref
          : '';
        const scope = binding.startsWith('variables.') ? 'variables' : 'inputs';
        const variable = binding.startsWith(`${scope}.`) ? binding.slice(scope.length + 1) : '';
        return [{
          param: 'condition',
          variable,
          scope,
          type: 'boolean',
          label: '布尔值',
          definition: { type: 'boolean' },
          configured: Boolean(binding) || typeof expression === 'boolean',
          required: false,
          value: expression,
        }];
      }
      return [];
    }
    if (isBooleanInputNode(node)) {
      const expression = node.expression;
      const binding = expression && typeof expression === 'object' && !Array.isArray(expression)
        && typeof expression.ref === 'string'
        ? expression.ref
        : '';
      const scope = binding.startsWith('variables.') ? 'variables' : 'inputs';
      const variable = binding.startsWith(`${scope}.`) ? binding.slice(scope.length + 1) : '';
      return [{
        param: 'condition',
        variable,
        scope,
        type: 'boolean',
        label: '布尔条件',
        definition: { type: 'boolean' },
        configured: Boolean(binding),
        required: false,
        value: expression,
      }];
    }
    if (node.type === 'break') {
      // 拆分卡片：一行「拆分来源」，绑定写在节点顶层 ref 字段上（不是 params）。
      // 类型不设限（对象/数组都能拆），具体目标校验交给两端校验器。
      const binding = node.ref && typeof node.ref === 'object' && !Array.isArray(node.ref) && typeof node.ref.ref === 'string' ? node.ref.ref : '';
      const scope = binding.startsWith('variables.') ? 'variables' : binding.startsWith('inputs.') ? 'inputs' : 'inputs';
      const variable = scope && binding.startsWith(`${scope}.`) ? binding.slice(scope.length + 1) : '';
      return [{
        param: 'ref',
        variable,
        scope,
        type: 'any',
        label: '拆分来源',
        definition: null,
        configured: Boolean(binding),
        required: true,
        value: binding ? node.ref : undefined,
      }];
    }
    if (node.type !== 'task') return [];
    const params = node.params && typeof node.params === 'object' && !Array.isArray(node.params) ? node.params : {};
    const pins = [];
    const spec = catalogByName(node.action);
    const card = spec && hasCardLayout(spec) ? spec : null;
    for (const param of paramRowNames(node)) {
      if (!spec || !spec.parameters || !spec.parameters[param]) continue;
      const value = params[param];
      const ref = value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' ? value.ref : '';
      const scope = ref.startsWith('variables.') ? 'variables' : 'inputs';
      const variable = ref.startsWith(`${scope}.`) ? ref.slice(scope.length + 1) : '';
      const definition = spec && spec.parameters ? spec.parameters[param] : null;
      const row = cardRowOf(card, param);
      pins.push({
        param,
        variable,
        scope,
        type: variable ? variableTypeOf(scope, variable) : definition && definition.type || 'any',
        label: cardRowLabel(row, fieldLabel(param)),
        definition,
        configured: Object.prototype.hasOwnProperty.call(params, param),
        required: Boolean(definition && definition.required),
        value,
        ...(row && row.control ? { control: row.control } : {}),
        ...(row && row.on_label ? { onLabel: row.on_label } : {}),
        ...(row && row.off_label ? { offLabel: row.off_label } : {}),
      });
    }
    for (const variable of workflowNodeInputs(node)) {
      const input = params.inputs && typeof params.inputs === 'object' ? params.inputs[variable.name] : null;
      const binding = input && typeof input === 'object' && typeof input.ref === 'string' ? input.ref : '';
      const scope = binding.startsWith('variables.') ? 'variables' : 'inputs';
      const ref = binding.startsWith(`${scope}.`) ? binding.slice(scope.length + 1) : '';
      pins.push({
        param: `inputs.${variable.name}`,
        variable: ref,
        scope,
        type: variable.definition.type || 'any',
        // 子工作流输入的键是自动生成的（`v_<uuid>`），行标签要用子工作流声明的显示名。
        label: displayNameOfDefinition(variable.definition, variable.name),
        definition: variable.definition,
        configured: Object.prototype.hasOwnProperty.call(params.inputs || {}, variable.name),
        required: Boolean(variable.definition && variable.definition.required),
        value: input,
      });
    }
    return pins;
  }

  /** 收集已经连到节点卡片上的变量引用：变量列表用它给这些变量打“已连接”标记（不再隐藏它们）。 */
  function collectNodeCardVariableRefs(): any {
    const refs = new Set();
    const addReference = (reference: any) => {
      if (typeof reference !== 'string') return;
      const match = /^(inputs|variables)\.([^\.]+)/.exec(reference);
      if (match) refs.add(`${match[1]}.${match[2]}`);
    };
    for (const node of nodes()) {
      for (const pin of nodeVariablePins(node)) {
        if (!pin || !pin.variable || (pin.scope !== 'inputs' && pin.scope !== 'variables')) continue;
        // 节点绑定可能指向嵌套字段，但左侧列表对应的是顶层变量定义。
        addReference(`${pin.scope}.${pin.variable}`);
      }
    }
    for (const card of instanceRunCards()) {
      for (const variable of card.variables) {
        const value = card.run && card.run.inputs && card.run.inputs[variable.name];
        addReference(value && typeof value === 'object' && !Array.isArray(value) ? value.ref : '');
      }
    }
    return refs;
  }

  function variableCardPosition(node: any, index: number = 0): { x: number; y: number } {
    const pos = position(node);
    const left = pos.x - VARIABLE_CARD_W - 56;
    const x = left >= 24 ? left : pos.x + NODE_W + 56;
    const pinY = rowCenterY(node, index);
    return {
      x: Math.round(x / 8) * 8,
      y: Math.max(24, Math.round((pinY - VARIABLE_CARD_PORT_Y) / 8) * 8),
    };
  }

  const { inputParameterMetadata } = Model;

  /**
   * 任务参数端点由参数定义自动产生：必填参数始终可接变量，已配置的可选参数也可接变量。
   * _inputParams 仅用于兼容旧工作流中通过“输入”开关保存的端点元数据。
   */
  function inputParameterNames(node: any): string[] {
    const value = state.raw && state.raw._inputParams && state.raw._inputParams[node && node.id];
    const legacyNames = Array.isArray(value)
      ? value.filter((name) => typeof name === 'string' && name)
      : value && typeof value === 'object'
        ? Object.keys(value).filter((name) => value[name] === true)
        : [];
    const spec = catalogByName(node && node.action);
    const params = node && node.params && typeof node.params === 'object' && !Array.isArray(node.params) ? node.params : {};
    const automaticNames = spec && spec.parameters
      ? Object.entries<any>(spec.parameters)
        .filter(([name, definition]) => definition && (definition.required === true || Object.prototype.hasOwnProperty.call(params, name)))
        .map(([name]) => name)
      : [];
    const names = [...new Set([...automaticNames, ...legacyNames])];
    return spec && spec.parameters
      ? names.filter((name) => Object.prototype.hasOwnProperty.call(spec.parameters, name))
      : [];
  }

  /** 将旧版已有输入绑定迁移为编辑器输入端点元数据，并保留现有引用。 */
  function syncLegacyInputParameters(): boolean {
    if (!state.raw || Object.prototype.hasOwnProperty.call(state.raw, '_inputParams')) return false;
    const inputs = state.raw.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return false;
    const metadata: Record<string, any> = {};
    let changed = false;
    for (const node of nodes()) {
      if (!node || node.type !== 'task' || !node.params || typeof node.params !== 'object' || Array.isArray(node.params)) continue;
      const names = Object.entries<any>(node.params)
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && value.ref.startsWith('inputs.') && Object.prototype.hasOwnProperty.call(inputs, value.ref.slice('inputs.'.length)))
        .map(([name]) => name);
      if (names.length) { metadata[node.id] = names; changed = true; }
    }
    if (!changed) return false;
    state.raw._inputParams = metadata;
    return true;
  }

  /** 将旧文档中已有的 inputs 绑定迁移为可见的变量卡片。 */
  function syncLegacyVariableCards(): boolean {
    if (!state.raw || Object.prototype.hasOwnProperty.call(state.raw, '_variableCards')) return false;
    const inputs = state.raw.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return false;
    const references = new Map();
    for (const node of nodes()) {
      nodeVariablePins(node).forEach((pin: any, index: number) => {
        if (pin.variable && Object.prototype.hasOwnProperty.call(inputs, pin.variable) && !references.has(pin.variable)) {
          references.set(pin.variable, { node, index });
        }
      });
    }
    if (!references.size) return false;
    const cards = variableCards();
    for (const [name, reference] of references) {
      const id = nextVariableCardId();
      cards[id] = { name, scope: 'inputs', ...variableCardPosition(reference.node, reference.index) };
    }
    return true;
  }

  function variablePinPosition(node: any, index: number): { x: number; y: number } {
    const pin = nodeVariablePins(node)[index];
    const inputOffset = expressionInputOffset(node, pin?.param);
    if (inputOffset) {
      // 表达式端点固定在左侧说明区，不跟随参数行索引。
      return { x: position(node).x + inputOffset.x, y: position(node).y + inputOffset.y };
    }
    return { x: position(node).x + VARIABLE_PIN_X, y: rowCenterY(node, index) };
  }

  function variableCompatibleWithPin(scope: string, variableName: string, node: any, param: any): boolean {
    if (!node) return false;
    if (scope === 'variables' && !VariableSystem.visible(state.raw, state.raw.variables?.[variableName]?.owner, node.id)) return false;
    if (isBooleanInputPin(node, param)) {
      const variableDefinition = state.raw[scope] && state.raw[scope][variableName];
      return !variableDefinition || compatibleRefType({ type: 'boolean' }, definitionSchema(variableDefinition));
    }
    // 布尔判断卡的布尔口：整卡就是一个 bool，只接受 boolean 变量（与判断节点的布尔条件口一致）。
    if (isBoolJudgeBoolPin(node, param)) {
      const variableDefinition = state.raw[scope] && state.raw[scope][variableName];
      return !variableDefinition || compatibleRefType({ type: 'boolean' }, definitionSchema(variableDefinition));
    }
    if (isBoolJudgeNode(node) && (param === 'left' || param === 'right')) return true;
    if (isBreakRefPin(node, param)) {
      // 拆分来源只接受 object / array 变量（标量变量拆不出字段）。
      const variableDefinition = state.raw[scope] && state.raw[scope][variableName];
      return !variableDefinition || isCompositeSchema(definitionSchema(variableDefinition));
    }
    const spec = node.action ? catalogByName(node.action) : null;
    let definition = spec && spec.parameters ? spec.parameters[param] : undefined;
    if (!definition && typeof param === 'string' && param.startsWith('inputs.')) {
      const workflowInput = workflowNodeInputs(node).find((item: any) => `inputs.${item.name}` === param);
      definition = workflowInput && workflowInput.definition;
    }
    if (!definition) return true;
    const variableDefinition = state.raw[scope] && state.raw[scope][variableName];
    return compatibleRefType(definitionSchema(definition), definitionSchema(variableDefinition));
  }

  /**
   * 节点输出候选：对象输出逐字段给出引用，数组输出给出整体 + 第 1 项（元素及其字段），
   * 其余输出只有整体一个候选。`ref` 就是写进参数的引用文本。
   *
   * 数组为什么要给到「项」：`vision.wait_template` 这类输出是匹配数组，而目标参数
   * （例如 `input.tap_match.match`）只要一个对象——运行时的引用语法支持下标
   * （`nodes.<id>.output.0`），所以拖过去应该能连。
   *
   * 为什么只给第 1 项：自由数组（找模板、OCR）的元素彼此同形，第 2 项起的下标既没有
   * 独立语义，运行时也可能不存在（只命中 1 个时引用下标会直接报错）。要列更多项，
   * 得靠清单声明 prefixItems / maxItems 把长度写死。
   */
  /** inputs / variables 的定义编译成 schema 树（拆分卡片引用它们时按路径取子 schema）。 */
  function referenceSchemaTree(): Record<string, unknown> {
    const scopeSchema = (scope: 'inputs' | 'variables'): Record<string, unknown> => {
      const definitions = state.raw && state.raw[scope] && typeof state.raw[scope] === 'object' && !Array.isArray(state.raw[scope])
        ? state.raw[scope] as Record<string, any>
        : {};
      const properties: Record<string, unknown> = {};
      for (const [name, definition] of Object.entries(definitions)) properties[name] = definitionSchema(definition);
      return { type: 'object', properties, additionalProperties: false };
    };
    return {
      type: 'object',
      properties: { inputs: scopeSchema('inputs'), variables: scopeSchema('variables') },
      additionalProperties: false,
    };
  }

  /**
   * `inputs.<键>[.<路径>]` / `variables.<键>[.<路径>]` 指向的 schema。
   *
   * 拆分卡片的来源可以是工作流输入/变量（例如 `inputs.识别区域` 这种 rect），推导输出 schema
   * 时必须能解析它们，否则卡片排不出字段引脚（以前会当成空对象）。
   */
  function resolveReferenceSchema(reference: string): Record<string, unknown> | undefined {
    const parts = String(reference || '').split('.');
    if (parts.length < 2 || (parts[0] !== 'inputs' && parts[0] !== 'variables') || !parts.slice(1).every(Boolean)) return undefined;
    return schemaAtPath(referenceSchemaTree(), parts);
  }

  /** 节点输出的整体 schema：Task 取 Action 清单；值卡片按各自规则推导（拆分卡片递归）。 */
  function outputSchemaOf(node: any): any {
    if (!node) return null;
    if (node.type === 'bool_judge') return { type: 'boolean' };
    if (node.type === 'break') {
      return nodeOutputSchema(
        node,
        { byName: (name: string) => catalogByName(name), names: () => [] },
        (id: string) => nodes().find((item: any) => item && item.id === id),
        resolveReferenceSchema,
      );
    }
    const spec = node.action ? catalogByName(node.action) : null;
    return spec && spec.outputSchema ? spec.outputSchema : null;
  }

  /** schema 是不是 object / array（拆分来源只接受这两类）。 */
  function isCompositeSchema(schema: any): boolean {
    const types = schemaTypes(schema && typeof schema === 'object' ? schema : undefined);
    return types.has('object') || types.has('array');
  }

  function nodeOutputFields(node: any): Array<{ field: string; label: string; schema: any; ref: string }> {
    if (!node || !node.id) return [];
    // 布尔判断卡片没有 Action：输出形状固定是 `{ value: boolean }`，
    // 与 Python 侧 `BOOL_JUDGE_OUTPUT_SCHEMA` 一致。
    if (node.type === 'bool_judge') {
      return [{ field: 'value', label: fieldLabel('value'), schema: { type: 'boolean' }, ref: `nodes.${node.id}.output.value` }];
    }
    const schema = outputSchemaOf(node);
    if (!schema || typeof schema !== 'object') return [];
    const base = `nodes.${node.id}.output`;
    const candidates: Array<{ field: string; label: string; schema: any; ref: string }> = [];
    const push = (field: string, label: string, child: any): void => {
      candidates.push({ field, label, schema: child, ref: field ? `${base}.${field}` : base });
    };
    const objectFields = (child: any): Array<[string, any]> => {
      const properties = child && typeof child === 'object' && child.properties && typeof child.properties === 'object' && !Array.isArray(child.properties)
        ? child.properties as Record<string, any>
        : {};
      return Object.entries(properties).slice(0, REFERENCE_FIELD_LIMIT);
    };
    if (schema.type === 'object' && objectFields(schema).length) {
      for (const [field, child] of objectFields(schema)) {
        push(field, fieldLabel(field), child);
        // 再展开一层对象字段（例如 match.x），字段数有上限，避免菜单爆炸。
        if (child && child.type === 'object') {
          for (const [nested, nestedSchema] of objectFields(child)) push(`${field}.${nested}`, `${fieldLabel(field)} · ${fieldLabel(nested)}`, nestedSchema);
        }
      }
      return candidates;
    }
    if (schema.type !== 'array') {
      push('', '输出', schema);
      return candidates;
    }
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    const items = schema.items && typeof schema.items === 'object' ? schema.items : null;
    // 定长元组（`prefixItems`，例如区域 rect = [x, y, w, h]）是结构体语义：只列成员，
    // 不列「整体」——`In Vec` 那种卡片拆出来就是 X / Y / Z。
    const fixedTuple = prefixItems.length > 0;
    if (!fixedTuple) push('', '输出', schema);
    const elementAt = (index: number): any => (prefixItems[index] && typeof prefixItems[index] === 'object' ? prefixItems[index] : items);
    const first = elementAt(0);
    // 元素类型未知（没有 items / prefixItems）时不瞎给下标：那种引用在运行时也解析不出字段。
    if (!first || !first.type) return candidates;
    // 下标只有两种来源才算「有语义」：声明了 prefixItems（定长元组）或 maxItems（长度有界）。
    // 自由长度的数组（匹配结果、OCR 结果）没有声明长度，多列几个下标只会给出同样内容、
    // 运行时还可能解析不到——所以只给第 1 项。
    const declared = prefixItems.length
      ? prefixItems.length
      : (typeof schema.maxItems === 'number' ? schema.maxItems : 1);
    const indexes = Math.max(1, Math.min(REFERENCE_INDEX_LIMIT, declared));
    for (let index = 0; index < indexes; index += 1) {
      const itemSchema = elementAt(index);
      if (!itemSchema || !itemSchema.type) continue;
      // 元组项带 `title` 时（rect 的 X/Y/W/H）直接用它当标签，否则退回「第 N 项」。
      const itemLabel = typeof itemSchema.title === 'string' && itemSchema.title ? itemSchema.title : `第 ${index + 1} 项`;
      push(String(index), itemLabel, itemSchema);
      if (itemSchema.type === 'object') {
        for (const [field, child] of objectFields(itemSchema)) push(`${index}.${field}`, `${itemLabel} · ${fieldLabel(field)}`, child);
      }
    }
    return candidates;
  }

  /** 某个输出字段能否绑到目标参数/实例输入上（按值类型比较）。 */
  function referenceCompatibleWithPin(sourceNode: any, field: string, targetNode: any, param: string): boolean {
    if (!sourceNode || !targetNode) return false;
    const candidate = nodeOutputFields(sourceNode).find((item) => item.field === (field || ''))
      || nodeOutputFields(sourceNode)[0];
    if (!candidate) return false;
    if (isBooleanInputPin(targetNode, param)) {
      return compatibleRefType({ type: 'boolean' }, definitionSchema(candidate.schema));
    }
    if (isBoolJudgeBoolPin(targetNode, param)) {
      return compatibleRefType({ type: 'boolean' }, definitionSchema(candidate.schema));
    }
    if (isBoolJudgeNode(targetNode) && (param === 'left' || param === 'right')) return true;
    // 拆分来源只接受 object / array 输出（与 Python `break_target_schema` 的类型检查一致）：
    // 绑一个标量过去运行时也拆不出字段，属于无效引用。
    if (isBreakRefPin(targetNode, param)) return isCompositeSchema(candidate.schema);
    const spec = targetNode.action ? catalogByName(targetNode.action) : null;
    let definition = spec && spec.parameters ? spec.parameters[param] : undefined;
    if (!definition && typeof param === 'string' && param.startsWith('inputs.')) {
      const workflowInput = workflowNodeInputs(targetNode).find((item: any) => `inputs.${item.name}` === param);
      definition = workflowInput && workflowInput.definition;
    }
    if (!definition) return true;
    return compatibleRefType(definitionSchema(definition), definitionSchema(candidate.schema));
  }

  /**
   * 拆分来源的落点候选：整体输出能拆时就只给整体（`nodes.<id>.output`）。
   *
   * UE 的 Break 节点输入就是一个结构体，没有「挑某个成员当输入」这一说；把整张卡片的
   * 输出拆开也是最常见的用法。整体不是 object / array 时（例如拆分卡拆出来一个标量）
   * 退回可拆的复合字段，避免出现「一点候选都没有」的死角。标量字段永远不进候选：
   * 绑过去就是 Python 校验里的 `break-target-not-object`。
   */
  function breakSourceFields(sourceNode: any): Array<{ field: string; label: string; schema: any; ref: string }> {
    if (!sourceNode || !sourceNode.id) return [];
    const whole = outputSchemaOf(sourceNode);
    if (isCompositeSchema(whole)) {
      return [{ field: '', label: '输出', schema: whole, ref: `nodes.${sourceNode.id}.output` }];
    }
    return nodeOutputFields(sourceNode)
      .filter((candidate) => candidate.field && isCompositeSchema(candidate.schema));
  }

  /**
   * 拆分卡片右侧的字段输出引脚：输出 schema 是 object / array 时按顶层字段排引脚
   * （UE Break 结构体的样子：`In Vec` ↔ `X / Y / Z`）。标量输出（未绑定、或拆出来就是一个
   * 标量）没有引脚，卡片退回一个通用输出引用口。
   *
   * 只取顶层字段：`x.y` 这类嵌套候选留给落点菜单，不铺成引脚，否则卡片会被撑得很长。
   */
  function breakFieldPins(node: any): Array<{ field: string; label: string; schema: any; ref: string }> {
    if (!node || node.type !== 'break') return [];
    if (!isCompositeSchema(outputSchemaOf(node))) return [];
    return nodeOutputFields(node).filter((candidate) => !String(candidate.field).includes('.'));
  }

  /**
   * 拆分卡片可选的来源清单：等于 UE 调色板里「按结构体逐条列出 Break <Struct>」的那份列表。
   * 只有 schema 是 object / array / 定长元组的来源才进列表（标量拆不出成员），
   * 每项给出可直接写进 `ref` 的引用文本与显示名。
   */
  function breakSourceCandidates(excludeNodeId?: string): Array<{ ref: string; label: string }> {
    const candidates: Array<{ ref: string; label: string }> = [];
    for (const node of nodes()) {
      if (!node || !node.id || node.id === excludeNodeId) continue;
      if (node.type === 'condition' || node.type === 'root') continue;
      if (!isCompositeSchema(outputSchemaOf(node))) continue;
      const name = node.name || (node.action ? fieldLabel(node.action) : '') || node.id;
      candidates.push({ ref: `nodes.${node.id}.output`, label: `${name} · 输出` });
    }
    for (const scope of ['inputs', 'variables'] as const) {
      const definitions = state.raw && state.raw[scope] && typeof state.raw[scope] === 'object' && !Array.isArray(state.raw[scope])
        ? state.raw[scope] as Record<string, any>
        : {};
      for (const [name, definition] of Object.entries(definitions)) {
        if (!isCompositeSchema(definitionSchema(definition))) continue;
        candidates.push({
          ref: `${scope}.${name}`,
          label: `${fieldLabel(name)} · ${scope === 'inputs' ? '输入' : '变量'}`,
        });
      }
    }
    return candidates;
  }

  /** 目标参数能接受源节点输出里的哪些字段（按清单顺序）。 */
  function referenceFieldsForPin(sourceNode: any, targetNode: any, param: string): Array<{ field: string; label: string; schema: any; ref: string }> {
    if (targetNode && isBreakRefPin(targetNode, param)) return breakSourceFields(sourceNode);
    return nodeOutputFields(sourceNode).filter((candidate) => referenceCompatibleWithPin(sourceNode, candidate.field, targetNode, param));
  }

  /** 节点输出引用的显示名：`nodes.<id>.output.<字段>` → `<节点名>.<字段>`，数组下标写作 `[n]`。 */
  function referenceDisplayName(reference: unknown): string {
    const text = typeof reference === 'string' ? reference : '';
    const match = /^nodes\.([^\.]+)\.output(?:\.(.+))?$/.exec(text);
    if (!match) return text;
    const source = nodes().find((item: any) => item && item.id === match[1]);
    const name = source ? (source.name || source.id) : match[1];
    if (!match[2]) return name;
    return match[2].split('.').reduce((label, segment) => (
      /^\d+$/.test(segment) ? `${label}[${segment}]` : `${label}.${fieldLabel(segment)}`
    ), name);
  }

  function variableCompatibleWithInstanceInput(scope: string, variableName: string, card: any, input: any): boolean {
    const node = card && card.node;
    const variableDefinition = state.raw && state.raw[scope] && state.raw[scope][variableName];
    if (!node || !input || !variableDefinition) return false;
    if (scope === 'variables' && !VariableSystem.visible(state.raw, variableDefinition.owner, node.id)) return false;
    return compatibleRefType(definitionSchema(input.definition), definitionSchema(variableDefinition));
  }

  function workflowDescriptor(reference: any): any {
    const normalized = String(reference || '').trim().replace(/\\/g, '/').replace(/^workflows\//i, '');
    if (!normalized) return null;
    const withExt = normalized.toLowerCase().endsWith('.json') ? normalized : `${normalized}.json`;
    return (state.workflows || []).find((file: any) => {
      const candidate = workflowReference(file);
      return candidate === normalized
        || candidate === withExt
        || candidate.endsWith(`/${normalized}`)
        || candidate.endsWith(`/${withExt}`)
        || file.id === normalized;
    }) || null;
  }

  function workflowInputs(reference: any): any[] {
    const descriptor = workflowDescriptor(reference);
    return descriptor && Array.isArray(descriptor.inputs)
      ? descriptor.inputs.filter((variable: any) => variable && variable.definition)
      : [];
  }

  function instanceRunCards(): any[] {
    const cards: any[] = [];
    for (const node of nodes()) {
      if (node.type !== 'instance_parallel' || !Array.isArray(node.runs) || !node.runs.length) continue;
      const parent = position(node);
      const totalWidth = node.runs.length * RUN_CARD_W + Math.max(0, node.runs.length - 1) * RUN_CARD_GAP_X;
      const startX = parent.x + NODE_W / 2 - totalWidth / 2;
      node.runs.forEach((run: any, index: number) => {
        const variables = workflowInputs(run.workflow);
        cards.push({
          key: `${node.id}:${index}`,
          node,
          run,
          index,
          variables,
          x: startX + index * (RUN_CARD_W + RUN_CARD_GAP_X),
          y: parent.y + nodeHeight(node) + RUN_CARD_GAP_Y,
          height: RUN_CARD_BASE_H + variables.length * RUN_VARIABLE_H,
        });
      });
    }
    return cards;
  }

  function instanceRunInputPosition(card: any, index: number): { x: number; y: number } {
    return {
      x: card.x + 10,
      y: card.y + RUN_CARD_BASE_H + index * RUN_VARIABLE_H + RUN_VARIABLE_H / 2,
    };
  }

  /** 卡片渲染/测试可覆盖端点计算；默认使用本地实现。 */
  const nodeVariablePins = deps.nodeVariablePins ?? nodeVariablePinsDefault;

  /**
   * 端点连接状态：扫一遍文档反推出「哪些节点的输出被引用」「哪些变量被用到」。
   *
   * 引用文本自带来源（`nodes.<id>.output[.字段]`、`inputs.X`、`variables.X`），所以不需要
   * 额外的连线记录，也不会和文档不同步。两处扫描刻意**各自对齐实际画出来的线**：
   * - 输出引用只看节点的参数行，因为 `renderReferenceEdges` 也只扫参数行；
   * - 变量连实例卡输入也算，因为 `renderVariableEdges` 会为 `runs[].inputs` 画线。
   * 按文档版本缓存：卡片渲染每帧都要问端点连没连，全图扫描不能每帧做。
   */
  let portLinkVersion = -1;
  let portLinkOutputs = new Set<string>();
  let portLinkVariables = new Set<string>();
  /** 节点 id → 被引用的 output 尾段集合（'' = 整个 output；'state' = .state；'0.score' = 深层路径）。 */
  let portLinkOutputTails = new Map<string, Set<string>>();
  function portLinks(): void {
    const version = Number(state.docVersion || 0);
    if (version === portLinkVersion) return;
    const outputs = new Set<string>();
    const variables = new Set<string>();
    const tails = new Map<string, Set<string>>();
    const collect = (reference: unknown): void => {
      const ref = typeof reference === 'string' ? reference : '';
      if (!ref) return;
      const output = /^nodes\.([^\.]+)\.output(?:\.(.+))?$/.exec(ref);
      if (output) {
        outputs.add(output[1]);
        const tailSet = tails.get(output[1]) || new Set<string>();
        tailSet.add(output[2] ?? '');
        tails.set(output[1], tailSet);
        return;
      }
      const variable = /^(inputs|variables)\.([^\.]+)/.exec(ref);
      if (variable) variables.add(`${variable[1]}.${variable[2]}`);
    };
    for (const node of nodes()) {
      if (!node) continue;
      for (const pin of nodeVariablePins(node) || []) {
        const value = pin && pin.value;
        if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string') collect(value.ref);
      }
    }
    for (const runCard of instanceRunCards()) {
      const inputs = runCard.run && typeof runCard.run.inputs === 'object' && !Array.isArray(runCard.run.inputs)
        ? runCard.run.inputs
        : {};
      for (const variable of runCard.variables || []) {
        const value = inputs[variable.name];
        if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string') collect(value.ref);
      }
    }
    portLinkVersion = version;
    portLinkOutputs = outputs;
    portLinkVariables = variables;
    portLinkOutputTails = tails;
  }

  /** 任务卡的「节点输出引用」口是否已经连出去：连了画实心，没连是空心环。 */
  function outputReferenced(nodeId: string): boolean {
    portLinks();
    return portLinkOutputs.has(String(nodeId));
  }

  /**
   * 拆分卡片的某个字段引脚是否已经连出去。整个 output 被引用（`nodes.<id>.output`，
   * 例如别的拆分卡片镜像了它）时所有字段都算已连接；否则按尾段精确匹配（`state`、
   * `0.score` 这类深层路径也算在首段字段上）。
   */
  function outputFieldReferenced(nodeId: string, field: string): boolean {
    portLinks();
    const tails = portLinkOutputTails.get(String(nodeId));
    if (!tails) return false;
    if (tails.has('')) return true;
    const name = String(field || '');
    for (const tail of tails) {
      if (tail === name || (name && tail.startsWith(`${name}.`))) return true;
    }
    return false;
  }

  /** 变量卡片的输出口是否已经连出去（有没有端点或实例卡输入引用这个变量）。 */
  function variableInUse(scope: string, name: string): boolean {
    portLinks();
    return portLinkVariables.has(`${scope === 'variables' ? 'variables' : 'inputs'}.${name}`);
  }

  return {
    variableTypeOf, nodeVariablePins, collectNodeCardVariableRefs, variableCardPosition, inputParameterNames, paramRowNames,
    paramRowsExpanded: () => paramRowsExpandedSet(state),
    syncLegacyInputParameters, syncLegacyVariableCards, variablePinPosition, variableCompatibleWithPin,
    variableCompatibleWithInstanceInput, workflowDescriptor, workflowInputs, instanceRunCards, instanceRunInputPosition,
    nodeOutputFields, breakFieldPins, breakSourceCandidates, resolveReferenceSchema, referenceCompatibleWithPin, referenceFieldsForPin, referenceDisplayName,
    outputReferenced, outputFieldReferenced, variableInUse,
  };
}

/**
 * 展开集合的来源不止本 realm：独立预览页（宿主窗口）或测试 vm 会直接塞一个 Set 进来，
 * 跨 realm 的 `instanceof Set` 为 false，所以按鸭子类型判断并按需补一个本 realm 的集合。
 */
export function paramRowsExpandedSet(state: any): Set<string> {
  const current = state && state.paramRowsExpanded;
  if (current && typeof current.has === 'function' && typeof current.add === 'function' && typeof current.delete === 'function') {
    return current as Set<string>;
  }
  const created = new Set<string>();
  if (state) state.paramRowsExpanded = created;
  return created;
}