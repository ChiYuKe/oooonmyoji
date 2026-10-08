import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const worldLanternIds = {
  hero: 348, basic: '3481', passive: '3482', lantern: '3483', finale: '3484',
  mark: 'status.hero.348.floating-lamp-mark', collected: 'status.hero.348.collected-fire',
  light: 'status.hero.348.world-light', aura: 'status.hero.348.skill-fire-aura', finaleUnlocked: 'status.hero.348.finale-unlocked',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const selectedRatios = [2.11, 2.16, 2.21, 2.26, 2.31, 2.11] as const;
const splashRatios = [1.05, 1.1, 1.15, 1.2, 1.25, 1.05] as const;

export function registerWorldLantern(registry: ContentRegistry): void {
  registry.registerStatus({ id: worldLanternIds.mark, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace',
    modifyResourceCost(state, actor, _skill, cost) {
      const marked = actor.statuses.find(status => status.statusId === worldLanternIds.mark);
      if (!marked || actor.unitKind === 'monster' || actor.unitKind === 'summon' || cost.resourceId !== 'fire') return cost.amount;
      return cost.amount + 1;
    } });
  registry.registerStatus({ id: worldLanternIds.collected, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 100 });
  registry.registerStatus({ id: worldLanternIds.light, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 100 });
  registry.registerStatus({ id: worldLanternIds.aura, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    modifyResourceCost(state, actor, skill, cost) {
      if (cost.resourceId !== 'fire' || skill.id === worldLanternIds.basic || skill.id === worldLanternIds.finale) return cost.amount;
      const ownerId = state.sides[actor.side].find(id => {
        const owner = state.units[id];
        return owner?.heroId === worldLanternIds.hero && owner.hp > 0 && skillRank(owner, worldLanternIds.passive) >= 5
          && passivesEnabled(owner);
      });
      return ownerId ? cost.amount + 1 : cost.amount;
    } });
  registry.registerStatus({ id: worldLanternIds.finaleUnlocked, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', grantedSkills: [createFinaleSkill()] });
  registry.registerHero(createWorldLanternDefinition());
}

export function createWorldLanternDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: worldLanternIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, markDuration: index >= 1 ? 2 : 2 })),
    execute(context, intent, params) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      const sourceRef = source(worldLanternIds.basic, owner.unitId);
      const commands: EffectCommand[] = [makeHit(context, owner, target, sourceRef, Number(params.ratio ?? 1))];
      if (target.unitKind !== 'monster' && target.unitKind !== 'summon') commands.push(...mark(context, target, sourceRef,
        Number(params.markDuration ?? 2)));
      return commands;
    } };
  const lantern: SkillDefinition = { id: worldLanternIds.lantern, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: selectedRatios.map((ratio, index) => ({ ratio,
      splashRatio: splashRatios[index] ?? 1.05, markTargets: 2 })),
    execute(context, intent, params) {
      const owner = context.getUnit(intent.actorId); if (!owner) return [];
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      const selectedId = intent.targetIds[0]; const selected = enemies.find(enemy => enemy.unitId === selectedId) ?? enemies[0];
      if (!selected) return [];
      const sourceRef = source(worldLanternIds.lantern, owner.unitId);
      const commands: EffectCommand[] = [];
      for (const target of enemies) {
        const ratio = target.unitId === selected.unitId ? Number(params.ratio ?? 2.11) : Number(params.splashRatio ?? 1.05);
        commands.push(makeHit(context, owner, target, sourceRef, ratio));
        if (target.unitKind === 'monster' || target.unitKind === 'summon') continue;
        const oldMark = target.statuses.some(status => status.statusId === worldLanternIds.mark);
        if (oldMark) commands.push({ type: 'change-resource', source: sourceRef, side: target.side, resourceId: 'fire', amount: -2 });
        if (target.unitId === selected.unitId) commands.push(...mark(context, target, sourceRef, 2));
      }
      const unmarked = enemies.filter(target => target.unitId !== selected.unitId && target.hp > 0
        && target.unitKind !== 'monster' && target.unitKind !== 'summon'
        && !target.statuses.some(status => status.statusId === worldLanternIds.mark));
      const markCount = Math.min(2, enemies.filter(target => target.unitId !== selected.unitId && target.hp > 0
        && target.unitKind !== 'monster' && target.unitKind !== 'summon').length);
      const preferred = pickRandom(context.random, unmarked, Math.min(markCount, unmarked.length));
      const fallback = enemies.filter(target => target.unitId !== selected.unitId && target.hp > 0
        && target.unitKind !== 'monster' && target.unitKind !== 'summon' && !preferred.some(item => item.unitId === target.unitId));
      for (const target of [...preferred, ...pickRandom(context.random, fallback, markCount - preferred.length)]) {
        if (target.statuses.some(status => status.statusId === worldLanternIds.mark))
          commands.push({ type: 'change-resource', source: sourceRef, side: target.side, resourceId: 'fire', amount: -2 });
        commands.push(...mark(context, target, sourceRef, 2));
      }
      return commands;
    } };
  const definition: HeroDefinition = { id: worldLanternIds.hero, skills: [basic, lantern], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入普攻浮光、告死暝灯、标记额外耗火、回收鬼火/溢出及友方技能触发收集、30火免费告死暝灯、100火终结技、全队攻击防御层数增益。御魂与10点场连续帧触发顺序仍需核对；五级鬼火行动条加成、敌方技能扣火来源及跨版本标记细节待核。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner) return [];
      const sourceRef = source(worldLanternIds.passive, unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source: sourceRef, targetId: unitId,
        instance: statusInstance(worldLanternIds.collected, unitId, sourceRef, 0) },
      { type: 'add-status', source: sourceRef, targetId: unitId,
        instance: statusInstance(worldLanternIds.light, unitId, sourceRef, 0) }];
      for (const ally of context.getLivingUnits(owner.side)) {
        commands.push({ type: 'add-status', source: sourceRef, targetId: ally.unitId,
          instance: { ...statusInstance(worldLanternIds.aura, `${unitId}:${ally.unitId}`, sourceRef, 1), values: { ownerUnitId: unitId } } });
      }
      return commands;
    },
    handlers: {
      'resource-payment': { priority: 30, handle(context, event) {
        if (event.type === 'resource-meter-advanced') return extraFireFromMeter(context, event);
        return onFireResourceChange(context, event);
      } },
      'effect-resolution': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'hit': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'turn-start': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'control-application': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'attack-start': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'attack-end': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'unit-defeated': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'status-expiration': { priority: 30, handle(context, event) { return onFireResourceChange(context, event); } },
      'resource-overflow': { priority: 30, handle(context, event) {
        if (event.type !== 'resource-overflow' || event.resourceId !== 'fire' || event.amount <= 0) return;
        const owner = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
        if (owner?.heroId === worldLanternIds.hero && owner.side !== event.side && passivesEnabled(owner))
          return addCollected(context, owner, event.amount, event.eventId);
        const allyOwner = context.getLivingUnits(event.side).find(unit => unit.heroId === worldLanternIds.hero
          && skillRank(unit, worldLanternIds.passive) >= 2 && passivesEnabled(unit));
        return allyOwner ? addCollected(context, allyOwner, event.amount, event.eventId) : undefined;
      } },
      'action-end': { priority: 30, handle(context, event) {
        if (event.type === 'resource-changed') return onFireResourceChange(context, event);
        if (event.type !== 'action-ended' || !event.intent) return;
        const actor = context.getUnit(event.intent.actorId); if (!actor || actor.unitKind === 'summon') return;
        const commands: EffectCommand[] = [];
        const marked = actor.statuses.find(status => status.statusId === worldLanternIds.mark);
        if (marked) commands.push({ type: 'remove-status-instances', source: marked.source, targetId: actor.unitId,
          instanceIds: [marked.instanceId], reason: 'consumed' });
        if (event.actionKind === 'skill' && event.scheduling !== 'extra-action') {
          const owner = context.getLivingUnits(actor.side).find(ally => ally.heroId === worldLanternIds.hero && passivesEnabled(ally));
          if (owner && skillRank(owner, worldLanternIds.passive) >= 3) commands.push(...addCollected(context, owner, 1, event.eventId));
        }
        return commands;
      } },
      'turn-end': { priority: 30, handle(context, event) {
        if (event.type === 'resource-changed') return onFireResourceChange(context, event);
        if (event.type === 'resource-meter-advanced') return extraFireFromMeter(context, event);
        if (event.type !== 'turn-ended') return;
        const owner = context.getUnit(event.unitId);
        if (!owner || owner.heroId !== worldLanternIds.hero || skillRank(owner, worldLanternIds.passive) < 5 || !passivesEnabled(owner)) return;
        return [{ type: 'advance-resource-meter', source: source(worldLanternIds.passive, owner.unitId),
          side: owner.side, resourceId: 'fire', steps: 1, parentEventId: event.eventId }];
      } },
    },
  };
  return definition;
}

