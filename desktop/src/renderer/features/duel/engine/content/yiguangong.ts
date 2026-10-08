import type { DamageInterceptionContext, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yiguangongIds = {
  hero: 368,
  basic: '3681',
  passive: '3682',
  skill: '3683',
  sugar: 'status.hero.368.sugar-dip',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const shareRatios = [.15, .18, .21, .25, .3] as const;
const healRatios = [.1, .12, .12, .15, .15] as const;
const sugarDurations = [2, 2, 3, 3, 3] as const;

export function registerYiguangong(registry: ContentRegistry): void {
  registry.registerStatus({ id: yiguangongIds.sugar, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createYiguangongDefinition());
}

export function createYiguangongDefinition(): HeroDefinition {
  const skill: SkillDefinition = {
    id: yiguangongIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'ally',
    levels: healRatios.map((healRatio, index) => ({ healRatio, duration: sugarDurations[index]!, overflowGauge: .08,
      selfHealRatio: index === 4 ? .05 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0 || target.side !== actor.side
        || target.unitId === actor.unitId || target.unitKind === 'summon') return [];
      const source = yiguangongSource(yiguangongIds.skill, actor.unitId);
      const currentHealthCost = actor.hp * .15;
      const duration = Math.max(1, Math.floor(Number(parameters.duration ?? 2)));
      return [{ type: 'lose-life', source, targetId: actor.unitId, amount: currentHealthCost, lifeLossKind: 'direct' },
        { type: 'add-status', source, targetId: target.unitId, instance: {
          instanceId: `${yiguangongIds.sugar}:${actor.unitId}:${target.unitId}`, statusId: yiguangongIds.sugar,
          source, stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'target-turn' },
          values: { ownerUnitId: actor.unitId, healTriggers: 0, healRatio: Number(parameters.healRatio ?? .1),
            overflowGauge: Number(parameters.overflowGauge ?? .08), selfHealRatio: Number(parameters.selfHealRatio ?? 0) },
        } }];
    },
  };
  return {
    id: yiguangongIds.hero,
    skills: [createBasicAttackSkill(yiguangongIds.basic, basicRatios), skill],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能行实现：饴细工为当前生命比例最低的友方分担15%至30%伤害；一物一心消耗自身当前生命15%，给非自身、非召唤友方施加2至3回合糖渍，饴细工受伤时按每个目标每回合最多3次治疗糖渍目标10%生命上限，治疗溢出推进8%行动条，五级治疗友方时另治疗自身5%生命上限。伤害分担的低血目标动态切换、护盾吸收计次和多饴细工归属仍需实战帧核验。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const allies = context.getLivingUnits(actor.side).filter(ally => ally.unitId !== actor.unitId && ally.unitKind !== 'summon');
      const target = [...allies].filter(ally => !ally.statuses.some(status => status.statusId === yiguangongIds.sugar))
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0];
      if (target && (context.state.resources[actor.side]?.fire ?? 0) >= 2
        && target.hp / Math.max(1, target.stats.hp) < .8) {
        return { actorId: actor.unitId, skillId: yiguangongIds.skill, targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' };
      }
      const enemy = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId: yiguangongIds.basic, targetIds: [enemy.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception) {
      return interceptYiguangongDamage(state, attacker, target, amount, interception);
    },
    handlers: {
      hit: { priority: 150, handle(context, event) { return healSugarDippedAllies(context, event); } },
      'turn-start': { priority: 150, handle(context, event) { return resetSugarTurnCount(context, event); } },
      'effect-resolution': { priority: 150, handle(context, event) { return rewardSugarOverflow(context, event); } },
    },
  };
}

function interceptYiguangongDamage(state: import('../core/types').BattleState, attacker: Readonly<UnitState> | undefined,
  target: Readonly<UnitState>, amount: number, context?: DamageInterceptionContext) {
  if (context?.cannotBeShared || !attacker || attacker.side === target.side || amount <= 0) return undefined;
  const protectors = state.sides[target.side].map(unitId => state.units[unitId]).filter((unit): unit is UnitState => Boolean(unit
    && unit.hp > 0 && unit.heroId === yiguangongIds.hero && passivesEnabled(unit)));
  for (const protector of protectors) {
    const allies = state.sides[protector.side].map(unitId => state.units[unitId]).filter((unit): unit is UnitState => Boolean(unit
      && unit.hp > 0));
    const lowest = [...allies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
      - right.hp / Math.max(1, right.stats.hp) || left.unitId.localeCompare(right.unitId))[0];
    if (!lowest || lowest.unitId !== target.unitId || target.unitId === protector.unitId) continue;
    const rank = skillLevel(protector, yiguangongIds.passive);
    const ratio = shareRatios[Math.max(0, Math.min(4, rank - 1))]!;
    const shared = amount * ratio;
    const source = yiguangongSource(yiguangongIds.passive, protector.unitId);
    return { amount: amount - shared, effects: [{ type: 'lose-life' as const, source, targetId: protector.unitId,
      amount: shared, lifeLossKind: 'direct' as const }] };
  }
  return undefined;
}

function healSugarDippedAllies(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0 || !event.targetId) return;
  const wearer = context.getUnit(event.targetId);
  if (!wearer || wearer.heroId !== yiguangongIds.hero || wearer.hp <= 0 || !passivesEnabled(wearer)) return;
  const source = yiguangongSource(yiguangongIds.passive, wearer.unitId);
  const commands: EffectCommand[] = [];
  for (const ally of context.getLivingUnits(wearer.side)) {
    const sugar = ally.statuses.find(status => status.statusId === yiguangongIds.sugar
      && String(status.values?.ownerUnitId ?? status.source.unitId ?? '') === wearer.unitId);
    if (!sugar || Number(sugar.values?.healTriggers ?? 0) >= 3) continue;
    const updated: StatusInstance = { ...sugar, values: { ...sugar.values, healTriggers: Number(sugar.values?.healTriggers ?? 0) + 1 } };
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: updated, parentEventId: event.eventId },
      { type: 'heal', source, targetId: ally.unitId, amount: wearer.stats.hp * .1, parentEventId: event.eventId });
    if (Number(sugar.values?.selfHealRatio ?? 0) > 0 && skillLevel(wearer, yiguangongIds.skill) >= 5) {
      commands.push({ type: 'heal', source: yiguangongSource(yiguangongIds.skill, wearer.unitId), targetId: wearer.unitId,
        amount: wearer.stats.hp * Number(sugar.values?.selfHealRatio ?? 0), parentEventId: event.eventId });
    }
  }
  return commands.length ? commands : undefined;
}

