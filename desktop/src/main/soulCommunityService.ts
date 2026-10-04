import { app, net, safeStorage, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { SoulCommunityCache } from './soulCommunityCache';
import { SoulCommunityAuthStore } from './soulCommunityAuthStore';
import { COMMUNITY_MAX_BYTES, normalizeCommunityAccount, normalizeCommunityAuthor, normalizeCommunityBuild, normalizeCommunityEndpoint, normalizeCommunityEntry, normalizeCommunityQuery } from '../shared/soul-community';
import type { CommunityPage, CommunityAccountState, CommunityLoginPrompt, CommunityLoginResult, CommunityOwnedPage } from '../shared/soul-community';

let cache: SoulCommunityCache | undefined;
const communityCache = (): SoulCommunityCache => cache ??= new SoulCommunityCache({
  read: () => readFileSync(path.join(app.getPath('userData'), 'soul-community-cache.json'), 'utf8'),
  write: value => {
    const directory = app.getPath('userData'), filename = path.join(directory, 'soul-community-cache.json');
    mkdirSync(directory, { recursive: true }); writeFileSync(`${filename}.tmp`, value, 'utf8'); renameSync(`${filename}.tmp`, filename);
  },
});
let auth: SoulCommunityAuthStore | undefined;
const authStore = (): SoulCommunityAuthStore => auth ??= new SoulCommunityAuthStore({
  available: () => !!safeStorage?.isEncryptionAvailable(),
  encrypt: value => safeStorage.encryptString(value).toString('base64'),
  decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
}, {
  read: () => readFileSync(path.join(app.getPath('userData'), 'soul-community-auth.json'), 'utf8'),
  write: value => {
    const directory = app.getPath('userData'), filename = path.join(directory, 'soul-community-auth.json');
    mkdirSync(directory, { recursive: true }); writeFileSync(`${filename}.tmp`, value, 'utf8'); renameSync(`${filename}.tmp`, filename);
  },
});
class CommunityRequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }
interface PendingLogin extends CommunityLoginPrompt { flowToken: string }
const pendingLogins = new Map<string, PendingLogin>();
const loginAttempts = new Map<string, symbol>();

