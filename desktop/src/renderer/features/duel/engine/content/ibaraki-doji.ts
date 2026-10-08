import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { ContentRegistry } from './registry';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';

export const ibarakiDojiIds = {
  hero: 265, basic: '2651', passive: '2652', ultimate: '2653', rage: 'status.hero.265.rage',
  fatalGuard: 'status.hero.265.fatal-guard', lifeTracker: 'status.hero.265.life-tracker',
} as const;

export function registerIbarakiDoji(registry: ContentRegistry): void {
  registry.registerStatus({ id: ibarakiDojiIds.rage, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3, stackScope: 'source-unit' });
  registry.registerStatus({ id: ibarakiDojiIds.fatalGuard, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsLethalDamage: true });
  registry.registerStatus({ id: ibarakiDojiIds.lifeTracker, mechanicsCoverage: 'partial', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createIbarakiDojiDefinition());
}

export function createIbarakiDojiDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: ibarakiDojiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      return attackTarget(context, intent.actorId, intent.targetIds[0], Number(parameters.ratio ?? 1), ibarakiDojiIds.basic);
    } };
  const ultimate: SkillDefinition = {
    id: ibarakiDojiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [4.6, 5, 5.4, 5.8, 6.2].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const row = actor && battleSkillRow(ibarakiDojiIds.ultimate,
        Math.max(1, Math.min(5, actor.skillLevels?.[ibarakiDojiIds.ultimate] ?? actor.skillLevel)), actor.awakeFilter,
        actor.unitKind === 'monster' || actor.unitKind === 'summon');
      return attackTarget(context, intent.actorId, intent.targetIds[0], skillNumber(row, 'addDmg') ?? Number(parameters.ratio ?? 4.6),
        ibarakiDojiIds.ultimate);
    },
  };
  return {
    id: ibarakiDojiIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['基础攻击与地狱之手倍率、分支鬼火、怒火增伤、30%生命损失叠层、满层致命保护和迁怒过量伤害已接入。',
      '致命命中后的替代效果和目标客户端动画/触发帧尚待录像核验。'],
    handlers: {
      'attack-end': { priority: 55, handle(context, event) { return resolveRageAfterAttack(context, event); } },
      hit: { priority: 55, handle(context, event) { return gainRageFromHpLoss(context, event); } },
    },
  };
}

function resolveRageAfterAttack(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || event.source.kind !== 'skill'
    || ![ibarakiDojiIds.basic, ibarakiDojiIds.ultimate].includes(event.source.id as typeof ibarakiDojiIds.basic | typeof ibarakiDojiIds.ultimate)) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0 || actor.heroId !== ibarakiDojiIds.hero || !passivesEnabled(actor)) return;
  const defeatedNonSummons = (event.targetHealthChanges ?? []).filter(change => change.defeatedByHit
    && context.getUnit(change.targetId)?.unitKind !== 'summon');
  if (defeatedNonSummons.length > 0) {
    const row = battleSkillRow(ibarakiDojiIds.passive, 1, actor.awakeFilter,
      actor.unitKind === 'monster' || actor.unitKind === 'summon');
    const overflowRate = Math.max(0, skillNumber(row, 'param1') ?? .5);
    const overflow = defeatedNonSummons.reduce((sum, change) => sum + Math.max(0, change.overkillDamage ?? 0), 0) * overflowRate;
    if (overflow <= 0) return [];
    const enemySide = actor.side === 'blue' ? 'red' : 'blue';
    const source = rageSource(actor.unitId);
    return context.getLivingUnits(enemySide).filter(target => target.hp > 0).map(target => ({ type: 'deal-damage' as const,
      source, targetId: target.unitId, amount: overflow, damageKind: 'normal' as const, precalculated: true,
      parentEventId: event.eventId }));
  }
  return addRage(context, actor, event.eventId);
}

