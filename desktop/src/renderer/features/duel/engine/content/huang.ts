import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const huangIds = { hero: 283, basic: '2831', realm: '2832', star: '2833', moon: '2835',
  starMark: 'status.hero.283.star-mark', illusion: 'status.hero.283.illusion', seal: 'status.hero.283.counter-seal' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const realmChances = [.3, .5, .6, .6, .6] as const;
const starRatios = [1.2, 1.35, 1.5, 1.5, 1.5] as const;
const starFalloff = [.1, .1, .1, .1, .1] as const;
const moonRatios = [1.2, 1.35, 1.5, 1.5, 1.5] as const;
const moonFalloff = [.25, .2, .2, .2, .2] as const;

export function registerHuang(registry: ContentRegistry): void {
  registry.registerStatus({ id: huangIds.starMark, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 5 } satisfies StatusDefinition);
  registry.registerStatus({ id: huangIds.illusion, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'source-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: huangIds.seal, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });

  const basicBase = createBasicAttackSkill(huangIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicBase };
  const realm: SkillDefinition = { id: huangIds.realm, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: realmChances.map((passiveChance, index) => ({ passiveChance,
      pushTeamGauge: index === 4 ? .25 : 0 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || owner.heroId !== huangIds.hero || !target || target.hp <= 0 || target.side === owner.side) return [];
      const wasActive = hasIllusion(owner);
      const source = huangSource(huangIds.realm, owner.unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: illusionStatus(owner, source) },
        addStarMarks(owner, target, source, 3)];
      if (Number(parameters.pushTeamGauge ?? 0) > 0 && wasActive) for (const ally of context.getLivingUnits(owner.side)) {
        if (ally.unitKind !== 'summon' && ally.unitKind !== 'monster') commands.push({ type: 'change-action-gauge', source,
          targetId: ally.unitId, amount: 25 });
      }
      return commands;
    } };

  const star: SkillDefinition = { id: huangIds.star, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: starRatios.map((ratio, index) => ({ ratio, falloff: starFalloff[index]!, hits: 3 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp <= 0 || target.side === owner.side) return [];
      return buildMeteorHits(context, owner, [target], Number(parameters.ratio ?? starRatios[rank(owner, huangIds.star) - 1]),
        Number(parameters.falloff ?? starFalloff[rank(owner, huangIds.star) - 1]), 3, huangIds.star);
    } };

  const moon: SkillDefinition = { id: huangIds.moon, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 0 },
    target: 'single', targetRelation: 'enemy', levels: moonRatios.map((ratio, index) => ({ ratio, falloff: moonFalloff[index]! })),
    canUse(state, actor) { return actor.heroId === huangIds.hero && actor.awakeFilter === 1 && hasIllusion(actor)
      && (state.resources[actor.side]?.fire ?? 0) > 0; },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0 || target.side === owner.side) return [];
      const availableFire = Math.max(0, context.state.resources[owner.side]?.fire ?? 0);
      const marks = target.statuses.find(status => status.statusId === huangIds.starMark && status.source.unitId === owner.unitId)?.stacks ?? 0;
      const fireSpent = Math.max(1, availableFire - marks);
      const rankIndex = rank(owner, huangIds.moon) - 1;
      const ratio = Number(parameters.ratio ?? moonRatios[rankIndex]!);
      const falloff = Number(parameters.falloff ?? moonFalloff[rankIndex]!);
      const commands: EffectCommand[] = [{ type: 'change-resource', source: huangSource(huangIds.moon, owner.unitId),
        side: owner.side, resourceId: 'fire', amount: -Math.min(availableFire, fireSpent) },
      ...buildMeteorHits(context, owner, [target], ratio, falloff, Math.min(availableFire, fireSpent), huangIds.moon)];
      return commands;
    } };

  const definition: HeroDefinition = { id: huangIds.hero, skills: [basic, realm, star, moon], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入星轨等级伤害及星痕、星辰之境2火/延长幻境/标记3层、回合前幻境概率/回合开始净化、幻境内友方普攻50%协战、天罚·星3火三段递减/未击杀加星痕/击杀后后续流星扩散、天罚·月按剩余鬼火次数攻击且目标星痕降低耗火、星痕满5层且荒未受控时免费触发天罚·星。客户端不同技能行的被动概率和额外技能解锁等级存在差异，协战的准确攻击技能、群体扩散的后续段数、幻境计时、星痕分摊/唯一效果归属及御魂顺序仍需实战帧核验。'],
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((a, b) => (b.statuses.find(s => s.statusId === huangIds.starMark)?.stacks ?? 0)
        - (a.statuses.find(s => s.statusId === huangIds.starMark)?.stacks ?? 0))[0]!;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      if (hasIllusion(owner) && owner.awakeFilter === 1 && fire > 0)
        return huangIntent(owner.unitId, huangIds.moon, target.unitId);
      if (fire >= 3 && enemies.length === 1) return huangIntent(owner.unitId, huangIds.star, target.unitId);
      if (fire >= 2 && !hasIllusion(owner)) return huangIntent(owner.unitId, huangIds.realm, target.unitId);
      return huangIntent(owner.unitId, huangIds.basic, target.unitId);
    },
    handlers: {
      'turn-start': { priority: 42, handle(context, event) { return openRealmAndCleanse(context, event); } },
      'hit': { priority: 42, handle(context, event) { return addStarMarkOnHit(context, event); } },
      'attack-end': { priority: 42, handle(context, event) { return handleAttackEnd(context, event); } },
      'effect-resolution': { priority: 42, handle(context, event) { return triggerFullStarMarks(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function openRealmAndCleanse(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== huangIds.hero || owner.unitKind === 'summon' || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const commands: EffectCommand[] = [];
  const realmSource = huangSource(huangIds.realm, owner.unitId);
  if (hasIllusion(owner)) commands.push({ type: 'dispel-statuses', source: realmSource, targetId: owner.unitId,
    filter: 'debuff-or-control', maxCount: 1, parentEventId: event.eventId });
  else {
    const chance = realmChances[rank(owner, huangIds.realm) - 1]!;
    const guaranteedAtFourFire = rank(owner, huangIds.realm) >= 4 && (context.state.resources[owner.side]?.fire ?? 0) >= 4;
    if (guaranteedAtFourFire || context.random() < chance) commands.push({ type: 'add-status', source: realmSource,
      targetId: owner.unitId, instance: illusionStatus(owner, realmSource), parentEventId: event.eventId });
  }
  return commands;
}

function addStarMarkOnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== huangIds.basic || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== huangIds.hero || !target || target.hp <= 0 || target.side === owner.side) return;
  return [addStarMarks(owner, target, huangSource(huangIds.basic, owner.unitId), 1, event.eventId)];
}

function finishMeteorSkill(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== huangIds.star || !event.source.unitId || event.attackId === undefined) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== huangIds.hero || owner.hp <= 0) return;
  const targetChange = event.targetHealthChanges?.[0];
  const target = targetChange && context.getUnit(targetChange.targetId);
  const skillRank = rank(owner, huangIds.star);
  const commands: EffectCommand[] = [];
  if (target && targetChange?.hpAfter > 0 && skillRank >= 4)
    commands.push(addStarMarks(owner, target, huangSource(huangIds.star, owner.unitId), 1, event.eventId));
  if (skillRank >= 5 && target && targetChange?.defeatedByHit && target.unitKind !== 'summon') {
    const remainingHits = Math.max(0, 3 - event.hitCount);
    const ratio = starRatios[skillRank - 1]!;
    const falloff = starFalloff[skillRank - 1]!;
    const enemies = context.getLivingUnits(target.side);
    for (let index = 0; index < remainingHits; index++) commands.push(...buildMeteorHits(context, owner, enemies,
      ratio * (1 - falloff * (event.hitCount + index)), falloff, 1, huangIds.star));
  }
  return commands.length ? commands : undefined;
}

function handleAttackEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...(finishMeteorSkill(context, event) ?? []), ...(assistFromRealm(context, event) ?? [])];
  return commands.length ? commands : undefined;
}

