import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yashaIds = {
  hero: 276,
  basic: '2761',
  passive: '2762',
  ultimate: '2763',
  speed: 'status.hero.276.ghost-speed',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const passiveChances = [.3, .35, .4, .45, .5] as const;
const ultimateRatios = [1.98, 2.08, 2.18, 2.28, 2.38] as const;

export function registerYasha(registry: ContentRegistry): void {
  registry.registerStatus({ id: yashaIds.speed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  const ultimate: SkillDefinition = { id: yashaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map((ratio, index) => ({ ratio, repeatChance: .5, rank: index + 1 })),
    execute(context, intent, parameters) {
      return damage(context, intent.actorId, intent.targetIds.slice(0, 1), yashaIds.ultimate, Number(parameters.ratio ?? 1.98));
    } };
  const definition: HeroDefinition = {
    id: yashaIds.hero, skills: [createBasicAttackSkill(yashaIds.basic, basicRatios), ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['屠戮普攻、鬼魅造成伤害后按技能等级30%至50%增加20速度持续2回合、黄泉之海3火与198%至238%伤害/50%随机敌人重复施放已接入。重复施放使用免火即时追加行动，后续重复仍继续掷概率；99次引擎触发预算会终止异常递归，原生重复上限/触发时序、多段御魂联动需帧核。'],
    handlers: {
      hit: { priority: 38, handle(context, event) { return gainSpeedAfterDamage(context, event); } },
      'attack-end': { priority: 38, handle(context, event) { return repeatUltimate(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      const enemies = actor && context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon' || !enemies?.length) return undefined;
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? yashaIds.ultimate : yashaIds.basic;
      return { actorId: unitId, skillId, targetIds: [enemies[Math.floor(context.random() * enemies.length)]!.unitId],
        shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function gainSpeedAfterDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0 || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== yashaIds.hero || actor.unitKind === 'summon' || actor.hp <= 0 || !passivesEnabled(actor)
    || context.random() >= passiveChances[skillIndex(actor, yashaIds.passive)]!) return;
  const source = yashaSource(yashaIds.passive, actor.unitId);
  const instance: StatusInstance = { instanceId: `${yashaIds.speed}:${actor.unitId}`, statusId: yashaIds.speed,
    source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: 20 }] };
  return [{ type: 'add-status', source, targetId: actor.unitId, instance, parentEventId: event.eventId }];
}

function repeatUltimate(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== yashaIds.ultimate || !event.source.unitId || !event.targetHealthChanges?.length) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== yashaIds.hero || actor.hp <= 0 || actor.unitKind === 'summon' || !passivesEnabled(actor)) return;
  const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
  if (!enemies.length || context.random() >= .5) return;
  const target = enemies[Math.floor(context.random() * enemies.length)]!;
  const intent: ActionIntent = { actorId: actor.unitId, skillId: yashaIds.ultimate, targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy' };
  return [{ type: 'schedule-action', source: yashaSource(yashaIds.ultimate, actor.unitId), intent,
    scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId }];
}

function damage(context: BattleContext, actorId: string, targets: readonly string[], skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const attack = context.getEffectiveStats(actorId);
  if (!actor || !attack || actor.hp <= 0) return [];
  return targets.flatMap(targetId => {
    const target = context.getUnit(targetId);
    const defense = context.getEffectiveStats(targetId)?.defense;
    if (!target || target.hp <= 0 || defense === undefined) return [];
    const hit = context.calculateDamage({ attack: attack.attack, defense, ratio,
      critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: yashaSource(skillId, actorId), targetId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
  });
}

function skillIndex(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(0, Math.min(4, (unit.skillLevels?.[skillId] ?? unit.skillLevel) - 1));
}
function yashaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
