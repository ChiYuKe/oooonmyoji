import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yaodaoJiIds = {
  hero: 269,
  basic: '2691',
  passive: '2692',
  ultimate: '2693',
  flower: '2695',
  critGrowth: 'status.hero.269.crit-growth',
  yaohua: 'status.hero.269.yaohua',
  attackChain: 'status.hero.269.attack-chain',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const killRatios = [.5, .52, .54, .56, .58] as const;
const flowerRatios = [.6, .65, .7, .75, .8] as const;
const critBonuses = [.05, .06, .07, .08, .1] as const;
const critCaps = [1, 1.2, 1.4, 1.6, 2] as const;

/** Client rows 2691–2695: crit-damage growth, awakening at 350%, and six chained strikes. */
export function registerYaodaoJi(registry: ContentRegistry): void {
  registry.registerStatus({ id: yaodaoJiIds.critGrowth, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 20 });
  registry.registerStatus({ id: yaodaoJiIds.yaohua, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: yaodaoJiIds.attackChain, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerHero(createYaodaoJiDefinition());
}

export function createYaodaoJiDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(yaodaoJiIds.basic, basicRatios);
  const kill = createChainedSkill(yaodaoJiIds.ultimate, killRatios, false);
  const flower = createChainedSkill(yaodaoJiIds.flower, flowerRatios, true);
  return {
    id: yaodaoJiIds.hero,
    skills: [basic, kill, flower],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已实现普攻等级倍率、暴击永久叠加暴伤（按被动等级限制上限）、回合开始达到350%暴伤后永久进入妖华、杀戮/百花缭乱3火逐击攻击及击败目标后转向当前生命值最低的敌人；妖华触发等级与多目标换靶额外攻击数仍需实战帧核验'],
    handlers: {
      hit: { priority: 42, handle(context, event) { return gainCriticalDamage(context, event); } },
      'turn-start': { priority: 42, handle(context, event) { return enterYaohua(context, event); } },
      'attack-end': { priority: 42, handle(context, event) { return continueAttackChain(context, event); } },
      'action-end': { priority: 42, handle(context, event) { return clearAttackChain(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp - right.hp)[0]!;
      const inYaohua = actor.statuses.some(status => status.statusId === yaodaoJiIds.yaohua);
      const skillId = inYaohua ? yaodaoJiIds.flower : yaodaoJiIds.ultimate;
      return (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }
        : { actorId: unitId, skillId: yaodaoJiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function createChainedSkill(id: string, ratios: readonly number[], flower: boolean): SkillDefinition {
  return {
    id, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 }, target: 'single', targetRelation: 'enemy',
    levels: ratios.map(ratio => ({ ratio })),
    canUse: (_state, actor) => actor.statuses.some(status => status.statusId === yaodaoJiIds.yaohua) === flower,
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0 || target.side === actor.side) return [];
      const ratio = Number(parameters.ratio ?? ratios[0]);
      const source = yaodaoSource(id, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId,
        instance: { instanceId: `${yaodaoJiIds.attackChain}:${actor.unitId}`, statusId: yaodaoJiIds.attackChain,
          source, stacks: 1, duration: { kind: 'permanent' }, values: {
            remainingHits: 6, targetId: target.unitId, ratio, skillId: id, rank: skillRank(actor, yaodaoJiIds.ultimate),
          } } },
      ];
      const hit = calculateHit(context, actor, target, id, ratio);
      if (hit) commands.push(hit);
      return commands;
    },
  };
}

function gainCriticalDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.isCritical || !event.source.unitId || event.amount <= 0) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== yaodaoJiIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)) return;
  const rank = skillRank(actor, yaodaoJiIds.passive);
  const current = actor.statuses.find(status => status.statusId === yaodaoJiIds.critGrowth && status.source.unitId === actor.unitId);
  const maximum = Math.floor(critCaps[rank - 1]! / critBonuses[rank - 1]!);
  if ((current?.stacks ?? 0) >= maximum) return;
  const source = yaodaoSource(yaodaoJiIds.passive, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId,
    instance: { instanceId: `${yaodaoJiIds.critGrowth}:${actor.unitId}`, statusId: yaodaoJiIds.critGrowth,
      source, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'critDamage', operation: 'flat', amount: critBonuses[rank - 1]!, perStack: true }] } }];
}

