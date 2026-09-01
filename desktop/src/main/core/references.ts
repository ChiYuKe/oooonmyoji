/**
 * 引用图：分析工作流与模板图片在项目内的相互引用关系。
 * 纯逻辑模块（不依赖 electron），便于 Node 冒烟测试。
 *
 * 引用模式：
 * - workflow.run 任务节点 `params.workflow`（工作流 id / JSON 文件名 / workflows/ 下路径）
 * - instance_parallel 节点 `runs[].workflow`（同上）
 * - vision.match_template / vision.wait_template 节点 `params.template`：
 *   - 字符串 → 模板相对路径（如 assets/templates/...）
 *   - 绑定 { ref: 'blackboard.X' } → 通过该工作流 blackboard.X.default 解析为模板路径
 * - blackboard 中 type === 'asset' 的变量，其 default 为模板相对路径（asset-default）
 * - assets/templates/rewards/catalog.json 中 templates[].template（相对目录文件名）
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseWorkflow, type WorkflowInfo } from './workflow';
import type {
  ReferenceContext,
  ReferenceContextKind,
  ReferenceGraph,
  ReferenceItem,
  ReferenceNode,
  ReferenceTargetKind,
} from '../../shared/contracts';

const TEMPLATE_ACTIONS = new Set(['vision.match_template', 'vision.wait_template']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const REWARD_CATALOG_REL = 'assets/templates/rewards/catalog.json';
const MAX_ITEMS = 120;
const MAX_CONTEXTS = 24;

/** 项目相对路径规范化：统一正斜杠、去掉 ./ 前缀与开头的斜杠。 */
function normalizeRel(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
}

