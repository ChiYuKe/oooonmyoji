import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const whaleSummonerIds = {
  hero: 324,
  basic: '3241',
  tooth: '3242',
  body: '3243',
  toothArmor: 'status.hero.324.tooth-armor',
  bodyArmor: 'status.hero.324.body-armor',
} as const;

const basicRatios = [.8, .85, .9, .95, 1.05] as const;
const toothRatios = [.12, .13, .14, .15, .15] as const;
const bodyRatios = [.06, .07, .08, .09, .1] as const;
const costs = [3, 3, 3, 3, 2] as const;

export function registerWhaleSummoner(registry: ContentRegistry): void {
  registry.registerStatus({ id: whaleSummonerIds.toothArmor, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: whaleSummonerIds.bodyArmor, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', absorbsCriticalBonus: true });
  registry.registerHero(createWhaleSummonerDefinition());
}

export function createWhaleSummonerDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(whaleSummonerIds.basic, basicRatios);
  const toothSkill: SkillDefinition = {
    id: whaleSummonerIds.tooth, actionKind: 'skill', target: 'single', targetRelation: 'ally',
    resourceCostsByLevel: costs.map(amount => ({ resourceId: 'fire', amount })),
    levels: [{}, {}, {}, {}, {}],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0 || target.side !== actor.side || target.unitKind === 'summon') return [];
      return [{ type: 'add-status', source: whaleSource(whaleSummonerIds.tooth, actor.unitId), targetId: target.unitId,
        instance: armorStatus(whaleSummonerIds.toothArmor, actor, target) }];
    },
  };
  const bodySkill: SkillDefinition = {
    id: whaleSummonerIds.body, actionKind: 'skill', target: 'single', targetRelation: 'ally',
    resourceCostsByLevel: costs.map(amount => ({ resourceId: 'fire', amount })),
    levels: bodyRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0 || target.side !== actor.side || target.unitKind === 'summon') return [];
      const source = whaleSource(whaleSummonerIds.body, actor.unitId);
      const ratio = Number(parameters.ratio ?? .06);
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId,
        instance: bodyArmor(actor, actor) }];
      if (target.unitId !== actor.unitId) commands.push({ type: 'add-status', source, targetId: target.unitId,
        instance: bodyArmor(actor, target) });
      for (const ally of context.getLivingUnits(actor.side)) {
        if (ally.unitKind !== 'summon') commands.push({ type: 'heal', source, targetId: ally.unitId,
          amount: ally.stats.hp * ratio });
      }
      return commands;
    },
  };

  return {
    id: whaleSummonerIds.hero,
    skills: [basic, toothSkill, bodySkill],
    aiCoverage: 'verified', mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['按客户端技能表完成首回合双甲、齿甲行动后生命上限真实伤害与触发抑制、体甲群疗/行动前按等级恢复化鲸生命上限6%至10%/回合末推条/暴伤减免、普攻治疗与齿甲邀战。齿甲和体甲费用独立按各自技能等级变化；无法给召唤物施甲，邀战优先非化鲸并运行被邀式神自己的真实普攻。回归覆盖这些技能效果、等级边界、召唤物过滤及多化鲸标记归属与邀战优先级'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== whaleSummonerIds.hero || !passivesEnabled(owner)) return [];
      const allies = context.getLivingUnits(owner.side).filter(ally => ally.unitKind !== 'summon');
      const partner = allies.filter(ally => ally.unitId !== owner.unitId)
        .sort((left, right) => (context.getEffectiveStats(right.unitId)?.attack ?? right.stats.attack)
          - (context.getEffectiveStats(left.unitId)?.attack ?? left.stats.attack))[0];
      const commands: EffectCommand[] = [];
      for (const target of [owner, partner].filter((item): item is UnitState => Boolean(item))) {
        commands.push({ type: 'add-status', source: whaleSource(whaleSummonerIds.tooth, owner.unitId), targetId: target.unitId,
          instance: armorStatus(whaleSummonerIds.toothArmor, owner, target) });
        commands.push({ type: 'add-status', source: whaleSource(whaleSummonerIds.body, owner.unitId), targetId: target.unitId,
          instance: bodyArmor(owner, target) });
      }
      return commands;
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side).filter(ally => ally.unitKind !== 'summon');
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const lowestAlly = allies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0];
      if (lowestAlly && lowestAlly.hp / Math.max(1, lowestAlly.stats.hp) < .4
        && fire >= costFor(actor, whaleSummonerIds.body)) {
        return { actorId: unitId, skillId: whaleSummonerIds.body, targetIds: [lowestAlly.unitId], shape: 'single', targetRelation: 'ally' };
      }
      if (!allies.some(ally => hasArmor(ally, whaleSummonerIds.toothArmor))
        && fire >= costFor(actor, whaleSummonerIds.tooth)) {
        const target = allies.slice().sort((left, right) => (context.getEffectiveStats(right.unitId)?.attack ?? right.stats.attack)
          - (context.getEffectiveStats(left.unitId)?.attack ?? left.stats.attack))[0];
        if (target) return { actorId: unitId, skillId: whaleSummonerIds.tooth, targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: whaleSummonerIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    modifyCriticalDamage(_attacker, target, amount, criticalBaseAmount) {
      return hasArmor(target, whaleSummonerIds.bodyArmor)
        ? criticalBaseAmount + (amount - criticalBaseAmount) * .5 : amount;
    },
    handlers: {
      'turn-start': { priority: 24, handle(context, event) { return handleTurnStart(context, event); } },
      'turn-end': { priority: 24, handle(context, event) { return handleTurnEnd(context, event); } },
      'attack-end': { priority: 24, handle(context, event) { return handleAttackEnd(context, event); } },
    },
  };
}

function handleTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const body = actor.statuses.find(status => status.statusId === whaleSummonerIds.bodyArmor);
  if (!body) return;
  const owner = context.getUnit(String(body.values?.whaleUnitId ?? body.source.unitId ?? ''));
  const maxHp = Number(body.values?.whaleMaxHp ?? owner?.stats.hp ?? 0);
  const ratio = Number(body.values?.preTurnHealRatio ?? .06);
  if (maxHp <= 0) return;
  return [{ type: 'heal', source: body.source, targetId: actor.unitId, amount: maxHp * ratio, parentEventId: event.eventId }];
}

function handleTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  for (const body of actor.statuses.filter(status => status.statusId === whaleSummonerIds.bodyArmor)) {
    commands.push({ type: 'change-action-gauge', source: body.source, targetId: actor.unitId, amount: 20, parentEventId: event.eventId });
  }
  for (const tooth of actor.statuses.filter(status => status.statusId === whaleSummonerIds.toothArmor)) {
    const whale = context.getUnit(String(tooth.values?.whaleUnitId ?? tooth.source.unitId ?? ''));
    if (!whale || whale.heroId !== whaleSummonerIds.hero || whale.hp <= 0 || !passivesEnabled(whale)) continue;
    const rank = skillLevel(whale, whaleSummonerIds.tooth);
    const ratio = toothRatios[Math.max(0, Math.min(4, rank - 1))]!;
    const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
    const source = whaleSource(whaleSummonerIds.tooth, whale.unitId);
    for (const enemy of context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')) {
      commands.push({ type: 'deal-damage', source, targetId: enemy.unitId,
        amount: Math.min(enemy.stats.hp * ratio, attack), damageKind: 'true', suppressSoulTriggers: true,
        suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true, suppressSourcePassiveTriggers: true,
        parentEventId: event.eventId });
    }
    commands.push({ type: 'remove-status-instances', source, targetId: actor.unitId, instanceIds: [tooth.instanceId],
      reason: 'consumed', parentEventId: event.eventId });
  }
  return commands;
}

function handleAttackEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== whaleSummonerIds.basic || event.actionKind !== 'basic' || !event.source.unitId) return;
  const whale = context.getUnit(event.source.unitId);
  if (!whale || whale.heroId !== whaleSummonerIds.hero) return;
  const enemyDamage = (event.targetHealthChanges ?? []).reduce((sum, change) => sum + change.hpLost, 0);
  if (enemyDamage <= 0) return;
  const source = whaleSource(whaleSummonerIds.basic, whale.unitId);
  const commands: EffectCommand[] = [];
  const bodyCarriers = context.getLivingUnits(whale.side).filter(ally => hasArmor(ally, whaleSummonerIds.bodyArmor));
  for (const ally of bodyCarriers) commands.push({ type: 'heal', source, targetId: ally.unitId, amount: enemyDamage,
    parentEventId: event.eventId });
  const toothCarriers = context.getLivingUnits(whale.side).filter(ally => ally.unitId !== whale.unitId
    && ally.statuses.some(status => status.statusId === whaleSummonerIds.toothArmor
      && status.source.unitId === whale.unitId));
  const toothCarrier = toothCarriers.find(ally => ally.heroId !== whaleSummonerIds.hero) ?? toothCarriers[0];
  const target = (event.targetHealthChanges ?? []).map(change => context.getUnit(change.targetId))
    .find(unit => unit && unit.hp > 0 && unit.side !== whale.side)
    ?? context.getLivingUnits(whale.side === 'blue' ? 'red' : 'blue')[0];
  if (toothCarrier && target) {
    // Run the invited unit's actual basic skill so its skill-level ratio and
    // on-basic effects are preserved. Mark it passive so a Whale invited by
    // another Whale cannot recursively issue another invitation.
    commands.push({ type: 'schedule-action', source, scheduling: 'assist', freeCast: true, parentEventId: event.eventId,
      intent: { actorId: toothCarrier.unitId, skillId: `${toothCarrier.heroId}1`, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands;
}

function armorStatus(statusId: string, owner: Readonly<UnitState>, target: Readonly<UnitState>): StatusInstance {
  return { instanceId: `${statusId}:${owner.unitId}:${target.unitId}`, statusId,
    source: whaleSource(statusId === whaleSummonerIds.toothArmor ? whaleSummonerIds.tooth : whaleSummonerIds.body, owner.unitId),
    stacks: 1, duration: { kind: 'permanent' }, values: { whaleUnitId: owner.unitId } };
}

function bodyArmor(owner: Readonly<UnitState>, target: Readonly<UnitState>): StatusInstance {
  const preTurnHealRatio = bodyRatios[Math.max(0, Math.min(4, skillLevel(owner, whaleSummonerIds.body) - 1))]!;
  return { ...armorStatus(whaleSummonerIds.bodyArmor, owner, target),
    values: { whaleUnitId: owner.unitId, whaleMaxHp: owner.stats.hp, preTurnHealRatio } };
}

function hasArmor(unit: Readonly<UnitState>, statusId: string): boolean {
  return unit.statuses.some(status => status.statusId === statusId);
}
function whaleSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function costFor(unit: Readonly<UnitState>, skillId: string): number {
  return costs[Math.max(0, Math.min(4, skillLevel(unit, skillId) - 1))]!;
}