function triggerFullStarMarks(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-added' || event.instance.statusId !== huangIds.starMark || event.instance.stacks < 5) return;
  const ownerId = event.instance.source.unitId;
  const owner = ownerId ? context.getUnit(ownerId) : undefined;
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== huangIds.hero || owner.hp <= 0 || context.isUnitUnableToAct(owner.unitId)
    || !passivesEnabled(owner) || !target || target.hp <= 0) return;
  return [{ type: 'remove-status-instances', source: huangSource(huangIds.star, owner.unitId), targetId: target.unitId,
    instanceIds: [event.instance.instanceId], reason: 'consumed', parentEventId: event.eventId },
  { type: 'schedule-action', source: huangSource(huangIds.star, owner.unitId), scheduling: 'extra-action', freeCast: true,
    parentEventId: event.eventId, intent: { actorId: owner.unitId, skillId: huangIds.star, targetIds: [target.unitId],
      shape: 'single', targetRelation: 'enemy', kind: 'passive' } }];
}

function assistFromRealm(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId || !event.targetHealthChanges?.length) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker) return;
  const target = event.targetHealthChanges.map(change => context.getUnit(change.targetId))
    .find(unit => unit && unit.hp > 0 && unit.side !== attacker.side);
  if (!target) return;
  return context.getLivingUnits(attacker.side).filter(owner => owner.heroId === huangIds.hero && owner.unitKind !== 'summon'
    && owner.unitId !== attacker.unitId && passivesEnabled(owner) && hasIllusion(owner)).flatMap(owner => {
      if (context.random() >= .5) return [];
      return [{ type: 'schedule-action' as const, source: huangSource(huangIds.realm, owner.unitId), scheduling: 'assist' as const,
        freeCast: true, parentEventId: event.eventId, intent: { actorId: owner.unitId, skillId: huangIds.basic,
          targetIds: [target.unitId], shape: 'single' as const, targetRelation: 'enemy' as const, kind: 'passive' as const } }];
    });
}

