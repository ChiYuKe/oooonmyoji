/** `.owf` 图文档的语义无损规范化规则。 */
import { GRAPH_SCHEMA_VERSION } from '../graph-document';
import { DslError } from './errors';
import { deepClone, isRecord, oneKeyDict, setKey } from './support';

const EXPRESSION_KEYS = ['expression', 'condition'];

/**
 * 把图文档整理成序列化器会产出的稳定形状。
 *
 * 规范化只收敛等价写法：执行口 `then`、嵌套的 `and/or`、空结构列表和空折点。
 * 连线顺序不会改变，因此画布的显示与运行顺序保持原样。
 */
export function normalizeDocument(document: any): any {
  if (!isRecord(document)) throw new DslError('图文档不是对象');
  const result = deepClone(document);
  setKey(result, 'schema_version', GRAPH_SCHEMA_VERSION);

  // 输出器会把非对象的输入/变量表写成空对象，这里同步该口径，保证往返结果一致。
  for (const key of ['inputs', 'variables']) {
    if (!isRecord(result[key])) setKey(result, key, {});
  }

  const nodes = result.nodes;
  if (!Array.isArray(nodes)) throw new DslError('图文档缺少 nodes 数组');
  const edges = result.edges;
  if (Array.isArray(edges) && edges.length) {
    setKey(result, 'edges', edges.map((edge: any) => normalizeEdge(edge)));
  } else {
    delete result.edges;
  }
  for (const key of ['groups', 'comments']) {
    if (Array.isArray(result[key]) && !result[key].length) delete result[key];
  }
  for (const node of nodes) {
    if (isRecord(node)) normalizeNodeExpressions(node);
  }
  return result;
}

function normalizeEdge(edge: any): any {
  const normalized = deepClone(edge);
  if (!isRecord(normalized)) return normalized;
  for (const side of ['from', 'to']) {
    const binding = normalized[side];
    if (isRecord(binding) && binding.pin === 'then') setKey(binding, 'pin', 'then.0');
  }
  if (Array.isArray(normalized.waypoints) && !normalized.waypoints.length) delete normalized.waypoints;
  return normalized;
}

function normalizeNodeExpressions(node: Record<string, any>): void {
  for (const key of EXPRESSION_KEYS) {
    if (Object.hasOwn(node, key)) setKey(node, key, normalizeExpression(node[key]));
  }
  if (Array.isArray(node.conditions)) {
    setKey(node, 'conditions', node.conditions.map((item: any) => normalizeExpression(item)));
  }
}

/** 递归压平同类逻辑运算，同时规范化它们的子表达式。 */
function normalizeExpression(value: any): any {
  if (!isRecord(value) || Object.keys(value).length !== 1) return value;
  const operator = Object.keys(value)[0];
  const operands = value[operator];
  if ((operator === 'and' || operator === 'or') && Array.isArray(operands)) {
    const flattened: any[] = [];
    for (const raw of operands) {
      const operand = normalizeExpression(raw);
      if (
        isRecord(operand) &&
        Object.keys(operand).length === 1 &&
        Object.hasOwn(operand, operator) &&
        Array.isArray(operand[operator])
      ) {
        flattened.push(...operand[operator]);
      } else {
        flattened.push(operand);
      }
    }
    return oneKeyDict(operator, flattened);
  }
  if (operator === 'not') return oneKeyDict('not', normalizeExpression(operands));
  if (operator === 'exists') return oneKeyDict('exists', operands);
  if (Array.isArray(operands)) return oneKeyDict(operator, operands.map((item: any) => normalizeExpression(item)));
  return oneKeyDict(operator, normalizeExpression(operands));
}
