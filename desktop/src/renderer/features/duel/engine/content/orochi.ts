import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, EffectCommand, SourceRef, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { ContentRegistry } from './registry';

export const orochiIds = { hero: 325, basic: '3251', unholyPower: '3252', ultimate: '3253', hellfire: '3254',
  toxin: '3256', gaze: '3257', fiveSenses: 'status.hero.325.five-senses' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.15] as const;
const ultimateRatios = [1.58, 1.66, 1.75, 1.83, 1.83] as const;

export function registerOrochi(registry: ContentRegistry): void {
  const fiveSenses: StatusDefinition = { id: orochiIds.fiveSenses, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' };
  registry.registerStatus(fiveSenses);

  const basic: SkillDefinition = { id: orochiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, gaze: index === 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      const snakes = ownedSnakes(context, actor);
      const gaze = Boolean(parameters.gaze) && snakes.length > 0;
      return attack(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!),
        gaze ? (context.getEffectiveStats(target.unitId) ?? target.stats).defense * .2 : 0);
    } };

  const ultimate: SkillDefinition = { id: orochiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.heroId !== orochiIds.hero || actor.hp <= 0) return [];
      const side = actor.side === 'blue' ? 'red' : 'blue', enemies = context.getLivingUnits(side);
      if (!enemies.length) return [];
      const snakes = ownedSnakes(context, actor).sort((left, right) =>
        (context.getEffectiveStats(right.unitId) ?? right.stats).attack - (context.getEffectiveStats(left.unitId) ?? left.stats).attack).slice(0, 5);
      const source = orochiSource(ultimate.id, actor.unitId);
      const commands: EffectCommand[] = [];
      for (const _snake of snakes) {
        const target = randomUnit(context, enemies);
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: {
          instanceId: `${orochiIds.fiveSenses}:${actor.unitId}:${target.unitId}`, statusId: orochiIds.fiveSenses,
          source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          values: { sealPassives: true, sealSouls: true } } });
      }
      const level = rank(actor, ultimate.id), ratio = Number(parameters.ratio ?? ultimateRatios[level - 1]!);
      for (const enemy of enemies) commands.push(...attack(context, actor, enemy, ultimate.id, ratio));
      for (const snake of snakes) {
        const target = randomUnit(context, enemies);
        commands.push(...attack(context, snake, target, orochiIds.toxin, 1));
        commands.push({ type: 'change-action-gauge', source, targetId: actor.unitId, amount: 10 });
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: orochiIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['魂魄碎裂100%/105%/110%/115%/115%伤害已接入；五级且已有蛇魔时附加凝视，忽略目标20%防御。神念之影耗3火，158%/166%/175%/183%/183%攻击全体，最多选攻击最高的5只蛇魔各随机使用一次毒液（100%攻击），每次毒液后为八岐大蛇推进10点行动条；每只蛇魔随机使一名敌人于其回合结束前封印被动与御魂。八岐之影、不洁之力变身/新回合、魔印叠层与三层引爆、无友方存活后的神愤之炎及御魂继承仍未建模；本场阵容不含八岐大蛇，缺少直接触发帧。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== orochiIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) return { actorId: unitId, skillId: ultimate.id,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function ownedSnakes(context: BattleContext, actor: Readonly<UnitState>): Readonly<UnitState>[] {
  return context.getLivingUnits(actor.side).filter(unit => unit.unitKind === 'summon' && unit.summonedByUnitId === actor.unitId);
}
function randomUnit(context: BattleContext, units: readonly Readonly<UnitState>[]): Readonly<UnitState> {
  return units[Math.min(units.length - 1, Math.floor(context.random() * units.length))]!;
}
function validEnemy(actor: Readonly<UnitState> | undefined, target: Readonly<UnitState> | undefined): actor is Readonly<UnitState> {
  return Boolean(actor && actor.heroId === orochiIds.hero && actor.hp > 0 && target && target.hp > 0 && target.side !== actor.side);
}
function attack(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number,
  additionalDefenseIgnore = 0): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor) + additionalDefenseIgnore, ratio, dmgFluctuation: .01,
    critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: orochiSource(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function orochiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
