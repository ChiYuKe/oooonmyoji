import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const xiaosongwanIds = { hero: 290, basic: '2901', passive: '2902', ultimate: '2903',
  stun: 'status.hero.290.stun' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.5, 1.59, 1.68, 1.77, 1.87] as const;
const dodgeChances = [.15, .18, .19, .21, .25] as const;

export function registerXiaosongwan(registry: ContentRegistry): void {
  registry.registerStatus({ id: xiaosongwanIds.stun, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 2,
    preventsAction: true } satisfies StatusDefinition);

  const basic: SkillDefinition = { id: xiaosongwanIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== xiaosongwanIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return hit(context, actor, target, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]), basic.id);
    } };
  const ultimate: SkillDefinition = { id: xiaosongwanIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio, hits: 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== xiaosongwanIds.hero || actor.hp <= 0) return [];
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const first = enemies.find(unit => unit.unitId === intent.targetIds[0]);
      if (!first || !enemies.length) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[rank(actor, ultimate.id) - 1]);
      const source = xiaosongwanSource(ultimate.id, actor.unitId);
      const hitCountByTarget = new Map<string, number>();
      const commands: EffectCommand[] = [];
      for (let index = 0; index < 4; index += 1) {
        const living = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        if (!living.length) break;
        const target = index === 0 ? first : living[Math.min(living.length - 1, Math.floor(context.random() * living.length))]!;
        const priorHits = hitCountByTarget.get(target.unitId) ?? 0;
        const damageRatio = ratio * Math.pow(.6, priorHits);
        commands.push(...hit(context, actor, target, damageRatio, ultimate.id));
        const stunChance = priorHits > 0 ? .2 : .42;
        const control = attemptControl(context, { attemptId: `${xiaosongwanIds.stun}:${context.state.counters.action}:${index}:${target.unitId}`,
          source, targetId: target.unitId, statusId: xiaosongwanIds.stun, controlType: '眩晕', baseChance: stunChance,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (control) commands.push(control);
        hitCountByTarget.set(target.unitId, priorHits + 1);
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: xiaosongwanIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入松果一击按等级100%至125%伤害、胆怯非间接伤害受击时按技能等级15%至25%概率闪避、单体攻击闪避后由当前生命最高的其他友方承受原伤害80%、闪避时按50%基础概率眩晕攻击者1回合；怒气消耗3火，四次踩踏首次选定目标后续随机目标，按等级150%至187%攻击，同一目标后续伤害每次递减40%，重复目标眩晕概率降为20%，控制最多叠2回合。客户端数据明确说明闪避免疫附带技能效果，但引擎拦截器只分摊伤害，技能追加效果是否同步免疫仍需补足事件级拦截；反击和多段攻击的逐击概率、踩踏选敌序列与御魂插入时序仍待帧核。'],
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception): DamageInterception | undefined {
      if (target.heroId !== xiaosongwanIds.hero || target.hp <= 0 || target.unitKind === 'summon' || amount <= 0
        || !passivesEnabled(target) || !attacker || attacker.side === target.side || !interception) return;
      const chance = dodgeChances[rank(target, xiaosongwanIds.passive) - 1]!;
      if (interception.battle.random() >= chance) return;
      const source = xiaosongwanSource(xiaosongwanIds.passive, target.unitId);
      const effects: EffectCommand[] = [];
      if (interception.attackShape === 'single' && interception.targetIds.length === 1) {
        const ally = state.sides[target.side].map(id => state.units[id]).filter((unit): unit is UnitState => Boolean(unit
          && unit.unitId !== target.unitId && unit.hp > 0 && unit.unitKind !== 'summon'))
          .sort((left, right) => right.hp - left.hp)[0];
        if (ally) effects.push({ type: 'deal-damage', source, targetId: ally.unitId, amount: amount * .8,
          precalculated: true, countsAsHit: false, suppressTargetPassiveTriggers: true, suppressTargetSoulTriggers: true });
      }
      const stun = attemptControl(interception.battle, { attemptId: `${xiaosongwanIds.stun}:dodge:${interception.attackId}:${interception.hitIndex}`,
        source, targetId: attacker.unitId, statusId: xiaosongwanIds.stun, controlType: '眩晕', baseChance: .5,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
      if (stun) effects.push(stun);
      return { amount: 0, effects };
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return { actorId: actor.unitId, skillId: xiaosongwanIds.ultimate,
          targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: actor.unitId, skillId: xiaosongwanIds.basic,
        targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function hit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, skillId: string): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const damage = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
    defenseIgnore: effectiveDefenseIgnore(actor), dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage },
  actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: xiaosongwanSource(skillId, actor.unitId), targetId: target.unitId, amount: damage.amount,
    ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function xiaosongwanSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