function enterYaohua(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== yaodaoJiIds.hero || !passivesEnabled(actor)
    || actor.statuses.some(status => status.statusId === yaodaoJiIds.yaohua)) return;
  const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  if (stats.critDamage < 3.5) return;
  const source = yaodaoSource(yaodaoJiIds.passive, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId,
    instance: { instanceId: `${yaodaoJiIds.yaohua}:${actor.unitId}`, statusId: yaodaoJiIds.yaohua,
      source, stacks: 1, duration: { kind: 'permanent' } } }];
}

function continueAttackChain(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || (event.source.id !== yaodaoJiIds.ultimate && event.source.id !== yaodaoJiIds.flower)) return;
  const owner = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const chain = owner?.statuses.find(status => status.statusId === yaodaoJiIds.attackChain && status.source.id === event.source.id);
  if (!owner || owner.hp <= 0 || !chain) return;
  let remaining = Number(chain.values?.remainingHits ?? 0);
  if (remaining <= 0) return clearChain(owner, chain, event.eventId);
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
  if (!enemies.length) return clearChain(owner, chain, event.eventId);
  const oldTargetId = String(chain.values?.targetId ?? '');
  let target = enemies.find(unit => unit.unitId === oldTargetId);
  let changedTarget = false;
  if (!target) {
    target = enemies.slice().sort((left, right) => left.hp - right.hp)[0];
    changedTarget = Boolean(target && target.unitId !== oldTargetId);
  }
  if (!target) return clearChain(owner, chain, event.eventId);
  remaining -= 1;
  const rank = Number(chain.values?.rank ?? 1);
  if (changedTarget && rank >= 5) remaining += 2;
  const skillId = event.source.id;
  const ratio = Number(chain.values?.ratio ?? .5);
  const source = yaodaoSource(skillId, owner.unitId);
  const commands: EffectCommand[] = [];
  if (remaining > 0) {
    commands.push({ type: 'add-status', source, targetId: owner.unitId,
      instance: { ...chain, source, values: { ...chain.values, remainingHits: remaining, targetId: target.unitId } }, parentEventId: event.eventId });
  } else return clearChain(owner, chain, event.eventId);
  const hit = calculateHit(context, owner, target, skillId, ratio);
  if (hit) commands.push({ type: 'schedule-attack', source,
    intent: { actorId: owner.unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy', kind: 'skill' },
    scheduling: 'counter', hits: [{ targetId: target.unitId, amount: hit.amount,
      ...(hit.criticalBaseAmount === undefined ? {} : { criticalBaseAmount: hit.criticalBaseAmount }),
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }], parentEventId: event.eventId });
  return commands;
}

function clearAttackChain(_context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || (event.skillId !== yaodaoJiIds.ultimate && event.skillId !== yaodaoJiIds.flower)) return;
  const owner = event.source.unitId ? _context.getUnit(event.source.unitId) : undefined;
  const chain = owner?.statuses.find(status => status.statusId === yaodaoJiIds.attackChain);
  return owner && chain ? clearChain(owner, chain, event.eventId) : undefined;
}

function clearChain(owner: Readonly<UnitState>, chain: StatusInstance, parentEventId: string): EffectCommand[] {
  return [{ type: 'remove-status-instances', source: chain.source, targetId: owner.unitId,
    instanceIds: [chain.instanceId], reason: 'consumed', parentEventId }];
}

function calculateHit(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string,
  ratio: number): Extract<EffectCommand, { type: 'deal-damage' }> | undefined {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const hit = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    critChance: attack.crit, critDamage: attack.critDamage }, actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source: yaodaoSource(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}), isCritical: hit.isCritical };
}

function skillRank(unit: Readonly<UnitState>, id: string): number {
  return Math.max(1, Math.min(5, Math.floor(unit.skillLevels?.[id] ?? unit.skillLevel)));
}

function yaodaoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
