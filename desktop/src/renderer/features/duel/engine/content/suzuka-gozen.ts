import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const suzukaGozenIds = { hero: 351, basic: '3511', guard: '3512', ultimate: '3513',
  duty: 'status.hero.351.duty-heart', barrier: 'status.hero.351.foot-barrier' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const guardRatios = [2.11, 2.11, 2.11, 2.11, 2.11] as const;
const ultimateRatios = [.44, .47, .5, .53, .53] as const;

export function registerSuzukaGozen(registry: ContentRegistry): void {
  registry.registerStatus({ id: suzukaGozenIds.duty, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: suzukaGozenIds.barrier, mechanicsCoverage: 'unsupported', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const basic = createBasicAttackSkill(suzukaGozenIds.basic, basicRatios);
  const guard: SkillDefinition = { id: suzukaGozenIds.guard, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: guardRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp <= 0 || target.side === owner.side) return [];
      const source = suzukaSource(suzukaGozenIds.guard, owner.unitId);
      const commands = damage(context, owner, target, Number(parameters.ratio ?? 2.11), 1, source);
      const level = rank(owner, suzukaGozenIds.guard);
      const duration = { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const };
      commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
        instanceId: `${suzukaGozenIds.duty}:${owner.unitId}`, statusId: suzukaGozenIds.duty, source, stacks: 1, duration,
        modifiers: [
          ...(level >= 3 ? [{ stat: 'resist' as const, operation: 'percent' as const, amount: .5 }] : []),
          ...(level >= 4 ? [{ stat: 'critResist' as const, operation: 'flat' as const, amount: 1 }] : []),
        ],
      } });
      for (const ally of context.getLivingUnits(owner.side)) commands.push({ type: 'add-status', source, targetId: ally.unitId,
        instance: { instanceId: `${suzukaGozenIds.barrier}:${owner.unitId}:${ally.unitId}`, statusId: suzukaGozenIds.barrier,
          source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
      if (level >= 2) for (const ally of context.getLivingUnits(owner.side))
        commands.push({ type: 'change-action-gauge', source, targetId: ally.unitId, amount: 10 });
      return commands;
    } };
  const ultimate: SkillDefinition = { id: suzukaGozenIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 4 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio, hits: 5, leechRate: .1 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit
        && unit.hp > 0 && unit.side !== owner.side));
      const source = suzukaSource(suzukaGozenIds.ultimate, owner.unitId);
      const ratio = Number(parameters.ratio ?? .44), hits = Math.max(1, Number(parameters.hits ?? 5));
      const commands = targets.flatMap(target => damage(context, owner, target, ratio, hits, source, .1));
      return commands;
    } };

  const definition: HeroDefinition = { id: suzukaGozenIds.hero, skills: [basic, guard, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于4时施放万羽浪行，不足时以逐影攻击生命比例最低的敌方；客户端选招和麓魂·极的优先级仍待录像核验。'],
    mechanicsCoverageNotes: ['已接入逐影100%至125%倍率；麓魂·极消耗2火、单体211%伤害、为全体友方添加1回合麓障、二级起推全队10%行动条、三级起义理之心增加50%效果抵抗、四级起增加100%暴击抵抗；万羽浪行消耗4火、全体5段44%至53%伤害及每段10%吸血。麓障的客户端实际防护效果、二技能五级强制目标回合、万羽浪行五级按鬼火消耗成长仍待实现/帧核。'],
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= 4 ? suzukaGozenIds.ultimate : suzukaGozenIds.basic;
      return { actorId: unitId, skillId, targetIds: skillId === suzukaGozenIds.ultimate ? enemies.map(enemy => enemy.unitId) : [target.unitId],
        shape: skillId === suzukaGozenIds.ultimate ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    } };
  registry.registerHero(definition);
}

function damage(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, hits: number,
  source: SourceRef, leechRate = 0): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  return Array.from({ length: hits }, () => {
    const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: offense.crit, critDamage: offense.critDamage }, owner as UnitState, target as UnitState);
    return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: result.amount, isCritical: result.isCritical,
      ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), ...(leechRate > 0 ? { leechRate } : {}) };
  });
}
function rank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function suzukaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
