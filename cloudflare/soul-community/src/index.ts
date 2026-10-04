import { normalizeCommunityBuild, normalizeCommunityQuery, communityBuildTitle, COMMUNITY_MAX_BYTES } from '../../../desktop/src/shared/soul-community';
import { soulCatalog } from '../../../desktop/src/shared/soul-catalog-data';
import type { PanelKey } from '../../../desktop/src/shared/soul-optimizer';
import { AuthError, authRoute, mutationOwner, json, digest } from './githubAuth';
import type { AuthEnv } from './githubAuth';

interface Statement {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface Env extends AuthEnv {
  READ_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  WRITE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  AUTH_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
interface StoredRow { id: string; created_at: string; payload: string; author: string | null }
async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Error('请上传 JSON 格式的方案。');
  if (Number(request.headers.get('content-length')) > COMMUNITY_MAX_BYTES) throw Error('社区方案过大。');
  const reader = request.body?.getReader(); if (!reader) throw Error('社区方案为空。');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > COMMUNITY_MAX_BYTES) { await reader.cancel(); throw Error('社区方案过大。'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(data)); } catch { throw Error('社区方案 JSON 无效。'); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/' && request.method === 'GET') return new Response('御魂配置社区 · AutoFlow Studio\n使用桌面程序中的“使用 GitHub 登录”来上传和管理自己的御魂方案。', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
    if (path.startsWith('/v1/auth/') || path === '/v1/account' || path === '/v1/my-builds') {
      try {
        const key = request.headers.get('CF-Connecting-IP') ?? 'local';
        const limiter = path.endsWith('/start') || path === '/v1/account' && request.method === 'POST' ? env.WRITE_LIMITER : env.AUTH_LIMITER ?? env.READ_LIMITER;
        if (!(await limiter.limit({ key })).success) return json({ error: '登录请求过于频繁，请稍后重试。' }, 429);
        return await authRoute(request, env);
      } catch (error) {
        if (!(error instanceof AuthError)) console.error('community-auth-error', error instanceof Error ? { name: error.name, message: error.message.slice(0, 200).replace(/[a-f0-9]{32,}/gi, '[redacted]') } : { name: typeof error });
        return json({ error: error instanceof AuthError ? error.message : '登录服务暂时不可用，请稍后重试。' }, error instanceof AuthError ? error.status : 503);
      }
    }
    const deletion = /^\/v1\/builds\/([a-f0-9]{64})$/.exec(path);
    if (path !== '/v1/builds' && !deletion) return json({ error: '接口不存在。' }, 404);
    if (!(path === '/v1/builds' && ['GET', 'POST'].includes(request.method) || deletion && request.method === 'DELETE')) return json({ error: '请求方法不支持。' }, 405);
    try {
      const key = request.headers.get('CF-Connecting-IP') ?? 'local';
      const limiter = request.method === 'GET' ? env.READ_LIMITER : env.WRITE_LIMITER;
      if (!(await limiter.limit({ key })).success) return json({ error: '请求过于频繁，请稍后重试。' }, 429);
      if (request.method === 'GET') {
        let query;
        try {
          const raw: Record<string, unknown> = Object.fromEntries(url.searchParams);
          for (const key of ['heroId', 'suit4', 'suit2']) if (raw[key] != null) raw[key] = Number(raw[key]);
          query = normalizeCommunityQuery(raw);
        } catch (error) { return json({ error: error instanceof Error ? error.message : '查询条件无效。' }, 400); }
        const where = ['b.hero_id = ?', 'b.objective = ?'], values: unknown[] = [query.heroId, query.objective];
        const author = "COALESCE(a.author_key, lower(json_extract(b.payload, '$.author')))";
        if (query.search) { where.push(`(instr(lower(json_extract(b.payload, '$.title')), ?) > 0 OR instr(${author}, ?) > 0)`); values.push(query.search.toLocaleLowerCase('en-US'), query.search.toLocaleLowerCase('en-US')); }
        if (query.author) { where.push(`instr(${author}, ?) > 0`); values.push(query.author.toLocaleLowerCase('en-US')); }
        for (const [key, count] of [['suit4', 4], ['suit2', query.suit2 === query.suit4 ? 6 : 2]] as const) if (query[key]) {
          where.push("(SELECT COUNT(*) FROM json_each(b.payload, '$.souls') s WHERE json_extract(s.value, '$.suitId') = ?) >= ?"); values.push(query[key], count);
        }
        for (const position of [2, 4, 6] as const) if (query[`main${position}`]) {
          where.push(`json_extract(b.payload, '$.souls[${position - 1}].mainAttribute.name') = ?`); values.push(query[`main${position}`]);
        }
        // Dates are inclusive calendar days in Asia/Shanghai, matching the desktop UI.
        if (query.after) { where.push('b.created_at >= ?'); values.push(new Date(`${query.after}T00:00:00+08:00`).toISOString()); }
        if (query.before) { where.push('b.created_at < ?'); values.push(new Date(Date.parse(`${query.before}T00:00:00+08:00`) + 86400_000).toISOString()); }
        const ascending = query.order === 'oldest', direction = ascending ? 'ASC' : 'DESC', operator = ascending ? '>' : '<';
        if (query.cursor) {
          const [date, id] = query.cursor.split('|'); where.push(`(b.created_at ${operator} ? OR (b.created_at = ? AND b.id ${operator} ?))`); values.push(date, date, id);
        }
        const sql = `SELECT b.id, b.created_at, b.payload, a.name AS author FROM builds b LEFT JOIN community_authors a ON a.owner_hash = b.delete_hash WHERE ${where.join(' AND ')} ORDER BY b.created_at ${direction}, b.id ${direction} LIMIT 51`;
        const { results } = await env.DB.prepare(sql).bind(...values).all<StoredRow>();
        const rows = results.slice(0, 50), last = rows.at(-1);
        return json({ entries: rows.map(row => ({ ...JSON.parse(row.payload), ...(row.author ? { author: row.author } : {}), id: row.id, createdAt: row.created_at })), cursor: results.length > 50 && last ? `${last.created_at}|${last.id}` : null, filterVersion: 1 });
      }
      const tokenHash = await mutationOwner(request, env);
      if (deletion) {
        const owned = await env.DB.prepare('SELECT id FROM builds WHERE id = ? AND delete_hash = ?').bind(deletion[1], tokenHash).first<{ id: string }>();
        if (!owned) return json({ error: '方案不存在或不属于当前上传者。' }, 403);
        await env.DB.prepare('DELETE FROM builds WHERE id = ? AND delete_hash = ?').bind(deletion[1], tokenHash).run();
        return json({ deleted: true });
      }
      let build;
      try { build = normalizeCommunityBuild(await readBody(request)); }
      catch (error) { return json({ error: error instanceof Error ? error.message : '社区方案无效。' }, 400); }
      const hero = soulCatalog.heroes.find(hero => hero.id === build.heroId);
      if (!hero?.base || Object.keys(hero.base).some(key => Math.abs(hero.base![key as PanelKey] - build.base[key as PanelKey]) > 1e-9)
        || build.souls.some(soul => !soulCatalog.suits.some(suit => suit.id === soul.suitId))) return json({ error: '式神基础面板或套装与当前目录不符。' }, 400);
      build.title = communityBuildTitle(hero, build.souls, soulCatalog.suits);
      const author = build.author === '匿名用户' ? `御魂玩家-${tokenHash.slice(0, 12)}` : build.author.normalize('NFKC').trim();
      if (!author || author.length > 30) return json({ error: '署名需为 1 至 30 个字符。' }, 400);
      const authorKey = author.toLocaleLowerCase('en-US');
      // The unique index arbitrates simultaneous name claims; a token keeps ownership across restarts.
      await env.DB.prepare('INSERT INTO community_authors (owner_hash, author_key, name) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .bind(tokenHash, authorKey, author).run();
      const holder = await env.DB.prepare('SELECT owner_hash FROM community_authors WHERE author_key = ?').bind(authorKey).first<{ owner_hash: string }>();
      if (holder && holder.owner_hash !== tokenHash) return json({ error: '这个署名已被其他用户使用，请换一个署名。' }, 409);
      try {
        await env.DB.prepare('UPDATE community_authors SET author_key = ?, name = ? WHERE owner_hash = ?').bind(authorKey, author, tokenHash).run();
      } catch (error) {
        if (String(error).includes('UNIQUE')) return json({ error: '这个署名已被其他用户使用，请换一个署名。' }, 409);
        throw error;
      }
      build.author = author;
      // Idempotent per uploader and content. System title and signature do not create duplicates.
      const { title: _title, author: _author, ...content } = build;
      const id = await digest(`${tokenHash}:${JSON.stringify(content)}`), createdAt = new Date().toISOString();
      await env.DB.prepare('INSERT INTO builds (id, hero_id, objective, created_at, payload, delete_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload')
        .bind(id, build.heroId, build.objective, createdAt, JSON.stringify(build), tokenHash).run();
      const stored = await env.DB.prepare('SELECT created_at FROM builds WHERE id = ?').bind(id).first<{ created_at: string }>();
      return json({ id, createdAt: stored?.created_at ?? createdAt, author }, 201);
    } catch (error) { return json({ error: error instanceof AuthError ? error.message : '社区服务暂时不可用，请稍后重试。' }, error instanceof AuthError ? error.status : 503); }
  },
};
