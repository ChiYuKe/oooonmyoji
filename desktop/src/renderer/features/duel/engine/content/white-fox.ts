import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const whiteFoxIds = { hero: 316, basic: '3161', passive: '3162', ultimate: '3163', attackDown: 'status.hero.316.attack-down',
  shield: 'status.hero.316.shield', critDown: 'status.hero.316.crit-down', speedAura: 'status.hero.316.speed-aura',
  guard: 'status.hero.316.guard', field: 'status.hero.316.field', retaliationMark: 'status.hero.316.retaliation-mark' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const shieldRatios = [.2, .3, .4, .4, .4, .4] as const;
const singleReductions = [.35, .4, .45, .5, .5, .5] as const;

export function registerWhiteFox(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: whiteFoxIds.attackDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: whiteFoxIds.shield, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: whiteFoxIds.critDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: whiteFoxIds.speedAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: whiteFoxIds.guard, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: whiteFoxIds.field, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: whiteFoxIds.retaliationMark, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'event', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: whiteFoxIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== whiteFoxIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const commands = damage(context, actor, target, whiteFoxIds.basic, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]));
      if (rank(actor, basic.id) >= 2) commands.push(...attemptDebuff(context, { source: source(basic.id, actor.unitId), targetId: target.unitId,
        statusId: whiteFoxIds.attackDown, baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        modifiers: [{ stat: 'attack', operation: 'percent', amount: -.1 }] }));
      return commands;
    } };
  const ultimate: SkillDefinition = { id: whiteFoxIds.ultimate, actionKind: 'skill', target: 'all-allies', targetRelation: 'ally',
    resourceCostsByLevel: [{ resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 },
      { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 2 }],
    levels: [1, 2, 3, 4, 5, 6].map(level => ({ level, duration: level >= 5 ? 2 : 1, reduction: singleReductions[Math.min(level - 1, 5)] })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== whiteFoxIds.hero || actor.hp <= 0) return [];
      const level = rank(actor, ultimate.id);
      const duration = Number(parameters.duration ?? (level >= 5 ? 2 : 1));
      return [{ type: 'add-status', source: source(ultimate.id, actor.unitId), targetId: actor.unitId,
        instance: { instanceId: `${whiteFoxIds.field}:${actor.unitId}`, statusId: whiteFoxIds.field, source: source(ultimate.id, actor.unitId),
          stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'source-turn' },
          values: { reduction: Number(parameters.reduction ?? singleReductions[Math.min(level - 1, 5)]) } } }];
    } };

  const definition: HeroDefinition = { id: whiteFoxIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入普攻按等级100%至125%及2级起10%攻击下降；被动回合结束给其他友方施加单次伤害按20%/30%/40%吸收、总量按白藏主生命上限10%封顶的护盾，3级起护盾破裂对来源造成白藏主生命上限10%的伤害并尝试降30%暴击；5级被动按持盾友方数量动态调整速度/抵抗；结界减免单体伤害35%至50%，5级持续2回合、觉醒6级耗火2，并按每回合最低生命比例队友设置守护。录像中的护盾破裂多目标同步去重、分摊和御魂结算先后仍需逐帧核对。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      return owner?.heroId === whiteFoxIds.hero && passivesEnabled(owner) ? refreshSpeedAura(context, owner.unitId) ?? [] : [];
    },
    handlers: {
      'turn-end': { priority: 44, handle(context, event) { return applyShieldAtTurnEnd(context, event); } },
      'turn-start': { priority: 44, handle(context, event) { return onTurnStart(context, event); } },
      'effect-resolution': { priority: 44, handle(context, event) { return onStatusEvent(context, event); } },
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interception): DamageInterception | undefined {
      if (amount <= 0 || target.hp <= 0 || !interception) return;
      const fieldOwner = state.sides[target.side].map(id => state.units[id]).find(unit => unit?.heroId === whiteFoxIds.hero && unit.hp > 0
        && unit.statuses.some(status => status.statusId === whiteFoxIds.field));
      const reductionStatus = fieldOwner?.statuses.find(status => status.statusId === whiteFoxIds.field);
      const protectedId = fieldOwner?.statuses.find(status => status.statusId === whiteFoxIds.guard)?.values?.targetId;
      const effects: EffectCommand[] = [];
      let remaining = amount;
      if (fieldOwner && reductionStatus && interception.attackShape === 'single') {
        const reduction = Math.max(0, Math.min(.9, Number(reductionStatus.values?.reduction ?? .35)));
        remaining *= 1 - reduction;
        if (protectedId === target.unitId && target.unitId !== fieldOwner.unitId) {
          effects.push({ type: 'deal-damage', source: attacker ? source(interception.source?.id ?? 'white-fox-guard', attacker.unitId) : source('white-fox-guard', fieldOwner.unitId),
            targetId: fieldOwner.unitId, amount: remaining, precalculated: true, countsAsHit: false, cannotBeShared: true });
          remaining = 0;
        }
      }
      const shield = target.statuses.find(status => status.statusId === whiteFoxIds.shield && Number(status.values?.capacityRemaining ?? 0) > 0);
      const shieldOwner = contextUnit(interception.battle, shield?.source.unitId);
      if (shield && shieldOwner && shieldOwner.hp > 0 && passivesEnabled(shieldOwner)) {
        const capacity = Number(shield.values?.capacityRemaining ?? 0);
        const absorbed = Math.min(capacity, remaining * Number(shield.values?.absorbRate ?? .2));
        if (absorbed > 0) {
          remaining -= absorbed;
          const next = capacity - absorbed;
          effects.push(next > 0 ? { type: 'add-status', source: shield.source, targetId: target.unitId,
            instance: { ...shield, values: { ...shield.values, capacityRemaining: next } } }
            : { type: 'remove-status-instances', source: attacker ? source(interception.source?.id ?? 'white-fox-hit', attacker.unitId) : shield.source,
              targetId: target.unitId, instanceIds: [shield.instanceId], reason: 'consumed' });
        }
      }
      return effects.length || remaining !== amount ? { amount: remaining, effects } : undefined;
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return;
      const cost = rank(actor, ultimate.id) >= 6 ? 2 : 3;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= cost && !actor.statuses.some(status => status.statusId === whiteFoxIds.field))
        return { actorId: unitId, skillId: ultimate.id, targetIds: context.getLivingUnits(actor.side).map(unit => unit.unitId), shape: 'all-allies', targetRelation: 'ally' };
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function applyShieldAtTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== whiteFoxIds.hero || owner.hp <= 0 || !passivesEnabled(owner)) return;
  const rate = shieldRatios[rank(owner, whiteFoxIds.passive) - 1] ?? .2;
  const cap = owner.stats.hp * .1;
  const buffSource = source(whiteFoxIds.passive, owner.unitId);
  return context.getLivingUnits(owner.side).filter(ally => ally.unitId !== owner.unitId).map(ally => ({ type: 'add-status' as const,
    source: buffSource, targetId: ally.unitId, instance: { instanceId: `${whiteFoxIds.shield}:${owner.unitId}:${ally.unitId}`,
      statusId: whiteFoxIds.shield, source: buffSource, stacks: 1, duration: { kind: 'permanent' as const },
      values: { capacityRemaining: cap, absorbRate: rate } } }));
}

function onTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const turnOwner = context.getUnit(event.unitId);
  if (!turnOwner) return;
  const cleanup: EffectCommand[] = turnOwner.heroId === whiteFoxIds.hero ? context.getLivingUnits(turnOwner.side)
    .flatMap(ally => ally.statuses.filter(status => status.statusId === whiteFoxIds.shield && status.source.unitId === turnOwner.unitId)
      .map(status => ({ type: 'remove-status-instances' as const, source: status.source, targetId: ally.unitId,
        instanceIds: [status.instanceId], reason: 'expired' as const }))) : [];
  return [...cleanup, ...(selectGuardTarget(context, event) ?? [])];
}

function onStatusEvent(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type === 'status-added' && event.instance.statusId === whiteFoxIds.shield)
    return refreshSpeedAura(context, event.instance.source.unitId);
  if (event.type === 'status-removed' && event.statusId === whiteFoxIds.shield) {
    const ownerId = event.removedSource?.unitId;
    const retaliation = retaliateOnShieldBreak(context, event) ?? [];
    return [...retaliation, ...(refreshSpeedAura(context, ownerId) ?? [])];
  }
  return undefined;
}

function refreshSpeedAura(context: BattleContext, ownerId?: string): EffectCommand[] | undefined {
  const owner = ownerId ? context.getUnit(ownerId) : undefined;
  if (!owner || owner.heroId !== whiteFoxIds.hero || rank(owner, whiteFoxIds.passive) < 5) return;
  const holderCount = context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId
    && unit.statuses.some(status => status.statusId === whiteFoxIds.shield && status.source.unitId === owner.unitId)).length;
  const speed = Math.max(0, 60 - holderCount * 10), resist = Math.max(0, .6 - holderCount * .1);
  const src = source(whiteFoxIds.passive, owner.unitId);
  return [{ type: 'add-status', source: src, targetId: owner.unitId, instance: { instanceId: `${whiteFoxIds.speedAura}:${owner.unitId}`,
    statusId: whiteFoxIds.speedAura, source: src, stacks: 1, duration: { kind: 'permanent' },
    values: { holderCount, speed, resist }, modifiers: [{ stat: 'speed', operation: 'flat', amount: speed },
      { stat: 'resist', operation: 'flat', amount: resist }] } }];
}