/** 模板引用规范化：把可能含 windows 反斜杠 / ./ 前缀的引用归一为项目相对路径。 */
function normalizeTemplatePath(value: string): string {
  return normalizeRel(value).replace(/^assets\//i, 'assets/');
}

function detectKind(rel: string): ReferenceTargetKind {
  const normalized = normalizeRel(rel).toLowerCase();
  if (normalized.startsWith('workflows/') && normalized.endsWith('.json')) return 'workflow';
  if (normalized === REWARD_CATALOG_REL) return 'catalog';
  if (normalized.startsWith('assets/')) {
    const extension = normalized.slice(normalized.lastIndexOf('.'));
    if (IMAGE_EXTENSIONS.has(extension)) return 'asset';
  }
  return 'other';
}

function basenameOf(rel: string): string {
  const normalized = normalizeRel(rel);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

interface WorkflowDoc {
  rel: string;
  name: string;
  id?: string;
  info: WorkflowInfo;
}

interface OutgoingRef {
  kind: ReferenceContextKind;
  /** 引用原文。 */
  reference: string;
  nodeId?: string;
  nodeName?: string;
  variable?: string;
  /** 模板引用解析出的项目相对路径（仅模板类）。 */
  assetRel?: string;
}

/** 一个工作流文件是否被指定引用文本命中（id / 文件名 / 路径，带或不带 .json 与 workflows/ 前缀）。 */
function workflowMatchesReference(reference: string, doc: WorkflowDoc | { rel: string; name: string; id?: string }): boolean {
  const ref = reference.replace(/\\/g, '/');
  if (!ref) return false;
  const candidateWithExt = ref.toLowerCase().endsWith('.json') ? ref : `${ref}.json`;
  const candidateNoExt = ref.toLowerCase().endsWith('.json') ? ref.slice(0, -5) : ref;
  const rel = normalizeRel(doc.rel);
  const relNoPrefix = rel.replace(/^workflows\//i, '');
  const relNoExt = relNoPrefix.toLowerCase().endsWith('.json') ? relNoPrefix.slice(0, -5) : relNoPrefix;
  if (doc.id && ref === doc.id) return true;
  if (relNoPrefix === candidateWithExt || relNoPrefix === ref || relNoPrefix === candidateNoExt) return true;
  if (relNoExt === candidateNoExt || relNoExt === ref) return true;
  if (doc.name === candidateWithExt || doc.name === ref) return true;
  if (rel === candidateWithExt || rel === ref) return true;
  return false;
}

function collectOutgoingRefs(doc: WorkflowDoc): OutgoingRef[] {
  const out: OutgoingRef[] = [];
  for (const node of doc.info.nodes) {
    const nodeName = node.name?.trim() || undefined;
    if (node.type === 'task' && node.action === 'workflow.run') {
      const reference = node.params.workflow;
      if (typeof reference === 'string' && reference.trim()) {
        out.push({ kind: 'workflow.run', reference: reference.trim(), nodeId: node.id, nodeName });
      }
    } else if (node.type === 'instance_parallel') {
      for (const run of node.runs) {
        const reference = run.workflow;
        if (typeof reference === 'string' && reference.trim()) {
          out.push({ kind: 'instance_parallel', reference: reference.trim(), nodeId: node.id, nodeName });
        }
      }
    }
    if (node.type !== 'task' || !node.action || !TEMPLATE_ACTIONS.has(node.action)) continue;
    const template = node.params.template;
    if (typeof template === 'string' && template.trim()) {
      out.push({
        kind: 'template',
        reference: template.trim(),
        nodeId: node.id,
        nodeName,
        assetRel: normalizeTemplatePath(template),
      });
    } else if (typeof template === 'object' && template !== null && !Array.isArray(template) && typeof (template as { ref?: unknown }).ref === 'string') {
      const binding = template as { ref: string };
      const variable = binding.ref.replace(/^blackboard\./i, '');
      const definition = doc.info.blackboard[variable];
      const resolved = typeof definition?.default === 'string' ? definition.default : undefined;
      if (resolved) {
        out.push({
          kind: 'template-binding',
          reference: binding.ref,
          nodeId: node.id,
          nodeName,
          variable,
          assetRel: normalizeTemplatePath(resolved),
        });
      }
    }
  }
  // blackboard asset 变量默认值
  for (const [variable, definition] of Object.entries(doc.info.blackboard)) {
    if (definition.type === 'asset' && typeof definition.default === 'string' && definition.default.trim()) {
      out.push({
        kind: 'asset-default',
        reference: definition.default.trim(),
        variable,
        assetRel: normalizeTemplatePath(definition.default),
      });
    }
  }
  return out;
}

/** 收集 rewards 目录条目：返回每条条目的完整项目相对路径 + 展示名。 */
async function loadRewardCatalogEntries(projectRoot: string): Promise<Array<{ rel: string; label: string; id?: string }>> {
  const catalogFile = path.join(projectRoot, ...REWARD_CATALOG_REL.split('/'));
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.promises.readFile(catalogFile, 'utf8'));
  } catch {
    return [];
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { templates?: unknown }).templates)) return [];
  const catalogDir = REWARD_CATALOG_REL.slice(0, REWARD_CATALOG_REL.lastIndexOf('/'));
  const entries: Array<{ rel: string; label: string; id?: string }> = [];
  for (const entry of (raw as { templates: unknown[] }).templates) {
    if (typeof entry !== 'object' || entry === null) continue;
    const template = (entry as { template?: unknown }).template;
    if (typeof template !== 'string' || !template.trim()) continue;
    const rel = normalizeRel(`${catalogDir}/${template}`);
    const id = typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id : undefined;
    const name = typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name : undefined;
    entries.push({ rel, label: name || id || basenameOf(rel), id });
  }
  return entries;
}

async function exists(projectRoot: string, rel: string): Promise<boolean> {
  try {
    await fs.promises.stat(path.join(projectRoot, rel));
    return true;
  } catch {
    return false;
  }
}

async function collectWorkflowDocs(projectRoot: string): Promise<WorkflowDoc[]> {
  const workflowRoot = path.join(projectRoot, 'workflows');
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(absolutePath);
    }
  };
  await visit(workflowRoot);
  const docs: WorkflowDoc[] = [];
  for (const file of files.slice(0, 500)) {
    try {
      const raw = JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown;
      const info = parseWorkflow(raw);
      docs.push({
        rel: normalizeRel(path.relative(projectRoot, file)),
        name: path.basename(file),
        id: info.id,
        info,
      });
    } catch {
      // 无法解析的工作流跳过（引用关系里不包含它）。
    }
  }
  return docs;
}