function createFinaleSkill(): SkillDefinition {
  return { id: worldLanternIds.finale, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [{}], canUse(state, actor) {
      return (actor.statuses.find(status => status.statusId === worldLanternIds.collected)?.stacks ?? 0) >= 100;
    }, execute(context, intent) {
      const actor = context.getUnit(intent.actorId); if (!actor) return [];
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return [];
      const sourceRef = source(worldLanternIds.finale, actor.unitId);
      const gathered = actor.statuses.find(status => status.statusId === worldLanternIds.collected);
      const commands: EffectCommand[] = [];
      if (gathered) commands.push({ type: 'add-status', source: sourceRef, targetId: actor.unitId,
        instance: { ...gathered, stacks: 0, values: { ...gathered.values, consumedAt: context.state.counters.action } } });
      const unlocked = actor.statuses.find(status => status.statusId === worldLanternIds.finaleUnlocked);
      if (unlocked) commands.push({ type: 'remove-status-instances', source: sourceRef, targetId: actor.unitId,
        instanceIds: [unlocked.instanceId], reason: 'consumed' });
      const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
      for (let hit = 0; hit < 4; hit++) for (const enemy of enemies) {
        const outcome = context.calculateDamage({ attack, defense: context.getEffectiveStats(enemy.unitId)?.defense ?? enemy.stats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio: 12 / enemies.length,
          critChance: context.getEffectiveStats(actor.unitId)?.crit ?? actor.stats.crit,
          critDamage: context.getEffectiveStats(actor.unitId)?.critDamage ?? actor.stats.critDamage }, actor, enemy);
        commands.push({ type: 'deal-damage', source: sourceRef, targetId: enemy.unitId, amount: outcome.amount,
          ...(outcome.damageOptions ? { damageOptions: outcome.damageOptions } : {}), isCritical: outcome.isCritical });
      }
      return commands;
    } };
}

