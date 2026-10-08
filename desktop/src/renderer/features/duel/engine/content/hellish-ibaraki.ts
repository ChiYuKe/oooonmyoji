import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { ContentRegistry } from './registry';

export const hellishIbarakiIds = { hero: 322, basic: '3221', passive: '3222', ultimate: '3223' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.31, 1.38, 1.45, 1.51, 1.64] as const;
const flameBonusCaps = [.2, .3, .4, .5, .5] as const;

export function registerHellishIbaraki(registry: ContentRegistry): void {
  const basic: SkillDefinition = { id: hellishIbarakiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      return attack(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!));
    } };
  const ultimate: SkillDefinition = { id: hellishIbarakiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), selected = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !selected || !validEnemy(actor, selected)) return [];
      const enemies = context.getLivingUnits(selected.side);
      if (!enemies.length) return [];
      const level = rank(actor, ultimate.id), ratio = Number(parameters.ratio ?? ultimateRatios[level - 1]!);
      const bonus = passivesEnabled(actor) && enemies.length > 1
        ? Math.min((enemies.length - 1) * .1, flameBonusCaps[rank(actor, hellishIbarakiIds.passive) - 1]!) : 0;
      return enemies.flatMap(enemy => attack(context, actor, enemy, ultimate.id, ratio * (1 + bonus)));
    } };

  const definition: HeroDefinition = { id: hellishIbarakiIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['鬼爪100%至125%伤害、炼狱之门耗3火及131%至164%全体鬼焰已接入。狂意按额外敌人数提升鬼焰伤害，封顶20%/30%/40%/50%；五级被动在鬼焰击败非召唤敌人后，将鬼焰过量伤害汇总为鬼手额外一段伤害。鬼手先攻击选中目标；该目标被鬼焰击败时改攻当前生命值最高的敌人。10点场阵容不含该式神，缺少其直接触发帧；御魂交互、过量伤害完整客户端结算和AI策略仍待对局帧核。'],
    handlers: { 'attack-end': { priority: 67, handle(context, event) { return resolveGhostHand(context, event); } } },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== hellishIbarakiIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const side = actor.side === 'blue' ? 'red' : 'blue', enemies = context.getLivingUnits(side); if (!enemies.length) return;
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      return { actorId: actor.unitId, skillId: fire >= 3 ? ultimate.id : basic.id,
        targetIds: fire >= 3 ? [target.unitId, ...enemies.filter(enemy => enemy.unitId !== target.unitId).map(enemy => enemy.unitId)]
          : [target.unitId], ...(fire >= 3 ? { selectedTargetId: target.unitId } : {}),
        shape: fire >= 3 ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function resolveGhostHand(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.kind !== 'skill' || event.source.id !== hellishIbarakiIds.ultimate
    || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0 || actor.heroId !== hellishIbarakiIds.hero) return;
  const livingEnemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
  if (!livingEnemies.length) return [];
  const selectedId = event.selectedTargetIds?.[0];
  const selected = selectedId ? context.getUnit(selectedId) : undefined;
  const selectedWasDefeated = event.targetHealthChanges?.some(change => change.targetId === selectedId && change.defeatedByHit) ?? false;
  const handTarget = selected && selected.hp > 0 && !selectedWasDefeated
    ? selected : [...livingEnemies].sort((left, right) => right.hp - left.hp)[0]!;
  const ratio = ultimateRatios[rank(actor, hellishIbarakiIds.ultimate) - 1]!;
  const commands = attack(context, actor, handTarget, hellishIbarakiIds.ultimate, ratio, event.eventId);

  if (passivesEnabled(actor) && rank(actor, hellishIbarakiIds.passive) >= 5) {
    const overkill = (event.targetHealthChanges ?? []).filter(change => change.defeatedByHit
      && context.getUnit(change.targetId)?.unitKind !== 'summon')
      .reduce((total, change) => total + Math.max(0, change.overkillDamage ?? 0), 0);
    if (overkill > 0) commands.push({ type: 'deal-damage', source: source(hellishIbarakiIds.ultimate, actor.unitId),
      targetId: handTarget.unitId, amount: overkill, precalculated: true, parentEventId: event.eventId });
  }
  return commands;
}

function validEnemy(actor: Readonly<UnitState>, target: Readonly<UnitState>): boolean {
  return actor.heroId === hellishIbarakiIds.hero && actor.hp > 0 && target.hp > 0 && target.side !== actor.side;
}
function attack(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number,
  parentEventId?: string): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, dmgFluctuation: .01,
    critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: source(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
    ...(parentEventId ? { parentEventId } : {}) }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
