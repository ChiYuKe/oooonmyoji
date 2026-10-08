import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const gulonghuoIds = {
  hero: 274,
  basic: '2741',
  passive: '2742',
  ultimate: '2743',
  evilPrank: 'status.hero.274.evil-prank',
} as const;

const fireRecoveryChances = [.2, .25, .3, .3, .3] as const;
const damageBonusByLevel = [.1, .15, .2, .25, .3] as const;

export function registerGulonghuo(registry: ContentRegistry): void {
  const evilPrank: StatusDefinition = { id: gulonghuoIds.evilPrank, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsSkill: true };
  registry.registerStatus(evilPrank);

  const ultimate: SkillDefinition = {
    id: gulonghuoIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'any', levels: damageBonusByLevel.map((damageBonus, index) => ({ damageBonus, rank: index + 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0 && unit.unitId !== actor?.unitId);
      if (!actor || actor.heroId !== gulonghuoIds.hero || actor.hp <= 0 || !target) return [];
      const rank = Math.max(1, Math.min(5, Number(parameters.rank ?? actor.skillLevel)));
      const damageBonus = Number(parameters.damageBonus ?? damageBonusByLevel[rank - 1]);
      return applyEvilPrank(context, actor.unitId, target.unitId, damageBonus);
    },
  };
  const definition: HeroDefinition = {
    id: gulonghuoIds.hero,
    skills: [createBasicAttackSkill(gulonghuoIds.basic, [1, 1.05, 1.1, 1.15, 1.25]), ultimate],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['火风车普攻倍率、灵运受击回火概率（20%/25%/30%）与行动结束鬼火为0时回1火、恶戏之火3火施加两回合沉默/伤害增加已接入。客户端技能表确认恶戏增伤10%至30%；行动时回火按行动结算结束检查，仍需录像核对具体触发帧/满火溢出边界。'],
    handlers: {
      hit: { priority: 31, handle(context, event) { return recoverFireWhenAttacked(context, event); } },
      'action-end': { priority: 31, handle(context, event) { return recoverFireAtZeroActionEnd(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemy = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')[0];
      if (!enemy) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const ally = context.getLivingUnits(actor.side).find(unit => unit.unitId !== actor.unitId);
      if (fire >= 3 && ally) return gulonghuoIntent(actor.unitId, gulonghuoIds.ultimate, ally.unitId);
      if (fire >= 3) return gulonghuoIntent(actor.unitId, gulonghuoIds.ultimate, enemy.unitId);
      return gulonghuoIntent(actor.unitId, gulonghuoIds.basic, enemy.unitId);
    },
  };
  registry.registerHero(definition);
}

function applyEvilPrank(context: BattleContext, actorId: string, targetId: string, damageBonus: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const target = context.getUnit(targetId);
  if (!actor || !target || target.hp <= 0 || target.unitId === actor.unitId) return [];
  const source = gulonghuoSource(gulonghuoIds.ultimate, actorId);
  const instance: StatusInstance = { instanceId: `${gulonghuoIds.evilPrank}:${actorId}:${targetId}:${context.state.counters.action}`,
    statusId: gulonghuoIds.evilPrank, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    values: { damageBonus }, modifiers: [{ stat: 'damage', operation: 'percent', amount: damageBonus }] };

  // The client explicitly guarantees a friendly target is hit. Preserve normal control-immunity handling,
  // but do not let friendly-target resistance cancel that guaranteed application.
  if (target.side === actor.side) return [{ type: 'apply-control', source, targetId, instance }];

  const control = attemptControl(context, { attemptId: instance.instanceId, source, targetId,
    statusId: gulonghuoIds.evilPrank, controlType: '沉默', baseChance: 1,
    duration: instance.duration });
  if (!control || control.type !== 'apply-control') return control ? [control] : [];
  return [{ ...control, instance: { ...control.instance, values: instance.values, modifiers: instance.modifiers } }];
}

function recoverFireWhenAttacked(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0 || target.heroId !== gulonghuoIds.hero || target.unitKind === 'summon'
    || !passivesEnabled(target)) return;
  const fire = context.state.resources[target.side]?.fire ?? 0;
  if (fire >= 8 || context.random() >= fireRecoveryChances[skillIndex(target.skillLevel)]!) return;
  return [{ type: 'change-resource', source: gulonghuoSource(gulonghuoIds.passive, target.unitId), side: target.side,
    resourceId: 'fire', amount: 1, parentEventId: event.eventId }];
}

function recoverFireAtZeroActionEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.intent) return;
  const actorId = event.intent.actorId;
  const actor = context.getUnit(actorId);
  if (!actor || actor.hp <= 0 || actor.heroId !== gulonghuoIds.hero || actor.unitKind === 'summon'
    || !passivesEnabled(actor) || (context.state.resources[actor.side]?.fire ?? 0) !== 0) return;
  return [{ type: 'change-resource', source: gulonghuoSource(gulonghuoIds.passive, actorId), side: actor.side,
    resourceId: 'fire', amount: 1, parentEventId: event.eventId }];
}

function skillIndex(level: number): number { return Math.max(0, Math.min(4, Math.trunc(level) - 1)); }
function gulonghuoIntent(actorId: string, skillId: string, targetId: string): ActionIntent {
  return { actorId, skillId, targetIds: [targetId], shape: 'single', targetRelation: 'any' };
}
function gulonghuoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
