import fs from 'node:fs/promises';
import path from 'node:path';
import { soulCatalog } from '../shared/soul-catalog-data';
import { catalogHeroBase, readHeroPanel, type HeroBaseRequest } from '../shared/hero-panel';
import type { Panel } from '../shared/soul-optimizer';

/** Exact per-level/form public base attributes, shared across accounts and cached for offline use. */
export class HeroPanelService {
  private readonly pending = new Map<string, Promise<Panel | null>>();
  constructor(private readonly projectRoot: string, private readonly fetcher: (url: string, options?: RequestInit) => Promise<Response> = fetch) {}
  async load(value: unknown): Promise<Panel | null> {
    if (!value || typeof value !== 'object') throw new Error('式神属性参数无效');
    const request = value as HeroBaseRequest;
    const profile = soulCatalog.heroes.find(hero => hero.id === request.heroId);
    if (!profile || !Number.isInteger(request.level) || request.level < 1 || request.level > 60
      || !Number.isInteger(request.stars) || request.stars < 1 || request.stars > 6 || typeof request.awake !== 'boolean'
      || ([1, 5, 6].includes(profile.rarity) && request.awake)) throw new Error('式神属性参数无效');
    const offline = catalogHeroBase(request, profile); if (offline) return offline;
    const key = `${request.heroId}-${request.level}-${request.stars}-${Number(request.awake)}`;
    const existing = this.pending.get(key); if (existing) return existing;
    const task = this.read(request, key); this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
  private async read(request: HeroBaseRequest, key: string): Promise<Panel | null> {
    const file = path.join(this.projectRoot, 'artifacts', 'hero-panels', `${key}.json`);
    try {
      const cached = JSON.parse(await fs.readFile(file, 'utf8'));
      if (cached.heroId === request.heroId && cached.level === request.level && cached.stars === request.stars && cached.awake === request.awake) {
        const panel = readHeroPanel(cached.base); if (panel && panel.hp > 0) return panel;
      }
    } catch { /* First visit or a damaged cache: retrieve public base values. */ }
    try {
      const response = await this.fetcher(`https://g37simulator.webapp.163.com/get_hero_attr?heroid=${request.heroId}&awake=${Number(request.awake)}&level=${request.level}&star=${request.stars}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://yys.163.com/shishen/' }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const result = await response.json() as { success?: unknown; data?: Record<string, unknown> } | null, data = result?.data;
      if (result?.success !== true || !data || typeof data.critPower !== 'number' || data.critPower < 0) return null;
      const base = readHeroPanel({ attack: data.attack, hp: data.maxHp, defense: data.defense, speed: data.speed,
        crit: data.critRate, critDamage: 1 + data.critPower, hit: data.debuffEnhance, resist: data.debuffResist });
      if (!base || base.hp <= 0) return null;
      try { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify({ ...request, base }), 'utf8'); }
      catch { /* A cache write failure should not hide successfully fetched attributes. */ }
      return base;
    } catch { return null; }
  }
}