function makeNode(kind: ReferenceTargetKind, rel: string, existsFlag: boolean, doc?: WorkflowDoc): ReferenceNode {
  const normalized = normalizeRel(rel);
  const node: ReferenceNode = {
    kind: kind === 'catalog' ? 'catalog' : kind,
    path: normalized,
    name: doc?.name ?? basenameOf(normalized),
    exists: existsFlag,
  };
  if (doc?.id) node.workflowId = doc.id;
  if (doc?.info.description) node.description = doc.info.description;
  return node;
}

function sortItems(items: ReferenceItem[]): ReferenceItem[] {
  return items.sort((left, right) => {
    const byName = left.target.name.localeCompare(right.target.name, 'zh-CN');
    if (byName !== 0) return byName;
    return left.target.path.localeCompare(right.target.path, 'zh-CN');
  });
}

function groupContexts(items: Array<{ rel: string; contexts: ReferenceContext[] }>): ReferenceItem[] {
  const byRel = new Map<string, ReferenceContext[]>();
  for (const item of items) {
    const existing = byRel.get(item.rel);
    if (existing) existing.push(...item.contexts);
    else byRel.set(item.rel, [...item.contexts]);
  }
  return [...byRel.entries()].map(([rel, contexts]) => ({ target: { path: rel } as ReferenceNode, contexts }));
}

/**
 * 构建目标节点（工作流 / 模板图片 / 奖励目录）的引用图。
 * @param projectRoot - 项目根目录。
 * @param rawTarget - 项目相对路径（正斜杠或反斜杠均可）。
 */
