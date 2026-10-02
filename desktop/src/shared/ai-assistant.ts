export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface AiSettingsUpdate {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** Omitted means keep the saved key; empty means remove it. */
  apiKey?: string;
}

export interface AiSuggestionRequest {
  mode: 'name' | 'advice' | 'node';
  context: string;
  instruction: string;
  /** Project-relative image assets; resolved and bounded in the main process. */
  templatePaths?: string[];
  candidates?: AiNodeCandidate[];
}

export interface AiNodeCandidate {
  id: string;
  title: string;
  type: string;
  action?: string;
  description?: string;
  parameterNames?: string[];
}
export interface AiNodeRecommendation { id: string; reason: string }

export interface AiSuggestionResult {
  names: string[];
  advice: string[];
  nodes?: AiNodeRecommendation[];
}

export function parseAiNodeRecommendations(content: string, candidates: AiNodeCandidate[]): AiSuggestionResult {
  let value: any;
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('AI 返回格式不正确，请重新获取推荐'); }
  const allowed = new Set(candidates.map(item => item.id)), seen = new Set<string>();
  const nodes: AiNodeRecommendation[] = [];
  for (const item of Array.isArray(value?.nodes) ? value.nodes : []) {
    if (!item || typeof item.id !== 'string' || !allowed.has(item.id) || seen.has(item.id)
      || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 1000) continue;
    seen.add(item.id); nodes.push({ id: item.id, reason: item.reason.trim() });
    if (nodes.length === 5) break;
  }
  if (!nodes.length) throw new Error('AI 未推荐可用节点，请补充下一步目标后重试');
  return { names: [], advice: [], nodes };
}

export function completionUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请填写有效的 AI 接口地址'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('AI 接口需使用 HTTPS，本机接口可使用 HTTP');
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址不能包含账号、查询参数或片段');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.toString();
}

/** Only the selected card and its action description are sent. Omit likely secrets. */
export function aiCardContext(node: any, action?: unknown): string {
  const selected = { type: node.type, name: node.name, action: node.action, params: node.params, condition: node.condition, actionDescription: action };
  const text = JSON.stringify(selected, (key, value) => /api.?key|password|secret|token|authorization/i.test(key) ? '[已隐藏]' : value);
  if (text.length > 16000) throw new Error('卡片内容过长，请缩减参数后重试');
  return text;
}

export function parseAiSuggestions(content: unknown): AiSuggestionResult {
  if (typeof content !== 'string') throw new Error('AI 未返回文本建议');
  let value: any;
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('AI 返回格式不正确，请重新获取建议'); }
  const strings = (items: unknown, limit: number, length: number): string[] => Array.isArray(items)
    ? [...new Set(items.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item && item.length <= length))].slice(0, limit)
    : [];
  const result = { names: strings(value?.names, 5, 80), advice: strings(value?.advice, 6, 1000) };
  if (!result.names.length && !result.advice.length) throw new Error('AI 未提供可用建议，请重新获取');
  return result;
}