function gainRageFromHpLoss(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.targetId || event.hpLost <= 0) return;
  const actor = context.getUnit(event.targetId);
  if (!actor || actor.hp <= 0 || actor.heroId !== ibarakiDojiIds.hero || !passivesEnabled(actor)) return;
  const before = actor.statuses.find(status => status.statusId === ibarakiDojiIds.lifeTracker);
  const oldProgress = Number(before?.values?.hpLossProgress ?? 0);
  const total = oldProgress + event.hpLost;
  const thresholds = Math.floor(total / (actor.stats.hp * .3));
  const commands: EffectCommand[] = [];
  if (thresholds > 0) for (let i = 0; i < thresholds; i++) {
    const virtualStacks = Math.min(3, (actor.statuses.find(status => status.statusId === ibarakiDojiIds.rage)?.stacks ?? 0) + i);
    commands.push(...addRage(context, actor, event.eventId, virtualStacks));
  }
  const progress = total % (actor.stats.hp * .3);
  commands.push({ type: 'add-status', source: rageSource(actor.unitId), targetId: actor.unitId,
    instance: { instanceId: before?.instanceId ?? `${ibarakiDojiIds.lifeTracker}:${actor.unitId}`, statusId: ibarakiDojiIds.lifeTracker,
      source: rageSource(actor.unitId), stacks: 1, duration: { kind: 'permanent' }, values: { hpLossProgress: progress } },
    parentEventId: event.eventId });
  return commands;
}

function addRage(_context: BattleContext, actor: NonNullable<ReturnType<BattleContext['getUnit']>>, parentEventId: string,
  previousStacks = actor.statuses.find(status => status.statusId === ibarakiDojiIds.rage)?.stacks ?? 0): EffectCommand[] {
  if (!passivesEnabled(actor)) return [];
  const current = actor.statuses.find(status => status.statusId === ibarakiDojiIds.rage);
  const stacks = Math.min(3, previousStacks + 1);
  const rage: StatusInstance = { instanceId: current?.instanceId ?? `${ibarakiDojiIds.rage}:${actor.unitId}`,
    statusId: ibarakiDojiIds.rage, source: rageSource(actor.unitId), stacks: 1,
    duration: { kind: 'permanent' }, values: current?.values };
  const commands: EffectCommand[] = [{ type: 'add-status', source: rageSource(actor.unitId), targetId: actor.unitId,
    instance: rage, parentEventId }];
  if (previousStacks < 3 && stacks === 3 && !actor.statuses.some(status => status.statusId === ibarakiDojiIds.fatalGuard)) {
    commands.push({ type: 'add-status', source: rageSource(actor.unitId), targetId: actor.unitId,
      instance: { instanceId: `${ibarakiDojiIds.fatalGuard}:${actor.unitId}`, statusId: ibarakiDojiIds.fatalGuard,
        source: rageSource(actor.unitId), stacks: 1, duration: { kind: 'permanent' } }, parentEventId });
  }
  return commands;
}

function attackTarget(context: BattleContext, actorId: string, targetId: string | undefined, ratio: number, skillId: string): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const target = targetId ? context.getUnit(targetId) : undefined;
  if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
  const actorStats = context.getEffectiveStats(actorId) ?? actor.stats;
  const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
  const row = battleSkillRow(skillId, Math.max(1, Math.min(5, actor.skillLevels?.[skillId] ?? actor.skillLevel)), actor.awakeFilter,
    actor.unitKind === 'monster' || actor.unitKind === 'summon');
  const rageStacks = actor.statuses.find(status => status.statusId === ibarakiDojiIds.rage)?.stacks ?? 0;
  const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio: ratio + rageStacks, critChance: actorStats.crit,
    critDamage: actorStats.critDamage }, actor, target);
  const source: SourceRef = { kind: 'skill', id: skillId, unitId: actorId };
  return [{ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
    ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
}

function rageSource(unitId: string): SourceRef { return { kind: 'skill', id: ibarakiDojiIds.passive, unitId }; }