export async function buildReferenceGraph(projectRoot: string, rawTarget: string): Promise<ReferenceGraph> {
  const targetRel = normalizeRel(rawTarget);
  const targetKind = detectKind(targetRel);
  const targetExists = await exists(projectRoot, targetRel);
  const docs = await collectWorkflowDocs(projectRoot);
  const catalogEntries = await loadRewardCatalogEntries(projectRoot);
  const targetDoc = docs.find((doc) => normalizeRel(doc.rel) === targetRel);

  const target: ReferenceNode = makeNode(targetKind, targetRel, targetExists, targetDoc);

  const referencedBy: ReferenceItem[] = [];
  const references: ReferenceItem[] = [];

  if (targetKind === 'workflow') {
    // 谁引用了我：其他工作流通过 workflow.run / instance_parallel 指向目标。
    const bySource = new Map<string, ReferenceContext[]>();
    for (const doc of docs) {
      if (normalizeRel(doc.rel) === targetRel) continue;
      const contexts: ReferenceContext[] = [];
      for (const ref of collectOutgoingRefs(doc)) {
        if ((ref.kind === 'workflow.run' || ref.kind === 'instance_parallel') && workflowMatchesReference(ref.reference, targetDoc ?? { rel: targetRel, name: basenameOf(targetRel) })) {
          contexts.push({
            kind: ref.kind,
            label: ref.nodeName || ref.nodeId || ref.reference,
            nodeId: ref.nodeId,
            nodeName: ref.nodeName,
            reference: ref.reference,
          });
        }
      }
      if (contexts.length) bySource.set(doc.rel, contexts);
    }
    for (const [rel, contexts] of bySource) {
      const doc = docs.find((candidate) => candidate.rel === rel);
      const sourceNode: ReferenceNode = { kind: 'workflow', path: rel, name: doc?.name ?? basenameOf(rel), exists: true };
      if (doc?.id) sourceNode.workflowId = doc.id;
      if (doc?.info.description) sourceNode.description = doc.info.description;
      referencedBy.push({ target: sourceNode, contexts: contexts.slice(0, MAX_CONTEXTS) });
    }
    // 我引用了谁：目标的子工作流 + 模板资产。
    if (targetDoc) {
      const grouped = groupContexts(collectOutgoingRefs(targetDoc)
        .filter((ref) => ref.kind === 'workflow.run' || ref.kind === 'instance_parallel')
        .map((ref) => {
          const matched = docs.find((doc) => normalizeRel(doc.rel) !== targetRel && workflowMatchesReference(ref.reference, doc));
          const rel = matched?.rel ?? normalizeRel(ref.reference).replace(/^workflows\//i, 'workflows/');
          return {
            rel,
            contexts: [{
              kind: ref.kind,
              label: ref.nodeName || ref.nodeId || ref.reference,
              nodeId: ref.nodeId,
              nodeName: ref.nodeName,
              reference: ref.reference,
            } satisfies ReferenceContext],
          };
        }));
      for (const item of grouped) {
        const matched = docs.find((doc) => normalizeRel(doc.rel) === normalizeRel(item.target.path));
        item.target = makeNode('workflow', item.target.path, Boolean(matched) || await exists(projectRoot, item.target.path), matched);
      }
      references.push(...grouped);
      // 模板资产引用
      const assetItems = groupContexts(collectOutgoingRefs(targetDoc)
        .filter((ref) => ref.assetRel && ref.kind !== 'workflow.run' && ref.kind !== 'instance_parallel')
        .map((ref) => ({
          rel: ref.assetRel!,
          contexts: [{
            kind: ref.kind,
            label: ref.variable ? `变量 ${ref.variable}` : ref.nodeName || ref.nodeId || ref.reference,
            nodeId: ref.nodeId,
            nodeName: ref.nodeName,
            variable: ref.variable,
            reference: ref.reference,
          } satisfies ReferenceContext],
        })));
      for (const item of assetItems) {
        item.target = makeNode('asset', item.target.path, await exists(projectRoot, item.target.path));
      }
      references.push(...assetItems);
    }
  } else if (targetKind === 'asset') {
    // 谁引用了我：工作流里的模板字符串 / 绑定解析 / asset 变量默认值 + rewards 目录。
    const bySource = new Map<string, ReferenceContext[]>();
    for (const doc of docs) {
      const contexts: ReferenceContext[] = [];
      for (const ref of collectOutgoingRefs(doc)) {
        if (!ref.assetRel) continue;
        if (normalizeRel(ref.assetRel).toLowerCase() !== targetRel.toLowerCase()) continue;
        contexts.push({
          kind: ref.kind,
          label: ref.variable ? `变量 ${ref.variable}` : ref.nodeName || ref.nodeId || ref.reference,
          nodeId: ref.nodeId,
          nodeName: ref.nodeName,
          variable: ref.variable,
          reference: ref.reference,
        });
      }
      if (contexts.length) bySource.set(doc.rel, contexts);
    }
    for (const [rel, contexts] of bySource) {
      const doc = docs.find((candidate) => candidate.rel === rel);
      const sourceNode: ReferenceNode = { kind: 'workflow', path: rel, name: doc?.name ?? basenameOf(rel), exists: true };
      if (doc?.id) sourceNode.workflowId = doc.id;
      if (doc?.info.description) sourceNode.description = doc.info.description;
      referencedBy.push({ target: sourceNode, contexts: contexts.slice(0, MAX_CONTEXTS) });
    }
    // rewards 目录引用
    const catalogHits = catalogEntries.filter((entry) => normalizeRel(entry.rel).toLowerCase() === targetRel.toLowerCase());
    if (catalogHits.length) {
      referencedBy.push({
        target: { kind: 'catalog', path: REWARD_CATALOG_REL, name: 'catalog.json', exists: true },
        contexts: catalogHits.slice(0, MAX_CONTEXTS).map((entry) => ({
          kind: 'catalog-entry',
          label: entry.label,
          reference: entry.rel,
        })),
      });
    }
  } else if (targetKind === 'catalog') {
    // 目录引用了哪些模板资产。
    for (const entry of catalogEntries) {
      references.push({
        target: makeNode('asset', entry.rel, await exists(projectRoot, entry.rel)),
        contexts: [{ kind: 'catalog-entry', label: entry.label, reference: entry.rel }],
      });
    }
  }

  referencedBy.splice(MAX_ITEMS);
  references.splice(MAX_ITEMS);
  sortItems(referencedBy);
  sortItems(references);

  return { target, referencedBy, references };
}