function buildMeteorHits(context: BattleContext, owner: Readonly<UnitState>, targets: readonly Readonly<UnitState>[], ratio: number,
  falloff: number, hits: number, skillId: string): EffectCommand[] {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const source = huangSource(skillId, owner.unitId);
  return targets.flatMap(target => {
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    return Array.from({ length: Math.max(0, hits) }, (_, index) => {
      const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(owner), ratio: Math.max(0, ratio * (1 - falloff * index)), dmgFluctuation: .01,
        critChance: attack.crit, critDamage: attack.critDamage }, owner as UnitState, target as UnitState);
      return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: result.amount,
        ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical };
    });
  });
}

function addStarMarks(owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef, stacks: number,
  parentEventId?: string): EffectCommand {
  const instance: StatusInstance = { instanceId: `${huangIds.starMark}:${owner.unitId}:${target.unitId}`,
    statusId: huangIds.starMark, source, stacks, duration: { kind: 'permanent' } };
  return { type: 'add-status', source, targetId: target.unitId, instance, ...(parentEventId ? { parentEventId } : {}) };
}

function illusionStatus(owner: Readonly<UnitState>, source: SourceRef): StatusInstance {
  return { instanceId: `${huangIds.illusion}:${owner.unitId}`, statusId: huangIds.illusion, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'source-turn' } };
}
function hasIllusion(owner: Readonly<UnitState>): boolean { return owner.statuses.some(status => status.statusId === huangIds.illusion); }
function rank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function huangIntent(actorId: string, skillId: string, targetId: string): ActionIntent {
  return { actorId, skillId, targetIds: [targetId], shape: 'single', targetRelation: 'enemy' };
}
function huangSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