function collectForSide(context: import('../core/types').BattleContext, side: string, amount: number, event: BattleEvent): EffectCommand[] | undefined {
  const owner = context.getLivingUnits(side as UnitState['side']).find(unit => unit.heroId === worldLanternIds.hero && passivesEnabled(unit));
  return owner ? addCollected(context, owner, amount, event.eventId) : undefined;
}

function extraFireFromMeter(context: import('../core/types').BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-meter-advanced' || event.resourceId !== 'fire' || event.supplied <= 0) return;
  const owner = context.getLivingUnits(event.side).find(unit => unit.heroId === worldLanternIds.hero
    && skillRank(unit, worldLanternIds.passive) >= 5 && passivesEnabled(unit));
  return owner ? [{ type: 'change-resource', source: source(worldLanternIds.passive, owner.unitId), side: event.side,
    resourceId: 'fire', amount: 1, parentEventId: event.eventId }] : undefined;
}

function onFireResourceChange(context: import('../core/types').BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after === event.before) return;
  const amount = Math.abs(event.after - event.before);
  if (event.after > event.before) return collectForSide(context, event.side, amount, event);
  const sourceOwner = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (sourceOwner?.heroId === worldLanternIds.hero && sourceOwner.side !== event.side && passivesEnabled(sourceOwner))
    return addCollected(context, sourceOwner, amount, event.eventId);
  const payer = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const markStatus = payer?.statuses.find(status => status.statusId === worldLanternIds.mark);
  const owner = markStatus?.source.unitId ? context.getUnit(markStatus.source.unitId) : undefined;
  if (!owner || skillRank(owner, worldLanternIds.passive) < 4 || !passivesEnabled(owner)) return;
  return addCollected(context, owner, amount, event.eventId);
}