async function request(endpoint: unknown, path: string, init?: RequestInit): Promise<unknown> {
  const url = `${normalizeCommunityEndpoint(endpoint)}${path}`;
  let response: Response;
  try { response = await net.fetch(url, { ...init, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000) }); }
  catch { throw Error('社区服务连接失败或超时，请检查服务地址及网络。'); }
  const body = await response.text();
  if (body.length > 1_500_000) throw Error('社区服务返回的数据过大。');
  let value: any; try { value = JSON.parse(body); } catch { throw Error('社区服务返回的数据格式无效。'); }
  if (!response.ok) {
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (response.status === 401 && authorization?.startsWith('Bearer cs_')) {
      const address = normalizeCommunityEndpoint(endpoint);
      if (authStore().get(address)?.token === authorization.slice(7)) authStore().remove(address);
    }
    throw new CommunityRequestError(typeof value?.error === 'string' ? value.error.slice(0, 200) : `社区服务暂不可用（${response.status}）。`, response.status);
  }
  return value;
}
export async function listCommunityBuilds(endpoint: unknown, value: unknown, options?: unknown): Promise<CommunityPage> {
  const address = normalizeCommunityEndpoint(endpoint);
  const query = normalizeCommunityQuery(value);
  const params = new URLSearchParams(Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]));
  const refresh = !!options && typeof options === 'object' && (options as { refresh?: unknown }).refresh === true;
  const page = await communityCache().list(address, query, () => request(address, `/v1/builds?${params}`) as Promise<CommunityPage>, refresh);
  return { ...page, entries: page.entries.filter(entry => entry.heroId === query.heroId && entry.objective === query.objective) };
}
const token = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('上传管理凭据无效。'); return value;
};
export async function uploadCommunityBuild(endpoint: unknown, value: unknown, deleteToken: unknown): Promise<{ id: string; createdAt: string; author: string }> {
  const build = normalizeCommunityBuild(value), body = JSON.stringify(build);
  if (Buffer.byteLength(body) > COMMUNITY_MAX_BYTES) throw Error('社区方案过大。');
  const session = authStore().get(normalizeCommunityEndpoint(endpoint));
  const result = await request(endpoint, '/v1/builds', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : { 'X-Delete-Token': token(deleteToken) }) } }) as { id: string; createdAt: string; author?: string };
  const entry = normalizeCommunityEntry({ ...build, ...result }); communityCache().invalidate(normalizeCommunityEndpoint(endpoint));
  if (session) authStore().set(normalizeCommunityEndpoint(endpoint), { ...session, user: { ...session.user, author: entry.author } });
  return { id: entry.id, createdAt: entry.createdAt, author: entry.author };
}
export async function deleteCommunityBuild(endpoint: unknown, id: unknown, deleteToken: unknown): Promise<void> {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw Error('社区方案标识无效。');
  const session = authStore().get(normalizeCommunityEndpoint(endpoint));
  await request(endpoint, `/v1/builds/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session?.token ?? token(deleteToken)}` } });
  communityCache().invalidate(normalizeCommunityEndpoint(endpoint));
}
export async function getCommunityAccount(endpoint: unknown): Promise<CommunityAccountState> {
  const address = normalizeCommunityEndpoint(endpoint), store = authStore(), session = store.get(address);
  if (!session) return { user: null, persistent: store.persistent() };
  try {
    const data = await request(address, '/v1/account', { headers: { Authorization: `Bearer ${session.token}` } }) as { user: unknown };
    const user = normalizeCommunityAccount(data.user); store.set(address, { ...session, user });
    return { user, persistent: store.persistent() };
  } catch (error) {
    if (error instanceof CommunityRequestError && error.status === 401) { store.remove(address); return { user: null, persistent: store.persistent() }; }
    return { user: session.user, persistent: store.persistent(), offline: true };
  }
}
export async function renameCommunityAccount(endpoint: unknown, value: unknown): Promise<CommunityAccountState> {
  const address = normalizeCommunityEndpoint(endpoint), author = normalizeCommunityAuthor(value), store = authStore(), session = store.get(address);
  if (!session) throw Error('请先使用 GitHub 登录。');
  const result = await request(address, '/v1/account', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ author }) }) as { user: unknown };
  const user = normalizeCommunityAccount(result.user);
  if (user.githubId !== session.user.githubId) throw Error('社区账号响应无效。');
  communityCache().invalidate(address);
  if (store.get(address)?.token !== session.token) throw Error('登录状态已变更，请重新打开账号窗口。');
  store.set(address, { ...session, user });
  return { user, persistent: store.persistent() };
}
export async function startCommunityLogin(endpoint: unknown, legacyToken: unknown): Promise<CommunityLoginPrompt> {
  const address = normalizeCommunityEndpoint(endpoint);
  if (pendingLogins.has(address)) await cancelCommunityLogin(address);
  const attempt = Symbol(); loginAttempts.set(address, attempt);
  let data: PendingLogin;
  try { data = await request(address, '/v1/auth/github/start', { method: 'POST', headers: { 'X-Delete-Token': token(legacyToken) } }) as PendingLogin; }
  catch (error) { if (loginAttempts.get(address) === attempt) loginAttempts.delete(address); throw error; }
  if (!/^[a-f0-9]{64}$/.test(data.flowToken) || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.userCode) || data.verificationUrl !== 'https://github.com/login/device'
    || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 901_000 || !Number.isInteger(data.interval) || data.interval < 5 || data.interval > 60) throw Error('GitHub 登录服务响应无效。');
  if (loginAttempts.get(address) !== attempt) {
    try { await request(address, '/v1/auth/github/cancel', { method: 'POST', headers: { 'X-Login-Token': data.flowToken } }); } catch { /* Server expiry also releases the cancelled flow. */ }
    throw Error('本次登录已取消。');
  }
  pendingLogins.set(address, data);
  return { userCode: data.userCode, verificationUrl: data.verificationUrl, expiresAt: data.expiresAt, interval: data.interval };
}
export async function openCommunityLogin(endpoint: unknown): Promise<void> {
  const data = pendingLogins.get(normalizeCommunityEndpoint(endpoint));
  if (!data || data.expiresAt <= Date.now()) throw Error('授权码已过期，请重新登录。');
  await shell.openExternal('https://github.com/login/device');
}
export async function pollCommunityLogin(endpoint: unknown): Promise<CommunityLoginResult> {
  const address = normalizeCommunityEndpoint(endpoint), pending = pendingLogins.get(address);
  if (!pending || pending.expiresAt <= Date.now()) { pendingLogins.delete(address); throw Error('授权码已过期，请重新登录。'); }
  const result = await request(address, '/v1/auth/github/poll', { method: 'POST', headers: { 'X-Login-Token': pending.flowToken } }) as any;
  if (pendingLogins.get(address) !== pending) throw Error('本次登录已取消。');
  if (result.status === 'pending' && Number.isInteger(result.interval) && result.interval > 0 && result.interval <= 90) return { status: 'pending', interval: result.interval };
  if (result.status !== 'complete') throw Error('GitHub 登录服务响应无效。');
  const user = normalizeCommunityAccount(result.user); authStore().set(address, { user, token: result.sessionToken, expiresAt: result.expiresAt });
  pendingLogins.delete(address); loginAttempts.delete(address); communityCache().invalidate(address);
  return { status: 'complete', account: { user, persistent: authStore().persistent() } };
}
export async function cancelCommunityLogin(endpoint: unknown): Promise<void> {
  const address = normalizeCommunityEndpoint(endpoint), pending = pendingLogins.get(address);
  pendingLogins.delete(address); loginAttempts.delete(address);
  if (pending) { try { await request(address, '/v1/auth/github/cancel', { method: 'POST', headers: { 'X-Login-Token': pending.flowToken } }); } catch { /* The server also expires this flow. */ } }
}
export async function logoutCommunityAccount(endpoint: unknown): Promise<void> {
  const address = normalizeCommunityEndpoint(endpoint), session = authStore().get(address);
  authStore().remove(address); communityCache().invalidate(address);
  await cancelCommunityLogin(address);
  if (session) { try { await request(address, '/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } }); } catch { /* Local sign-out succeeds even if the service is offline. */ } }
}
export async function listCommunityOwnedBuilds(endpoint: unknown, cursor?: unknown): Promise<CommunityOwnedPage> {
  const address = normalizeCommunityEndpoint(endpoint), session = authStore().get(address);
  if (!session) throw Error('请先使用 GitHub 登录。');
  if (cursor != null && (typeof cursor !== 'string' || !/^[a-f0-9]{64}$/.test(cursor))) throw Error('上传列表分页标识无效。');
  const data = await request(address, `/v1/my-builds${cursor ? `?cursor=${cursor}` : ''}`, { headers: { Authorization: `Bearer ${session.token}` } }) as CommunityOwnedPage;
  if (!Array.isArray(data.uploads) || data.uploads.length > 50 || data.uploads.some(v => !/^[a-f0-9]{64}$/.test(v?.id) || typeof v.title !== 'string' || v.title.length > 80) || !(data.cursor === null || typeof data.cursor === 'string' && /^[a-f0-9]{64}$/.test(data.cursor))) throw Error('我的上传列表响应无效。');
  return { uploads: data.uploads.map(v => ({ id: v.id, title: v.title })), cursor: data.cursor };
}