function resetSugarTurnCount(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const sugar of target.statuses.filter(status => status.statusId === yiguangongIds.sugar)) {
    if (Number(sugar.values?.healTriggers ?? 0) === 0) continue;
    const owner = sugar.source.unitId ? context.getUnit(sugar.source.unitId) : undefined;
    if (!owner || owner.heroId !== yiguangongIds.hero) continue;
    commands.push({ type: 'add-status', source: yiguangongSource(yiguangongIds.skill, owner.unitId), targetId: target.unitId,
      instance: { ...sugar, values: { ...sugar.values, healTriggers: 0 } }, parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function rewardSugarOverflow(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'healing' || event.source.id !== yiguangongIds.passive || !event.source.unitId
    || event.requestedAmount <= event.hpGained) return;
  const target = context.getUnit(event.targetId);
  const sugar = target?.statuses.find(status => status.statusId === yiguangongIds.sugar
    && String(status.values?.ownerUnitId ?? status.source.unitId ?? '') === event.source.unitId);
  if (!target || !sugar || Number(sugar.values?.overflowGauge ?? .08) <= 0) return;
  return [{ type: 'change-action-gauge', source: event.source, targetId: target.unitId,
    amount: Number(sugar.values?.overflowGauge ?? .08) * 100, parentEventId: event.eventId }];
}

function yiguangongSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
