import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const ubumeIds = {
  hero: 262,
  basic: '2621',
  passive: '2622',
  ultimate: '2623',
  attackAwakening: 'status.hero.262.attack-awakening',
} as const;

const basicRatios = [.8, .84, .88, .92, .96] as const;
const sweepRatios = [.33, .35, .37, .39, .41] as const;
const finisherRatios = [.88, .93, .98, 1.03, 1.08] as const;

export function registerUbume(registry: ContentRegistry): void {
  registry.registerStatus({ id: ubumeIds.attackAwakening, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createUbumeDefinition());
}

export function createUbumeDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(ubumeIds.basic, basicRatios);
  basic.execute = (context, intent, parameters) => {
    const actor = context.getUnit(intent.actorId);
    if (!actor || actor.hp <= 0) return [];
    const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
    const source = ubumeSource(ubumeIds.basic, actor.unitId);
    return intent.targetIds.flatMap(targetId => {
      const target = context.getUnit(targetId);
      if (!target || target.hp <= 0) return [];
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const result = context.calculateDamage({ attack: attack.attack, defense,
        defenseIgnore: effectiveDefenseIgnore(actor) + defense * .2, ratio: Number(parameters.ratio ?? 1),
        critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
      return [{ type: 'deal-damage' as const, source, targetId, amount: result.amount,
        ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
        ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}),
        isCritical: result.isCritical }];
    });
  };

  const ultimate: SkillDefinition = {
    id: ubumeIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: sweepRatios.map((ratio, index) => ({
      sweepRatio: ratio, finisherRatio: finisherRatios[index]!,
    })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const primaryTargetId = intent.targetIds[0];
      const source = ubumeSource(ubumeIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      for (let hitIndex = 0; hitIndex < 3; hitIndex++) {
        for (const targetId of intent.targetIds) {
          const target = context.getUnit(targetId);
          if (!target || target.hp <= 0) continue;
          commands.push(ubumeDamage(context, actor, target, source, attack.attack,
            Number(parameters.sweepRatio ?? .33)));
        }
      }
      if (primaryTargetId) {
        const target = context.getUnit(primaryTargetId);
        if (target && target.hp > 0) commands.push(ubumeDamage(context, actor, target, source,
          attack.attack, Number(parameters.finisherRatio ?? .88)));
      }
      return commands;
    },
  };

  return {
    id: ubumeIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3且有多个敌人时选择天翔鹤斩，否则使用伞剑；更完整的目标优先级与客户端选招仍需校准'],
    mechanicsCoverageNotes: ['伞剑按技能等级造成80%至96%攻击伤害并无视目标20%防御；天翔鹤斩消耗3火，对敌方全体造成3段33%至41%攻击伤害，再对意图列表中的首个目标追加88%至108%攻击伤害；协战在友方普通攻击结束时按30%概率追加一次伞剑。开战时若姑获鸟攻击力不低于其他非召唤友方，获得客户端 buff_2622_1（增伤100%、协战率60%）。目标死亡后的协战选敌、并列最高攻击判定、增益持续/驱散和实战帧仍需校对'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== ubumeIds.hero || !passivesEnabled(actor)) return [];
      const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
      const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId && unit.unitKind !== 'summon');
      if (allies.some(unit => (context.getEffectiveStats(unit.unitId)?.attack ?? unit.stats.attack) > attack)) return [];
      const source = ubumeSource(ubumeIds.passive, actor.unitId);
      const instance: StatusInstance = { instanceId: `${ubumeIds.attackAwakening}:${actor.unitId}`,
        statusId: ubumeIds.attackAwakening, source, stacks: 1, duration: { kind: 'permanent' },
        modifiers: [{ stat: 'damage', operation: 'percent', amount: 1 }], values: { assistChance: .6 } };
      return [{ type: 'add-status', source, targetId: actor.unitId, instance }];
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const targetIds = enemies.map(unit => unit.unitId);
      if (targetIds.length > 1 && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: ubumeIds.ultimate, targetIds, shape: 'all-enemies', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: ubumeIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: { 'attack-end': { priority: 31, handle(context, event) { return assistOnAllyBasic(context, event); } } },
  };
}

function assistOnAllyBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId || !event.targetHealthChanges?.length) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker) return;
  const livingTarget = event.targetHealthChanges.map(change => context.getUnit(change.targetId))
    .find(target => target && target.hp > 0 && target.side !== attacker.side);
  if (!livingTarget) return;
  const commands: EffectCommand[] = [];
  for (const ubume of context.getLivingUnits(attacker.side).filter(unit => unit.heroId === ubumeIds.hero
    && unit.unitId !== attacker.unitId && passivesEnabled(unit))) {
    const awakening = ubume.statuses.find(status => status.statusId === ubumeIds.attackAwakening);
    if (context.random() >= (awakening ? .6 : .3)) continue;
    const source = ubumeSource(ubumeIds.passive, ubume.unitId);
    commands.push({ type: 'schedule-action', source, scheduling: 'assist', parentEventId: event.eventId,
      intent: { actorId: ubume.unitId, skillId: ubumeIds.basic, targetIds: [livingTarget.unitId],
        shape: 'single', targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands;
}

function ubumeDamage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  attack: number, ratio: number): EffectCommand {
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const result = context.calculateDamage({ attack, defense, defenseIgnore: effectiveDefenseIgnore(actor) + defense * .2,
    ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}),
    isCritical: result.isCritical };
}

function ubumeSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