function selectGuardTarget(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const allies = context.getLivingUnits(context.getUnit(event.unitId)?.side ?? 'blue');
  const foxes = allies.filter(unit => unit.heroId === whiteFoxIds.hero && unit.statuses.some(status => status.statusId === whiteFoxIds.field));
  const commands: EffectCommand[] = [];
  for (const fox of foxes) {
    const target = allies.filter(unit => unit.unitId !== fox.unitId).slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
    if (!target) continue;
    const src = source(whiteFoxIds.ultimate, fox.unitId);
    commands.push({ type: 'add-status', source: src, targetId: fox.unitId,
      instance: { instanceId: `${whiteFoxIds.guard}:${fox.unitId}`, statusId: whiteFoxIds.guard, source: src, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { targetId: target.unitId } } });
  }
  return commands;
}

function retaliateOnShieldBreak(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== whiteFoxIds.shield || event.reason !== 'consumed' || !event.removedSource?.unitId) return;
  const owner = context.getUnit(event.removedSource.unitId), attacker = context.getUnit(event.source.unitId ?? '');
  if (!owner || owner.hp <= 0 || owner.heroId !== whiteFoxIds.hero || rank(owner, whiteFoxIds.passive) < 3 || !passivesEnabled(owner) || !attacker
    || attacker.hp <= 0 || attacker.side === owner.side) return;
  const attackKey = String(event.attackId ?? event.parentEventId ?? event.eventId);
  const previous = owner.statuses.find(status => status.statusId === whiteFoxIds.retaliationMark);
  if (previous?.values?.attackKey === attackKey) return;
  const src = source(whiteFoxIds.passive, owner.unitId);
  const effects: EffectCommand[] = [{ type: 'add-status', source: src, targetId: owner.unitId,
    instance: { instanceId: `${whiteFoxIds.retaliationMark}:${owner.unitId}`, statusId: whiteFoxIds.retaliationMark, source: src, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'event' }, values: { attackKey } } },
    { type: 'lose-life', source: src, targetId: attacker.unitId, amount: owner.stats.hp * .1 }];
  effects.push(...attemptDebuff(context, { source: src, targetId: attacker.unitId, statusId: whiteFoxIds.critDown,
    baseChance: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'crit', operation: 'flat', amount: -.3 }] }));
  return effects;
}

function damage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio, defenseIgnore: effectiveDefenseIgnore(actor),
    dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: source(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(6, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function contextUnit(context: BattleContext, unitId?: string): UnitState | undefined { return unitId ? context.getUnit(unitId) : undefined; }
