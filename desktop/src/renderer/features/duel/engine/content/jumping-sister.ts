import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

/** 跳跳妹妹 and Tomato, including the summoned unit's typed skill state. */
export const jumpingSisterIds = {
  hero: 226,
  basic: '2261',
  passive: '2262',
  summon: '2263',
  tomatoRage: '4024',
  tomatoBrutal: '4026',
  tomatoFollowup: '2267',
  justice: 'status.hero.226.lolita-justice',
  tomato: 'status.hero.226.tomato',
  growUp: 'status.hero.226.grow-up',
  reviveCount: 'status.hero.226.revive-count',
  reviveCooldown: 'status.hero.226.revive-cooldown',
  occupiedEnemySlot: 'status.hero.226.occupied-enemy-slot',
} as const;

const basicRatios = [.5, .53, .55, .58, .63] as const;

export function registerJumpingSister(registry: ContentRegistry): void {
  registry.registerStatus({ id: jumpingSisterIds.justice, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'source-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: jumpingSisterIds.tomato, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: jumpingSisterIds.growUp, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 5 });
  registry.registerStatus({ id: jumpingSisterIds.reviveCount, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: jumpingSisterIds.reviveCooldown, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: jumpingSisterIds.occupiedEnemySlot, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsRevive: true });

  const definition: HeroDefinition = {
    id: jumpingSisterIds.hero,
    skills: [createBasicAttackSkill(jumpingSisterIds.basic, basicRatios), createSummonTomato(), createTomatoFollowup(),
      createTomatoRage(), createTomatoBrutal()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 116, handle(context, event) { return tomatoDispelOnHit(context, event); } },
      'attack-end': { priority: 116, handle(context, event) { return inviteTomato(context, event); } },
      'effect-resolution': { priority: 114, handle(context, event) { return tomatoSummoned(context, event); } },
      'turn-end': { priority: 115, handle(context, event) { return grantLolitaJustice(context, event); } },
      'unit-defeated': { priority: 116, handle(context, event) { return handleDefeat(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = lowestRatio(enemies);
      if (!target) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (actor.unitKind === 'summon' && actor.statuses.some(status => status.statusId === jumpingSisterIds.tomato)) {
        return { actorId: unitId, skillId: jumpingSisterIds.tomatoRage,
          targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const tomato = context.getLivingUnits(actor.side).some(unit => unit.unitKind === 'summon'
        && unit.summonedByUnitId === actor.unitId && unit.statuses.some(status => status.statusId === jumpingSisterIds.tomato));
      const skillId = tomato ? (fire >= 2 ? jumpingSisterIds.tomatoFollowup : jumpingSisterIds.basic)
        : fire >= 2 ? jumpingSisterIds.summon : jumpingSisterIds.basic;
      return skillId === jumpingSisterIds.summon
        ? { actorId: unitId, skillId, targetIds: [unitId], shape: 'self', targetRelation: 'ally' }
        : { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createSummonTomato(): SkillDefinition {
  return {
    id: jumpingSisterIds.summon,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self',
    targetRelation: 'ally',
    levels: [0, 0, 0, 0, 0].map((attackBonus, index) => ({
      hpRatio: index >= 3 ? 1 : .6, attackRatio: index >= 1 ? .8 : .5, attackBonus,
      skillHitDispels: index >= 2, inviteOnOwnerAttack: index >= 4,
    })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return [];
      const existing = context.getLivingUnits(owner.side).some(unit => unit.summonedByUnitId === owner.unitId
        && unit.statuses.some(status => status.statusId === jumpingSisterIds.tomato));
      if (existing) return [];
      const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const unitId = `tomato:${owner.unitId}:${context.state.counters.action + 1}`;
      const source = sisterSource(jumpingSisterIds.summon, owner.unitId);
      const tomatoMark: StatusInstance = { instanceId: `${jumpingSisterIds.tomato}:${unitId}`,
        statusId: jumpingSisterIds.tomato, source, stacks: 1, duration: { kind: 'permanent' },
        values: { ownerUnitId: owner.unitId, skillHitDispels: Boolean(parameters.skillHitDispels),
          inviteOnOwnerAttack: Boolean(parameters.inviteOnOwnerAttack) } };
      const maxHp = Math.max(1, ownerStats.hp * Number(parameters.hpRatio ?? .6));
      const tomato: UnitState = { unitId, heroId: jumpingSisterIds.hero, unitKind: 'summon', summonedByUnitId: owner.unitId,
        side: owner.side, skillLevel: owner.skillLevel,
        stats: { ...ownerStats, hp: maxHp, attack: ownerStats.attack * Number(parameters.attackRatio ?? .5)
          + ownerStats.attack * Number(parameters.attackBonus ?? 0) },
        hp: maxHp, shield: 0, actionGauge: 0, statuses: [tomatoMark], resources: {} };
      return [{ type: 'summon-unit', source, unit: tomato }];
    },
  };
}

function createTomatoRage(): SkillDefinition {
  return {
    id: jumpingSisterIds.tomatoRage,
    actionKind: 'passive',
    target: 'single',
    targetRelation: 'enemy',
    levels: [{ ratio: 1 }],
    execute(context, intent, parameters) { return tomatoAttack(context, intent.actorId, intent.targetIds[0] ?? '',
      jumpingSisterIds.tomatoRage, Number(parameters.ratio ?? 1)); },
  };
}

function createTomatoBrutal(): SkillDefinition {
  return {
    id: jumpingSisterIds.tomatoBrutal,
    actionKind: 'passive',
    target: 'single',
    targetRelation: 'enemy',
    allowDefeatedTargets: true,
    levels: [{ healRatio: 1 }],
    execute(context, intent, parameters) {
      const tomato = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const assigned = tomato?.statuses.some(status => status.statusId === jumpingSisterIds.tomato);
      if (!tomato || tomato.unitKind !== 'summon' || !assigned || !target || target.hp > 0) return [];
      const source = sisterSource(jumpingSisterIds.tomatoBrutal, tomato.unitId);
      const commands: EffectCommand[] = [];
      if (!target.statuses.some(status => status.statusId === jumpingSisterIds.occupiedEnemySlot)) {
        const occupation: StatusInstance = { instanceId: `${jumpingSisterIds.occupiedEnemySlot}:${target.unitId}`,
          statusId: jumpingSisterIds.occupiedEnemySlot, source, stacks: 1, duration: { kind: 'permanent' } };
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: occupation });
      }
      commands.push({ type: 'restore-health', source, targetId: tomato.unitId,
        amount: tomato.stats.hp * Number(parameters.healRatio ?? 1) });
      return commands;
    },
  };
}

function createTomatoFollowup(): SkillDefinition {
  return {
    id: jumpingSisterIds.tomatoFollowup,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single',
    targetRelation: 'enemy',
    levels: [{ ratio: 1.25, growAttack: .2, growCrit: .2, growSpeed: 10, maxStacks: 5, cooldown: 2 }],
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const tomato = owner && context.getLivingUnits(owner.side).find(unit => unit.unitKind === 'summon'
        && unit.summonedByUnitId === owner.unitId && unit.statuses.some(status => status.statusId === jumpingSisterIds.tomato));
      const primary = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.heroId !== jumpingSisterIds.hero || owner.unitKind === 'summon'
        || !tomato || !primary || primary.hp <= 0) return [];
      const grow = tomato.statuses.find(status => status.statusId === jumpingSisterIds.growUp);
      const stacks = Math.min(Number(parameters.maxStacks ?? 5), (grow?.stacks ?? 0) + 1);
      const source = sisterSource(jumpingSisterIds.tomatoFollowup, tomato.unitId);
      const commands: EffectCommand[] = [];
      if (grow) commands.push({ type: 'remove-statuses', source, targetId: tomato.unitId,
        statusIds: [jumpingSisterIds.growUp], reason: 'replaced' });
      const growStatus: StatusInstance = { instanceId: `${jumpingSisterIds.growUp}:${tomato.unitId}`,
        statusId: jumpingSisterIds.growUp, source, stacks, duration: { kind: 'permanent' },
        modifiers: [{ stat: 'attack', operation: 'percent', amount: stacks * Number(parameters.growAttack ?? .2) },
          { stat: 'crit', operation: 'flat', amount: stacks * Number(parameters.growCrit ?? .2) },
          { stat: 'speed', operation: 'flat', amount: stacks * Number(parameters.growSpeed ?? 10) }] };
      commands.push({ type: 'add-status', source, targetId: tomato.unitId, instance: growStatus });
      const enemies = context.getLivingUnits(tomato.side === 'blue' ? 'red' : 'blue');
      const second = lowestRatio(enemies);
      const stats = context.getEffectiveStats(tomato.unitId) ?? tomato.stats;
      const growAttack = stats.attack * (grow ? 1 : 1 + Number(parameters.growAttack ?? .2));
      const growCrit = Math.min(1, stats.crit + (grow ? 0 : Number(parameters.growCrit ?? .2)));
      for (const target of [primary, second].filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0))) {
        const defense = context.getEffectiveStats(target.unitId);
        if (!defense) continue;
        const hit = context.calculateDamage({ attack: growAttack, defense: defense.defense,
          defenseIgnore: effectiveDefenseIgnore(tomato), ratio: Number(parameters.ratio ?? 1.25), critChance: growCrit,
          critDamage: stats.critDamage }, tomato, target);
        commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical });
      }
      return commands;
    },
  };
}

function tomatoAttack(context: BattleContext, actorId: string, targetId: string, skillId: string, ratio: number): EffectCommand[] {
  const tomato = context.getUnit(actorId);
  const target = context.getUnit(targetId);
  const attack = context.getEffectiveStats(actorId);
  const defense = context.getEffectiveStats(targetId);
  if (!tomato || tomato.unitKind !== 'summon' || !tomato.statuses.some(status => status.statusId === jumpingSisterIds.tomato)
    || !target || target.hp <= 0 || !attack || !defense) return [];
  const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(tomato), ratio, critChance: attack.crit, critDamage: attack.critDamage }, tomato, target);
  return [{ type: 'deal-damage', source: sisterSource(skillId, tomato.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function tomatoSummoned(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-summoned' || event.heroId !== jumpingSisterIds.hero) return;
  const tomato = context.getUnit(event.unitId);
  if (!tomato?.statuses.some(status => status.statusId === jumpingSisterIds.tomato)) return;
  const target = lowestRatio(context.getLivingUnits(tomato.side === 'blue' ? 'red' : 'blue'));
  if (!target) return;
  const source = sisterSource(jumpingSisterIds.summon, tomato.summonedByUnitId ?? tomato.unitId);
  return [{ type: 'schedule-action', source, intent: { actorId: tomato.unitId, skillId: jumpingSisterIds.tomatoRage,
    targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }, scheduling: 'assist', freeCast: true,
    parentEventId: event.eventId }];
}

function tomatoDispelOnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const tomato = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  const mark = tomato?.statuses.find(status => status.statusId === jumpingSisterIds.tomato);
  if (!tomato || tomato.heroId !== jumpingSisterIds.hero || tomato.unitKind !== 'summon' || !mark
    || !mark.values?.skillHitDispels || !target || target.hp <= 0) return;
  const buffs = target.statuses.filter(status => context.getStatusCategory(status.statusId) === 'buff'
    && context.isStatusDispellable(status.statusId));
  if (!buffs.length) return;
  const selected = buffs[Math.min(buffs.length - 1, Math.floor(context.random() * buffs.length))]!;
  return [{ type: 'dispel-statuses', source: sisterSource(event.source.id, tomato.unitId), targetId: target.unitId,
    statusIds: [selected.statusId], maxCount: 1, parentEventId: event.eventId }];
}

function inviteTomato(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== jumpingSisterIds.hero || owner.unitKind === 'summon' || owner.skillLevel < 5) return;
  const targetId = event.targetHealthChanges?.[0]?.targetId;
  const tomato = context.getLivingUnits(owner.side).find(unit => unit.unitKind === 'summon'
    && unit.summonedByUnitId === owner.unitId && unit.statuses.some(status => status.statusId === jumpingSisterIds.tomato));
  if (!targetId || !tomato || context.getUnit(targetId)?.hp === 0) return;
  return [{ type: 'schedule-action', source: sisterSource(jumpingSisterIds.passive, owner.unitId),
    intent: { actorId: tomato.unitId, skillId: jumpingSisterIds.tomatoRage,
      targetIds: [targetId], shape: 'single', targetRelation: 'enemy' }, scheduling: 'assist', freeCast: true,
    parentEventId: event.eventId }];
}

function grantLolitaJustice(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== jumpingSisterIds.hero || owner.unitKind === 'summon'
    || owner.hp <= 0 || !passivesEnabled(owner) || context.random() >= .3) return;
  const source = sisterSource(jumpingSisterIds.passive, owner.unitId);
  return context.getLivingUnits(owner.side).map(ally => ({ type: 'add-status' as const, source, targetId: ally.unitId,
    instance: { instanceId: `${jumpingSisterIds.justice}:${owner.unitId}:${ally.unitId}`,
      statusId: jumpingSisterIds.justice, source, stacks: 1,
      duration: { kind: 'count' as const, remaining: 2, owner: 'source-turn' as const },
      modifiers: [{ stat: 'defense' as const, operation: 'percent' as const, amount: .3 }] },
    parentEventId: event.eventId }));
}

function handleDefeat(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated) return;
  if (defeated.heroId === jumpingSisterIds.hero && defeated.unitKind !== 'summon') {
    const tomato = context.getLivingUnits(defeated.side).find(unit => unit.unitKind === 'summon'
      && unit.summonedByUnitId === defeated.unitId && unit.statuses.some(status => status.statusId === jumpingSisterIds.tomato));
    const cooldown = defeated.statuses.find(status => status.statusId === jumpingSisterIds.reviveCooldown);
    if (!tomato || cooldown) return;
    const previousCount = Number(defeated.statuses.find(status => status.statusId === jumpingSisterIds.reviveCount)?.values?.count ?? 0);
    const nextCount = previousCount + 1;
    const source = sisterSource(jumpingSisterIds.passive, defeated.unitId);
    const countStatus: StatusInstance = { instanceId: `${jumpingSisterIds.reviveCount}:${defeated.unitId}`,
      statusId: jumpingSisterIds.reviveCount, source, stacks: nextCount, duration: { kind: 'permanent' },
      values: { count: nextCount } };
    const commands: EffectCommand[] = [
      { type: 'revive', source, targetId: defeated.unitId, hp: defeated.stats.hp, parentEventId: event.eventId },
      ...(previousCount > 0 ? [{ type: 'remove-statuses' as const, source, targetId: defeated.unitId,
        statusIds: [jumpingSisterIds.reviveCount], reason: 'replaced' as const, parentEventId: event.eventId }] : []),
      { type: 'add-status', source, targetId: defeated.unitId, instance: countStatus, parentEventId: event.eventId },
      { type: 'add-status', source, targetId: defeated.unitId, instance: {
        instanceId: `${jumpingSisterIds.reviveCooldown}:${defeated.unitId}:${nextCount}`,
        statusId: jumpingSisterIds.reviveCooldown, source, stacks: 1,
        duration: { kind: 'count', remaining: nextCount, owner: 'source-turn' },
      }, parentEventId: event.eventId },
    ];
    return commands;
  }
  if (defeated.unitKind === 'summon') return;
  const enemySide = defeated.side;
  const commands: EffectCommand[] = [];
  for (const tomato of context.getLivingUnits(enemySide === 'blue' ? 'red' : 'blue').filter(unit => unit.unitKind === 'summon'
    && unit.statuses.some(status => status.statusId === jumpingSisterIds.tomato))) {
    commands.push({ type: 'schedule-action', source: sisterSource(jumpingSisterIds.tomatoBrutal,
      tomato.summonedByUnitId ?? tomato.unitId), intent: { actorId: tomato.unitId, skillId: jumpingSisterIds.tomatoBrutal,
      targetIds: [defeated.unitId], shape: 'single', targetRelation: 'enemy' }, scheduling: 'assist', freeCast: true,
      parentEventId: event.eventId });
  }
  return commands;
}

function lowestRatio(units: readonly UnitState[]): UnitState | undefined {
  return units.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0];
}

function sisterSource(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
