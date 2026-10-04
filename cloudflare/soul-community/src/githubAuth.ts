import { normalizeCommunityAuthor } from '../../../desktop/src/shared/soul-community';

export interface Statement {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface AuthEnv {
  DB: { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown> };
  GITHUB_CLIENT_ID?: string;
}
interface AccountRow { github_id: string; github_login: string; owner_hash: string; name: string }
interface Flow { device_code: string; legacy_owner_hash: string | null; expires_at: number; next_poll_at: number; interval_seconds: number }
export const json = (value: unknown, status = 200): Response => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export const digest = async (text: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
const random = (): string => [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
export class AuthError extends Error { constructor(message: string, readonly status = 401) { super(message); } }
const profile = (row: AccountRow) => ({ githubId: row.github_id, login: row.github_login, author: row.name });
async function github(path: string, body?: Record<string, string>, token?: string): Promise<any> {
  const response = await fetch(`${token ? 'https://api.github.com' : 'https://github.com'}${path}`, {
    method: body ? 'POST' : 'GET', headers: { Accept: 'application/json', 'User-Agent': 'onmyoji-soul-community', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body: new URLSearchParams(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AuthError('GitHub 服务暂时不可用，请稍后重新登录。', 502);
  const text = await response.text();
  if (text.length > 100_000) throw new AuthError('GitHub 登录响应无效。', 502);
  try { return JSON.parse(text); } catch { throw new AuthError('GitHub 登录响应格式无效，请稍后重试。', 502); }
}
export async function sessionAccount(request: Request, env: AuthEnv): Promise<AccountRow> {
  const raw = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!raw || !/^cs_[a-f0-9]{64}$/.test(raw)) throw new AuthError('请先使用 GitHub 登录。');
  const row = await env.DB.prepare('SELECT a.github_id, a.github_login, a.owner_hash, p.name FROM community_sessions s JOIN community_accounts a ON a.github_id = s.github_id JOIN community_authors p ON p.owner_hash = a.owner_hash WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await digest(raw), Date.now()).first<AccountRow>();
  if (!row) throw new AuthError('登录已过期，请重新使用 GitHub 登录。');
  return row;
}
export async function mutationOwner(request: Request, env: AuthEnv): Promise<string> {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer cs_')) return (await sessionAccount(request, env)).owner_hash;
  if (request.method === 'POST' && env.GITHUB_CLIENT_ID) throw new AuthError('请先使用 GitHub 登录后上传。');
  const raw = request.method === 'POST' ? request.headers.get('X-Delete-Token') : auth?.replace(/^Bearer /, '');
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new AuthError('上传管理凭据无效。', 400);
  const owner = await digest(raw);
  const bound = await env.DB.prepare('SELECT github_id FROM community_legacy_claims WHERE legacy_owner_hash = ? UNION ALL SELECT github_id FROM community_accounts WHERE owner_hash = ? LIMIT 1').bind(owner, owner).first();
  if (bound) throw new AuthError('此配置已绑定 GitHub 账号，请登录后管理。');
  return owner;
}
async function finishAccount(env: AuthEnv, id: string, login: string, legacy: string | null): Promise<AccountRow> {
  const linked = legacy ? await env.DB.prepare('SELECT github_id FROM community_accounts WHERE owner_hash = ? UNION ALL SELECT github_id FROM community_legacy_claims WHERE legacy_owner_hash = ? LIMIT 1').bind(legacy, legacy).first<{ github_id: string }>() : null;
  const transferable = legacy && (!linked || linked.github_id === id) ? legacy : null;
  // First login can keep the original owner key and signature without rewriting existing build IDs.
  await env.DB.prepare('INSERT OR IGNORE INTO community_accounts (github_id, github_login, owner_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, login, transferable ?? await digest(random()), new Date().toISOString()).run();
  let account = await env.DB.prepare('SELECT owner_hash FROM community_accounts WHERE github_id = ?').bind(id).first<{ owner_hash: string }>();
  if (!account) {
    // Another GitHub account may have claimed that local key during this request.
    await env.DB.prepare('INSERT OR IGNORE INTO community_accounts (github_id, github_login, owner_hash, created_at) VALUES (?, ?, ?, ?)').bind(id, login, await digest(random()), new Date().toISOString()).run();
    account = await env.DB.prepare('SELECT owner_hash FROM community_accounts WHERE github_id = ?').bind(id).first<{ owner_hash: string }>();
  }
  if (!account) throw new AuthError('创建社区账号失败，请重新登录。', 503);
  const owner = account.owner_hash;
  const fallback = `GitHub-${id}-${random().slice(0, 6)}`;
  const signature = login.slice(0, 30);
  await env.DB.prepare('INSERT INTO community_authors (owner_hash, author_key, name) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(owner, signature.toLowerCase(), signature).run();
  await env.DB.prepare('INSERT INTO community_authors (owner_hash, author_key, name) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(owner, fallback.toLowerCase(), fallback).run();
  if (transferable) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO community_legacy_claims (legacy_owner_hash, github_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM community_accounts WHERE owner_hash = ? AND github_id <> ?) ON CONFLICT DO NOTHING').bind(transferable, id, transferable, id),
      env.DB.prepare('UPDATE builds SET delete_hash = ? WHERE delete_hash = ? AND EXISTS (SELECT 1 FROM community_legacy_claims WHERE legacy_owner_hash = ? AND github_id = ?)').bind(owner, transferable, transferable, id),
      env.DB.prepare('DELETE FROM community_authors WHERE owner_hash = ? AND owner_hash <> ? AND EXISTS (SELECT 1 FROM community_legacy_claims WHERE legacy_owner_hash = ? AND github_id = ?)').bind(transferable, owner, transferable, id),
    ]);
  }
  await env.DB.prepare('UPDATE community_accounts SET github_login = ? WHERE github_id = ?').bind(login, id).run();
  const result = await env.DB.prepare('SELECT a.github_id, a.github_login, a.owner_hash, p.name FROM community_accounts a JOIN community_authors p ON p.owner_hash = a.owner_hash WHERE a.github_id = ?').bind(id).first<AccountRow>();
  if (!result) throw new AuthError('账号署名创建失败，请稍后重试。', 503);
  return result;
}
export async function authRoute(request: Request, env: AuthEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/v1/account' && request.method === 'GET') return json({ user: profile(await sessionAccount(request, env)) });
  if (path === '/v1/account' && request.method === 'POST') {
    const account = await sessionAccount(request, env);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AuthError('请提交 JSON 格式的署名。', 400);
    const reader = request.body?.getReader(); if (!reader) throw new AuthError('署名不能为空。', 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > 2048) { await reader.cancel(); throw new AuthError('改名请求过大。', 413); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let author: string;
    try { author = normalizeCommunityAuthor(JSON.parse(new TextDecoder().decode(bytes))?.author); }
    catch (error) { throw new AuthError(error instanceof SyntaxError ? '改名请求格式无效。' : error instanceof Error ? error.message : '署名无效。', 400); }
    try {
      await env.DB.prepare('UPDATE community_authors SET author_key = ?, name = ? WHERE owner_hash = ?').bind(author.toLocaleLowerCase('en-US'), author, account.owner_hash).run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new AuthError('这个署名已被其他用户使用，请换一个署名。', 409);
      throw error;
    }
    return json({ user: profile({ ...account, name: author }) });
  }
  if (path === '/v1/auth/logout' && request.method === 'POST') {
    await sessionAccount(request, env);
    await env.DB.prepare('DELETE FROM community_sessions WHERE token_hash = ?').bind(await digest(request.headers.get('Authorization')!.slice(7))).run();
    return json({ loggedOut: true });
  }
  if (path === '/v1/my-builds' && request.method === 'GET') {
    const account = await sessionAccount(request, env), cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor && !/^[a-f0-9]{64}$/.test(cursor)) throw new AuthError('上传列表分页标识无效。', 400);
    const rows = await env.DB.prepare(`SELECT id, json_extract(payload, '$.title') AS title FROM builds WHERE delete_hash = ? ${cursor ? 'AND id > ?' : ''} ORDER BY id LIMIT 51`).bind(account.owner_hash, ...(cursor ? [cursor] : [])).all<{ id: string; title: string }>();
    return json({ uploads: rows.results.slice(0, 50), cursor: rows.results.length > 50 ? rows.results[49].id : null });
  }
  if (!['/v1/auth/github/start', '/v1/auth/github/poll', '/v1/auth/github/cancel'].includes(path)) return json({ error: '接口不存在。' }, 404);
  if (request.method !== 'POST') return json({ error: '请求方法不支持。' }, 405);
  if (!env.GITHUB_CLIENT_ID) throw new AuthError('GitHub 登录尚未配置，请联系社区服务管理员。', 503);
  const now = Date.now();
  if (path.endsWith('/start')) {
    const old = request.headers.get('X-Delete-Token');
    if (old && !/^[a-f0-9]{64}$/.test(old)) throw new AuthError('本机上传管理凭据无效。', 400);
    const data = await github('/login/device/code', { client_id: env.GITHUB_CLIENT_ID, scope: '' });
    if (typeof data.device_code !== 'string' || !/^[a-zA-Z0-9_-]{20,200}$/.test(data.device_code) || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.user_code) || data.verification_uri !== 'https://github.com/login/device'
      || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 900 || !Number.isFinite(data.interval) || data.interval < 5 || data.interval > 60) throw new AuthError('GitHub 授权码响应无效。', 502);
    const flow = random(), expiresAt = now + data.expires_in * 1000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM community_login_flows WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM community_sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('INSERT INTO community_login_flows VALUES (?, ?, ?, ?, ?, ?)').bind(await digest(flow), data.device_code, old ? await digest(old) : null, expiresAt, now + data.interval * 1000, data.interval),
    ]);
    return json({ flowToken: flow, userCode: data.user_code, verificationUrl: data.verification_uri, expiresAt, interval: data.interval });
  }
  const raw = request.headers.get('X-Login-Token');
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new AuthError('登录请求无效，请重新登录。', 400);
  const hash = await digest(raw);
  if (path.endsWith('/cancel')) { await env.DB.prepare('DELETE FROM community_login_flows WHERE flow_hash = ?').bind(hash).run(); return json({ cancelled: true }); }
  const flow = await env.DB.prepare('SELECT * FROM community_login_flows WHERE flow_hash = ?').bind(hash).first<Flow>();
  if (!flow || flow.expires_at <= now) throw new AuthError('授权码已过期，请重新登录。', 410);
  // The atomic claim limits concurrent polls before calling GitHub.
  const claimed = await env.DB.prepare('UPDATE community_login_flows SET next_poll_at = ? WHERE flow_hash = ? AND next_poll_at <= ? RETURNING flow_hash').bind(now + 60_000, hash, now).first();
  if (!claimed) return json({ status: 'pending', interval: Math.max(1, Math.ceil((flow.next_poll_at - now) / 1000)) });
  const data = await github('/login/oauth/access_token', { client_id: env.GITHUB_CLIENT_ID, device_code: flow.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  if (['authorization_pending', 'slow_down'].includes(data.error)) {
    const interval = data.error === 'slow_down' ? Math.min(60, Math.max(flow.interval_seconds + 5, Number(data.interval) || 0)) : flow.interval_seconds;
    await env.DB.prepare('UPDATE community_login_flows SET next_poll_at = ?, interval_seconds = ? WHERE flow_hash = ?').bind(Date.now() + interval * 1000, interval, hash).run();
    return json({ status: 'pending', interval });
  }
  if (data.error) { await env.DB.prepare('DELETE FROM community_login_flows WHERE flow_hash = ?').bind(hash).run(); throw new AuthError('GitHub 授权被取消或已过期，请重新登录。', 410); }
  if (typeof data.access_token !== 'string' || data.access_token.length > 300) throw new AuthError('GitHub 登录响应无效。', 502);
  const identity = await github('/user', undefined, data.access_token);
  if (!Number.isSafeInteger(identity.id) || identity.id <= 0 || typeof identity.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(identity.login) || identity.type !== 'User') throw new AuthError('GitHub 账号信息无效。', 502);
  const account = await finishAccount(env, String(identity.id), identity.login, flow.legacy_owner_hash);
  const sessionToken = `cs_${random()}`, expiresAt = Date.now() + 30 * 86400_000;
  // Only token hashes are persisted. GitHub access/refresh tokens are never saved or returned.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO community_sessions VALUES (?, ?, ?)').bind(await digest(sessionToken), account.github_id, expiresAt),
    env.DB.prepare('DELETE FROM community_login_flows WHERE flow_hash = ?').bind(hash),
  ]);
  return json({ status: 'complete', sessionToken, expiresAt, user: profile(account) });
}
