import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const karutaIds = { hero: 581, basic: '5811', passive: '5812', ultimate: '5813', memory: 'status.hero.581.flower-memory',
  mark: 'status.hero.581.pig-deer-butterfly', guard: 'status.hero.581.card-guard' } as const;
const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const selectedRatios = [2.9, 2.9, 3.1, 3.3, 3.5] as const;
const splashRatio = 1.95;

export function registerKaruta(registry: ContentRegistry): void {
  registry.registerStatus({ id: karutaIds.memory, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 6, stackScope: 'source-unit' });
  registry.registerStatus({ id: karutaIds.mark, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: karutaIds.guard, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const basicBase = createBasicAttackSkill(karutaIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicBase, execute(context, intent, parameters) {
    const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
    if (!owner || owner.hp <= 0 || !target || target.hp <= 0 || target.side === owner.side) return [];
    const commands = basicBase.execute(context, intent, parameters) as EffectCommand[];
    if (rank(owner, karutaIds.basic) >= 5 && passivesEnabled(owner)) commands.push(addMemory(owner, target, 1, karutaIds.basic));
    return commands;
  } };
  const ultimate: SkillDefinition = { id: karutaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: selectedRatios.map(ratio => ({ ratio, splashRatio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !selected || selected.hp <= 0 || selected.side === owner.side) return [];
      const rankValue = rank(owner, karutaIds.ultimate), passiveRank = rank(owner, karutaIds.passive);
      const source = karutaSource(karutaIds.ultimate, owner.unitId);
      const selectedMemory = selected.statuses.find(status => status.statusId === karutaIds.memory && status.source.unitId === owner.unitId);
      const preHitStacks = selectedMemory?.stacks ?? 0;
      const bonusIgnore = passiveRank >= 5 && preHitStacks >= 6 ? 180 : 0;
      const bonusDamage = passiveRank >= 4 ? 1.5 : 1;
      const focusedRatio = Number(parameters.ratio ?? selectedRatios[rankValue - 1]!) * bonusDamage;
      const otherRatio = Number(parameters.splashRatio ?? splashRatio) * bonusDamage;
      const enemies = context.getLivingUnits(selected.side).filter(unit => unit.hp > 0);
      const commands: EffectCommand[] = [addMemory(owner, selected, 2, karutaIds.ultimate)];
      commands.push(...indirectHit(context, owner, selected, focusedRatio, bonusIgnore, source));
      for (const enemy of enemies) if (enemy.unitId !== selected.unitId)
        commands.push(...indirectHit(context, owner, enemy, otherRatio, 0, source));
      commands.push({ type: 'add-status', source, targetId: selected.unitId, instance: { instanceId: `${karutaIds.mark}:${owner.unitId}:${selected.unitId}`,
        statusId: karutaIds.mark, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
      if (passivesEnabled(owner) && passiveRank >= 3) commands.push({ type: 'add-status', source: karutaSource(karutaIds.passive, owner.unitId),
        targetId: owner.unitId, instance: { instanceId: `${karutaIds.guard}:${owner.unitId}`, statusId: karutaIds.guard,
          source: karutaSource(karutaIds.passive, owner.unitId), stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -.3 }] } });
      return commands;
    } };
  registry.registerHero({ id: karutaIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3时对花忆层数最多的敌人施放五光斩，否则普攻；客户端目标优先级和队伍鬼火策略仍需帧核。'],
    mechanicsCoverageNotes: ['已接入青短等级倍率、五级普攻附加1层花忆；五光斩3火，对目标造成290/310/330/350%间接伤害并附加2层花忆，对其他敌人造成195%间接伤害；花忆最多6层，二级起每层降低10%治疗，受伤时可向伤害来源叠层；三级五光斩后自身获得两回合30%减伤，四级起间接伤害提升50%，五级攻击原有6层目标无视180防御。花忆叠层触发边界、怪物例外和客户端状态持续时序仍待战斗帧核。'],
    policy(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const target = enemies.slice().sort((a, b) => memoryStacks(b, owner.unitId) - memoryStacks(a, owner.unitId)
        || a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const useSkill = (context.state.resources[owner.side]?.fire ?? 0) >= 3;
      return { actorId: unitId, skillId: useSkill ? karutaIds.ultimate : karutaIds.basic, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy' };
    },
    handlers: { hit: { priority: 68, handle(context, event) { return addMemoryOnDamage(context, event); } } },
  });
}

function addMemoryOnDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const owner = context.getUnit(event.targetId), attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (!owner || owner.heroId !== karutaIds.hero || !passivesEnabled(owner) || rank(owner, karutaIds.passive) < 2
    || !attacker || attacker.hp <= 0 || attacker.side === owner.side || attacker.unitKind === 'summon') return;
  return [addMemory(owner, attacker, 2, karutaIds.passive)];
}
function addMemory(owner: Readonly<UnitState>, target: Readonly<UnitState>, stacks: number, skillId: string): EffectCommand {
  const source = karutaSource(skillId, owner.unitId);
  const previous = target.statuses.find(status => status.statusId === karutaIds.memory && status.source.unitId === owner.unitId);
  const rankValue = rank(owner, karutaIds.passive);
  return { type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${karutaIds.memory}:${owner.unitId}:${target.unitId}`,
    statusId: karutaIds.memory, source, stacks: Math.max(1, stacks), duration: { kind: 'permanent' },
    values: { ...(previous?.values ?? {}), ownerUnitId: owner.unitId },
    ...(rankValue >= 2 && target.unitKind !== 'monster' ? { modifiers: [{ stat: 'healingTaken' as const, operation: 'percent' as const,
      amount: -.1, perStack: true }] } : {}) } };
}
function indirectHit(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, ratio: number, extraIgnore: number,
  source: SourceRef): EffectCommand[] {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const calculated = calculateIndirectDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(owner) + extraIgnore, ratio, critDamage: offense.critDamage }, context.random);
  return [{ type: 'lose-life', source, targetId: target.unitId, amount: calculated.amount, lifeLossKind: 'indirect' }];
}
function memoryStacks(target: Readonly<UnitState>, ownerId: string): number {
  return target.statuses.filter(status => status.statusId === karutaIds.memory && status.source.unitId === ownerId)
    .reduce((total, status) => total + status.stacks, 0);
}
function rank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function karutaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
