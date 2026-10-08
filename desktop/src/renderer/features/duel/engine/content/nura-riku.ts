import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import { heroSkillsCatalog } from '../../../../../shared/hero-skills-data';
import type { ContentRegistry } from './registry';

export const nuraRikuIds = { hero: 294, basic: '2941', passive: '2942', ultimate: '2943', fear: 'status.hero.294.fear',
  passiveAttempt: 'status.hero.294.passive-attempt' } as const;

const basicRatios = [.8, .84, .88, .92, .92] as const;
const ultimateRatios = [1.2, 1.26, 1.32, 1.38, 1.5] as const;

export function registerNuraRiku(registry: ContentRegistry): void {
  registry.registerStatus({ id: nuraRikuIds.fear, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 4,
    stackScope: 'source-unit' } satisfies StatusDefinition);
  registry.registerStatus({ id: nuraRikuIds.passiveAttempt, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const ultimate: SkillDefinition = { id: nuraRikuIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== nuraRikuIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillRank(actor, nuraRikuIds.ultimate) - 1]);
      const source = nuraRikuSource(nuraRikuIds.ultimate, actor.unitId);
      const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const damage = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
        defenseIgnore: effectiveDefenseIgnore(actor), dmgFluctuation: .01,
        critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
      return [{ type: 'add-status', source, targetId: actor.unitId, instance: fearStatus(actor.unitId, source, 1) },
        { type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
    } };
  const basic: SkillDefinition = { ...createBasicAttackSkill(nuraRikuIds.basic, basicRatios), useClientDamageData: true };
  const definition: HeroDefinition = { id: nuraRikuIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入弥弥切丸按等级80%/84%/88%/92%/92%伤害，五级普攻25%概率邀战1至2名随机友方；镜花水月在受伤或受到抵抗时按35%概率叠加1层畏、每次攻击最多判定一次，畏最多4层且每层持续4个自身回合、每层提高75%造成伤害，未被控制时免费反击攻击者；百鬼夜行消耗3火，获得1层畏并按等级造成120%至150%伤害。觉醒效果命中/抵抗面板读取基础属性。多段/同一攻击内先受伤再触发抵抗的去重、反击被打断/目标筛选、五级邀战目标抽取权重及畏层是否可驱散仍待帧核。'],
    handlers: {
      hit: { priority: 48, handle(context, event) { return markFearPassiveTrigger(context, event); } },
      'control-application': { priority: 48, handle(context, event) { return markFearPassiveTrigger(context, event); } },
      'effect-resolution': { priority: 48, handle(context, event) { return markFearPassiveTrigger(context, event); } },
      'attack-end': { priority: 48, handle(context, event) { return counterAfterFearProc(context, event); } },
      'action-end': { priority: 48, handle(context, event) { return inviteRandomAllies(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp - right.hp)[0]!;
      return (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? { actorId: unitId, skillId: nuraRikuIds.ultimate, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }
        : { actorId: unitId, skillId: nuraRikuIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function markFearPassiveTrigger(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type === 'damage' && (event.amount <= 0 || event.targetId === event.source.unitId)) return;
  if (event.type !== 'damage' && event.type !== 'control-resisted' && event.type !== 'status-resisted') return;
  const targetId = event.targetId;
  const sourceUnitId = event.source.unitId;
  if (!sourceUnitId) return;
  const attacker = context.getUnit(sourceUnitId);
  const target = context.getUnit(targetId);
  if (!attacker || !target || attacker.side === target.side) return;
  const attackId = event.attackId === undefined ? event.eventId : String(event.attackId);
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(target.side).filter(unit => unit.heroId === nuraRikuIds.hero
    && unit.unitKind === 'shikigami' && passivesEnabled(unit))) {
    const previous = owner.statuses.find(status => status.statusId === nuraRikuIds.passiveAttempt
      && status.source.unitId === owner.unitId);
    if (String(previous?.values?.attackId ?? '') === String(attackId)) continue;
    const proc = context.random() < .35;
    const source = nuraRikuSource(nuraRikuIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
      instanceId: `${nuraRikuIds.passiveAttempt}:${owner.unitId}`, statusId: nuraRikuIds.passiveAttempt, source,
      stacks: 1, duration: { kind: 'permanent' }, values: { attackId: String(attackId), targetId: attacker.unitId, proc },
    } });
    if (proc) commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: fearStatus(owner.unitId, source, 1) });
  }
  return commands.length ? commands : undefined;
}

function counterAfterFearProc(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.suppressTargetPassiveTriggers) return;
  const attackId = event.attackId === undefined ? undefined : String(event.attackId);
  if (!attackId || !event.source.unitId) return;
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits('blue').concat(context.getLivingUnits('red')).filter(unit =>
    unit.heroId === nuraRikuIds.hero && unit.unitKind === 'shikigami' && passivesEnabled(unit))) {
    const trigger = owner.statuses.find(status => status.statusId === nuraRikuIds.passiveAttempt
      && status.source.unitId === owner.unitId && String(status.values?.attackId ?? '') === attackId
      && status.values?.proc === true);
    const targetId = String(trigger?.values?.targetId ?? event.source.unitId);
    const target = context.getUnit(targetId);
    if (!trigger || context.isUnitUnableToAct(owner.unitId) || !target || target.hp <= 0 || target.side === owner.side) continue;
    commands.push({ type: 'schedule-action', source: nuraRikuSource(nuraRikuIds.passive, owner.unitId),
      scheduling: 'counter', freeCast: true, parentEventId: event.eventId,
      intent: { actorId: owner.unitId, skillId: nuraRikuIds.basic, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands.length ? commands : undefined;
}

function inviteRandomAllies(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || event.skillId !== nuraRikuIds.basic
    || !event.intent?.actorId) return;
  const owner = context.getUnit(event.intent.actorId);
  if (!owner || owner.heroId !== nuraRikuIds.hero || owner.hp <= 0 || owner.unitKind === 'summon'
    || skillRank(owner, nuraRikuIds.basic) < 5 || !passivesEnabled(owner) || context.random() >= .25) return;
  const target = event.intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0 && unit.side !== owner.side);
  if (!target) return;
  const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId
    && unit.unitKind !== 'summon' && heroSkillsCatalog.heroes[unit.heroId]?.skills[0]);
  if (!allies.length) return;
  const count = Math.min(allies.length, context.random() < .5 ? 1 : 2);
  const selected = allies.slice();
  const commands: EffectCommand[] = [];
  for (let index = 0; index < count; index += 1) {
    const ally = selected.splice(Math.floor(context.random() * selected.length), 1)[0]!;
    const skill = heroSkillsCatalog.heroes[ally.heroId]!.skills[0]!;
    commands.push({ type: 'schedule-action', source: nuraRikuSource(nuraRikuIds.basic, owner.unitId),
      scheduling: 'assist', freeCast: true, parentEventId: event.eventId,
      intent: { actorId: ally.unitId, skillId: String(skill.id), targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands;
}

function fearStatus(ownerId: string, source: SourceRef, stacks: number): import('../core/types').StatusInstance {
  return { instanceId: `${nuraRikuIds.fear}:${ownerId}`, statusId: nuraRikuIds.fear, source, stacks,
    duration: { kind: 'count', remaining: 4, owner: 'target-turn' },
    modifiers: [{ stat: 'damage', operation: 'percent', amount: .75, perStack: true }] };
}
function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function nuraRikuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
