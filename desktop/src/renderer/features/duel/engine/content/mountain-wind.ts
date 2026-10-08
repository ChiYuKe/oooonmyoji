import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const mountainWindIds = { hero: 296, basic: '2961', passive: '2962', ultimate: '2963',
  fierce: 'status.hero.296.fierce', bleed: 'status.hero.296.bleed', healBan: 'status.hero.296.heal-ban',
  passiveAttempt: 'status.hero.296.passive-attempt' } as const;

const basicRatios = [.76, .8, .84, .87, .95] as const;
const ultimateRatios = [1.32, 1.39, 1.45, 1.52, 1.52] as const;
const fierceAttack = [.1, .15, .2, .25, .25] as const;

export function registerMountainWind(registry: ContentRegistry): void {
  registry.registerStatus({ id: mountainWindIds.fierce, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' } satisfies StatusDefinition);
  registry.registerStatus({ id: mountainWindIds.bleed, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', handlers: {
      'status-expiration': { priority: 47, handle(context, event) { return resolveBleed(context, event); } },
    } } satisfies StatusDefinition);
  registry.registerStatus({ id: mountainWindIds.healBan, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', healingRestriction: { allowedSourceIds: [] } });
  registry.registerStatus({ id: mountainWindIds.passiveAttempt, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic: SkillDefinition = { id: mountainWindIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio, hits: 2 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== mountainWindIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const ratio = Number(parameters.ratio ?? basicRatios[skillRank(actor, mountainWindIds.basic) - 1]);
      return [0, 1].flatMap(() => makeHit(context, actor, target, mountainWindIds.basic, ratio,
        target.hp / Math.max(1, target.stats.hp) < .35));
    } };
  const ultimate: SkillDefinition = { id: mountainWindIds.ultimate, actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 }, target: 'single', targetRelation: 'enemy',
    levels: ultimateRatios.map(ratio => ({ ratio, hits: 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== mountainWindIds.hero || actor.hp <= 0 || !selected || selected.hp <= 0
        || selected.side === actor.side) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillRank(actor, mountainWindIds.ultimate) - 1]);
      const enemies = context.getLivingUnits(selected.side).filter(target => target.unitId !== selected.unitId)
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp));
      const targets = [selected, ...enemies.slice(0, 1)];
      const commands: EffectCommand[] = [];
      for (const target of targets) {
        commands.push(...makeHit(context, actor, target, mountainWindIds.ultimate, ratio, true));
        commands.push({ type: 'add-status', source: mountainWindSource(mountainWindIds.ultimate, actor.unitId), targetId: target.unitId,
          instance: { instanceId: `${mountainWindIds.bleed}:${actor.unitId}:${target.unitId}`, statusId: mountainWindIds.bleed,
            source: mountainWindSource(mountainWindIds.ultimate, actor.unitId), stacks: 1,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
            values: { currentHpRatio: .12, attackRatio: .88, attackCap: 3.2, defenseIgnore: 600,
              applyHealBanOnRemoval: skillRank(actor, mountainWindIds.ultimate) >= 5 } } });
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: mountainWindIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入风双段76%至95%攻击伤害、命中时目标生命比例低于35%必定暴击；烈在眩晕/沉默/冰冻/混乱/嘲讽/睡眠等控制状态解除且山风可行动时，行动条提升35%，若存在生命比例低于35%的敌人则技能五级提升70%，并获得持续1个自身回合的困兽（技能等级攻击提升10%至25%，状态表还列+50%效果抵抗）；受伤或受到抵抗时，每次攻击按35%概率获得一层畏，并在可行动时免费反击攻击者；斩消耗3火，对选中敌人与另一名生命比例最低的不同敌人各造成等级倍率132%至152%的必暴击伤害并施加1回合撕裂。撕裂结算12%目标当前生命+88%山风攻击、封顶320%攻击，客户端状态行另列无视600防御；五级撕裂移除后对目标禁疗1回合。满血比例在多段攻击内动态变化、撕裂驱散/死亡清理、间接伤害与防御忽略、困兽50%抵抗描述及多名低血敌人选靶顺序仍待帧核。注意初翎山风（357）是不同式神；本场帧只支持初翎山风，不作为山风（296）的实战证据。'],
    modifyOutgoingDamage(attacker, target, amount) {
      if (attacker.heroId !== mountainWindIds.hero || target.side === attacker.side || target.hp <= 0) return amount;
      const missingRatio = 1 - Math.max(0, Math.min(1, target.hp / Math.max(1, target.stats.hp)));
      return amount * (1 + missingRatio * .5);
    },
    handlers: {
      'status-expiration': { priority: 47, handle(context, event) { return onControlEnded(context, event); } },
      hit: { priority: 47, handle(context, event) { return markCounterAttempt(context, event); } },
      'control-application': { priority: 47, handle(context, event) { return markCounterAttempt(context, event); } },
      'effect-resolution': { priority: 47, handle(context, event) {
        return markCounterAttempt(context, event) ?? onControlEnded(context, event);
      } },
      'attack-end': { priority: 47, handle(context, event) { return counterAfterHit(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? { actorId: unitId, skillId: mountainWindIds.ultimate, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }
        : { actorId: unitId, skillId: mountainWindIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function makeHit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string,
  ratio: number, guaranteedCrit: boolean): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const damage = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
    defenseIgnore: effectiveDefenseIgnore(actor), dmgFluctuation: .01,
    critChance: guaranteedCrit ? 1 : offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: mountainWindSource(skillId, actor.unitId), targetId: target.unitId,
    amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
}

function onControlEnded(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusCategory !== 'control'
    && context.getStatusCategory(event.statusId ?? '') !== 'control') return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== mountainWindIds.hero || owner.hp <= 0 || owner.unitKind === 'summon'
    || !passivesEnabled(owner) || context.isUnitUnableToAct(owner.unitId)) return;
  const rank = skillRank(owner, mountainWindIds.passive);
  const lowTarget = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')
    .some(target => target.hp / Math.max(1, target.stats.hp) < .35);
  const gauge = rank >= 5 && lowTarget ? 70 : 35;
  const source = mountainWindSource(mountainWindIds.passive, owner.unitId);
  return [{ type: 'change-action-gauge', source, targetId: owner.unitId, amount: gauge, parentEventId: event.eventId },
    { type: 'add-status', source, targetId: owner.unitId, instance: {
      instanceId: `${mountainWindIds.fierce}:${owner.unitId}`, statusId: mountainWindIds.fierce, source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'attack', operation: 'percent', amount: fierceAttack[rank - 1]! },
        { stat: 'resist', operation: 'flat', amount: .5 }],
    }, parentEventId: event.eventId }];
}

function markCounterAttempt(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type === 'damage' && event.amount <= 0) return;
  if (event.type !== 'damage' && event.type !== 'control-resisted' && event.type !== 'status-resisted') return;
  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const target = context.getUnit(event.targetId);
  if (!attacker || !target || attacker.side === target.side) return;
  const attackId = String(event.attackId ?? event.eventId);
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(target.side).filter(unit => unit.heroId === mountainWindIds.hero
    && unit.unitKind === 'shikigami' && passivesEnabled(unit))) {
    const existing = owner.statuses.find(status => status.statusId === mountainWindIds.passiveAttempt
      && status.source.unitId === owner.unitId);
    if (String(existing?.values?.attackId ?? '') === attackId) continue;
    const proc = context.random() < .35;
    const source = mountainWindSource(mountainWindIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
      instanceId: `${mountainWindIds.passiveAttempt}:${owner.unitId}`, statusId: mountainWindIds.passiveAttempt, source,
      stacks: 1, duration: { kind: 'permanent' }, values: { attackId, targetId: attacker.unitId, proc },
    } });
    if (proc) commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: fearStatus(owner.unitId, source) });
  }
  return commands.length ? commands : undefined;
}

function counterAfterHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.suppressTargetPassiveTriggers || event.attackId === undefined) return;
  const attackId = String(event.attackId);
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits('blue').concat(context.getLivingUnits('red')).filter(unit =>
    unit.heroId === mountainWindIds.hero && unit.unitKind === 'shikigami' && passivesEnabled(unit))) {
    const marker = owner.statuses.find(status => status.statusId === mountainWindIds.passiveAttempt
      && status.source.unitId === owner.unitId && String(status.values?.attackId ?? '') === attackId
      && status.values?.proc === true);
    const target = marker?.values?.targetId ? context.getUnit(String(marker.values.targetId)) : undefined;
    if (!marker || context.isUnitUnableToAct(owner.unitId) || !target || target.hp <= 0 || target.side === owner.side) continue;
    commands.push({ type: 'schedule-action', source: mountainWindSource(mountainWindIds.passive, owner.unitId),
      scheduling: 'counter', freeCast: true, parentEventId: event.eventId,
      intent: { actorId: owner.unitId, skillId: mountainWindIds.basic, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands.length ? commands : undefined;
}

function resolveBleed(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== mountainWindIds.bleed || !event.removedValues) return;
  const commands: EffectCommand[] = [];
  const target = context.getUnit(event.targetId);
  const owner = event.removedSource?.unitId ? context.getUnit(event.removedSource.unitId) : undefined;
  if (event.reason === 'expired' && target && target.hp > 0 && owner) {
    const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
    const hpRatio = Number(event.removedValues.currentHpRatio ?? .12);
    const attackRatio = Number(event.removedValues.attackRatio ?? .88);
    const cap = Number(event.removedValues.attackCap ?? 3.2) * attack;
    const rawDamage = Math.min(cap, Math.max(0, target.hp * hpRatio + attack * attackRatio));
    const damage = context.calculateDamage({ attack: rawDamage,
      defense: (context.getEffectiveStats(target.unitId) ?? target.stats).defense,
      ratio: 1, defenseIgnore: Number(event.removedValues.defenseIgnore ?? 600), dmgFluctuation: 0,
      critChance: 0, critDamage: 1 }, owner, target).amount;
    commands.push({ type: 'lose-life', source: mountainWindSource(mountainWindIds.ultimate, owner.unitId),
      targetId: target.unitId, amount: damage, lifeLossKind: 'indirect', parentEventId: event.eventId });
  }
  if (event.removedValues.applyHealBanOnRemoval === true && target && target.hp > 0) {
    commands.push({ type: 'add-status', source: event.removedSource ?? mountainWindSource(mountainWindIds.ultimate,
      owner?.unitId ?? 'unknown'), targetId: target.unitId, instance: {
      instanceId: `${mountainWindIds.healBan}:${event.instanceId}`, statusId: mountainWindIds.healBan,
      source: event.removedSource ?? mountainWindSource(mountainWindIds.ultimate, owner?.unitId ?? 'unknown'),
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    }, parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function fearStatus(ownerId: string, source: SourceRef): import('../core/types').StatusInstance {
  return { instanceId: `${mountainWindIds.fierce}:${ownerId}`, statusId: mountainWindIds.fierce, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
}
function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function mountainWindSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
