/**
 * 子工作流助手：引用解析、打开请求、复合节点副标题、装饰器与条件摘要。
 * 原 `workflow-editor.js` 的 subWorkflowRef 至 conditionSummary 区间。
 */
import type { CanvasState } from '../state/canvas-state';
import { isBindingValue } from '../../shared/workflow/bindings';

export interface SubworkflowDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  vscode: any;
  nodeById(id: string): any;
  $(id: string): HTMLElement;
  showMenu(...args: any[]): void;
  compactValue(value: any, limit?: number): string;
  /** 引用路径 → 中文标签；缺省时回读里保留原始路径。 */
  referenceLabel?(ref: string): string;
}

export function createSubworkflowHelpers(deps: SubworkflowDeps) {
  const { state, vscode, nodeById, $, showMenu, compactValue } = deps;
  const referenceLabel = deps.referenceLabel || ((ref: string) => ref);
  /**
   * 工作流引用可以是卡片上的字面量，也可以是 workflow 类型变量。
   * 编辑期用变量默认值解析子工作流，这样输入面板和双击进入都能继续工作。
   */
  function resolveWorkflowRef(value: any): string {
    if (typeof value === 'string') return value.trim();
    if (!isBindingValue(value)) return '';
    const match = /^(inputs|variables)\.([^.]+)$/.exec(value.ref);
    if (!match) return '';
    const definition = state.raw?.[match[1]]?.[match[2]];
    return definition && definition.type === 'workflow' && typeof definition.default === 'string'
      ? definition.default.trim()
      : '';
  }

  function subWorkflowRef(node: any): any {
    if (!node || node.type !== 'task' || node.action !== 'workflow.run') return '';
    return resolveWorkflowRef(node.params?.workflow);
  }

  /** 请求打开子工作流视图；当前有未保存修改时先询问保存/放弃。 */
  function requestOpenSubWorkflow(nodeId: string): void {
    const node = nodeById(nodeId);
    requestOpenWorkflowReference(subWorkflowRef(node), nodeId);
  }

  function requestOpenWorkflowReference(reference: any, nodeId: string = ''): void {
    if (!reference) return;
    const doOpen = (saveText: any) => vscode.postMessage({ type: 'openSubWorkflow', nodeId, reference, saveText });
    if (state.dirty) {
      const rect = $('workflow-select').getBoundingClientRect();
      showMenu(rect.left, rect.bottom + 4, [
        { label: '保存并进入子工作流', run: () => doOpen(JSON.stringify(state.raw, null, 2) + '\n') },
        { label: '放弃修改并进入', run: () => doOpen(undefined) },
        'separator',
        { label: '取消', run: () => {} },
      ]);
    } else {
      doOpen(undefined);
    }
  }

  function compositeSubtitle(node: any): string {
    const count = Array.isArray(node.children) ? node.children.length : 0;
    if (node.type === 'root') return count ? 'Tree Root' : '等待连接';
    if (node.type === 'simple_parallel') return `${count}/2 · ${node.finish_mode === 'wait_for_background' ? '等待后台' : '中止后台'}`;
    if (node.type === 'instance_parallel') {
      const runs = Array.isArray(node.runs) ? node.runs : [];
      return `${runs.length} 个实例 · ${node.wait_for === 'any' ? '任一完成' : '全部完成'}`;
    }
    return `${count} 个有序子节点`;
  }

  function decoratorLabel(decorator: any): string {
    if (!decorator) return 'Decorator';
    if (decorator.type === 'condition') {
      const text = conditionToText(decorator.expression) || conditionSummary(decorator.expression);
      return `Condition · ${compactValue(text, 60)}`;
    }
    if (decorator.type === 'cooldown') return `Cooldown · ${compactValue(decorator.seconds, 22)}${isBindingValue(decorator.seconds) ? '' : 's'}`;
    if (decorator.type === 'timeout') return `Time Limit · ${compactValue(decorator.seconds, 22)}${isBindingValue(decorator.seconds) ? '' : 's'}`;
    if (decorator.type === 'retry') return `Retry · ${compactValue(decorator.attempts, 22)}${isBindingValue(decorator.attempts) ? '' : ' 次'}`;
    if (decorator.type === 'repeat') return `Repeat · ${compactValue(decorator.count, 22)}${decorator.count && typeof decorator.count === 'object' ? '' : ' 次'}`;
    if (decorator.type === 'do_once') return `Do Once · ${isBindingValue(decorator.reset_on_failure) ? compactValue(decorator.reset_on_failure, 22) : decorator.reset_on_failure ? '成功才锁定' : '整个运行只执行一次'}`;
    return String(decorator.type || 'Decorator');
  }

  function conditionSummary(expression: any): string {
    if (typeof expression === 'boolean') return expression ? 'True' : 'False';
    if (!expression || typeof expression !== 'object') return '未配置';
    const key = Object.keys(expression)[0];
    return key ? key.toUpperCase() : '未配置';
  }

  const CONDITION_VERBS: Record<string, string> = {
    eq: '等于', ne: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', contains: '包含',
  };

  /** 条件的最大解释深度；再深就停下来，避免病态嵌套把回读整句撑爆。 */
  const CONDITION_MAX_DEPTH = 6;

  function conditionOperandText(value: any, depth: number): string {
    if (isBindingValue(value)) return referenceLabel(value.ref);
    if (value === null || value === undefined) return '空';
    if (typeof value === 'string') return `“${value}”`;
    if (typeof value === 'object') return depth >= CONDITION_MAX_DEPTH ? '…' : JSON.stringify(value);
    return String(value);
  }

  /**
   * 把条件表达式读成一句中文，供详情面板回读和卡片摘要使用。
   * 认不出来的结构返回空串，让调用方隐藏这一行——宁可不说，也不能说错。
   */
  function conditionToText(expression: any, depth = 0): string {
    if (typeof expression === 'boolean') return expression ? '始终满足' : '始终不满足';
    if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return '';
    if (depth >= CONDITION_MAX_DEPTH) return '';
    const key = Object.keys(expression)[0];
    if (!key) return '';
    const operands = expression[key];
    if (key === 'exists') return isBindingValue(operands) ? `${referenceLabel(operands.ref)} 存在` : '';
    if (key === 'not') {
      const inner = conditionToText(operands, depth + 1);
      return inner ? `不是（${inner}）` : '';
    }
    if (key === 'and' || key === 'or') {
      const parts = (Array.isArray(operands) ? operands : [])
        .map((item: any) => conditionToText(item, depth + 1))
        .filter(Boolean);
      if (!parts.length) return '';
      if (parts.length === 1) return parts[0];
      return `（${parts.join(key === 'and' ? ' 并且 ' : ' 或者 ')}）`;
    }
    const verb = CONDITION_VERBS[key];
    const pair = Array.isArray(operands) ? operands : [];
    if (!verb || pair.length < 2) return '';
    return `${conditionOperandText(pair[0], depth)} ${verb} ${conditionOperandText(pair[1], depth)}`;
  }

  /** 装饰器条件的中文回读整句；解释不了时返回空串。 */
  function conditionSentence(expression: any): string {
    const text = conditionToText(expression);
    return text ? `当 ${text} 时执行` : '';
  }

  return {
    resolveWorkflowRef, subWorkflowRef, requestOpenSubWorkflow, requestOpenWorkflowReference,
    compositeSubtitle, decoratorLabel, conditionSummary, conditionToText, conditionSentence,
  };
}