function addCollected(context: import('../core/types').BattleContext, owner: Readonly<UnitState>, amount: number, parentEventId: string): EffectCommand[] {
  const current = owner.statuses.find(status => status.statusId === worldLanternIds.collected)?.stacks ?? 0;
  const next = Math.min(100, current + Math.max(0, Math.floor(amount)));
  if (next <= current) return [];
  const sourceRef = source(worldLanternIds.passive, owner.unitId);
  const collected = statusInstance(worldLanternIds.collected, owner.unitId, sourceRef, next);
  const currentLight = owner.statuses.find(status => status.statusId === worldLanternIds.light)?.stacks ?? 0;
  const nextLight = Math.min(100, currentLight + (next - current));
  const light = statusInstance(worldLanternIds.light, owner.unitId, sourceRef, nextLight);
  const commands: EffectCommand[] = [{ type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: collected }];
  commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: light,
    });
  for (const ally of context.getLivingUnits(owner.side)) commands.push({ type: 'add-status', source: sourceRef,
    targetId: ally.unitId, instance: { ...light, instanceId: `${light.instanceId}:${ally.unitId}`,
      modifiers: [{ stat: 'attack', operation: 'percent', amount: nextLight / 100 },
        { stat: 'defense', operation: 'percent', amount: nextLight / 100 }] } });
  if (current < 100 && next >= 100) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId,
    instance: { ...statusInstance(worldLanternIds.finaleUnlocked, owner.unitId, sourceRef, 1), values: { parentEventId } } });
  const freeCasts = Math.min(3, Math.floor(next / 30) - Math.floor(current / 30));
  if (freeCasts > 0) for (let cast = 0; cast < freeCasts; cast++) {
    const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
    if (enemies.length) commands.push({ type: 'schedule-action', source: sourceRef, scheduling: 'extra-action', freeCast: true,
      intent: { actorId: owner.unitId, skillId: worldLanternIds.lantern, targetIds: [enemies[0]!.unitId],
        shape: 'all-enemies', targetRelation: 'enemy', kind: 'skill' }, parentEventId });
  }
  return commands;
}

function mark(context: import('../core/types').BattleContext, target: Readonly<UnitState>, sourceRef: SourceRef, duration: number): EffectCommand[] {
  return attemptDebuff(context, { source: sourceRef, targetId: target.unitId, statusId: worldLanternIds.mark, baseChance: 1,
    duration: { kind: 'count', remaining: duration, owner: 'target-turn' } });
}
function statusInstance(statusId: string, key: string, sourceRef: SourceRef, stacks: number): StatusInstance {
  return { instanceId: `${statusId}:${key}`, statusId, source: sourceRef, stacks, duration: { kind: 'permanent' } };
}
function makeHit(context: import('../core/types').BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>,
  sourceRef: SourceRef, ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  return { type: 'deal-damage', source: sourceRef, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical };
}
function pickRandom<T>(random: () => number, values: readonly T[], count: number): T[] {
  const pool = [...values], selected: T[] = [];
  while (pool.length && selected.length < count) selected.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  return selected;
}
function skillRank(owner: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(6, owner.skillLevels?.[skillId] ?? owner.skillLevel));
}
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
