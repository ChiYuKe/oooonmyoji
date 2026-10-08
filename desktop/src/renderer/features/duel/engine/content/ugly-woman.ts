import type { DamageInterception, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { calculateDamage } from '../mechanics/damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

/** 丑时之女, whose scarecrow transfers damage to the unit it is tethered to. */
export const uglyWomanIds = {
  hero: 228,
  basic: '2281',
  cursePassive: '2282',
  scarecrowSkill: '2283',
  curseFire: 'status.hero.228.curse-fire',
  tether: 'status.hero.228.scarecrow-tether',
  scarecrow: 'status.hero.228.scarecrow',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const scarecrowHpRatios = [.1, .15, .2, .25, .3] as const;
const curseChances = [.2, .2, .3, .3, .4] as const;
const curseDamageTaken = [.05, .1, .1, .15, .15] as const;

export function registerUglyWoman(registry: ContentRegistry): void {
  registry.registerStatus({ id: uglyWomanIds.curseFire, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: uglyWomanIds.tether, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: uglyWomanIds.scarecrow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic = createBasicAttackSkill(uglyWomanIds.basic, basicRatios);
  const scarecrow: SkillDefinition = {
    id: uglyWomanIds.scarecrowSkill,
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single',
    targetRelation: 'enemy',
    levels: scarecrowHpRatios.map(hpRatio => ({ hpRatio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const targetId = intent.targetIds[0];
      const target = targetId ? context.getUnit(targetId) : undefined;
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!owner || owner.unitKind === 'summon' || !target || target.hp <= 0 || !targetStats) return [];
      const source = uglySource(uglyWomanIds.scarecrowSkill, owner.unitId);
      const levelIndex = Math.max(0, Math.min(4, owner.skillLevel - 1));
      const puppetId = `summon:${owner.unitId}:${target.unitId}:${context.state.counters.action}`;
      const tetherInstanceId = `${uglyWomanIds.tether}:${puppetId}`;
      const maxHp = Math.max(1, targetStats.hp * Number(parameters.hpRatio ?? .1));
      const puppet: UnitState = { unitId: puppetId, heroId: uglyWomanIds.hero, unitKind: 'summon', summonedByUnitId: owner.unitId,
        skillLevel: owner.skillLevel, side: owner.side,
        stats: { ...owner.stats, hp: maxHp, attack: 0, defense: targetStats.defense * .5, speed: 1 },
        hp: maxHp, shield: 0, actionGauge: 0, statuses: [{ instanceId: `${uglyWomanIds.scarecrow}:${puppetId}`,
          statusId: uglyWomanIds.scarecrow, source, stacks: 1, duration: { kind: 'permanent' },
          values: { tetherTargetId: target.unitId, tetherInstanceId } }], resources: {} };
      const previousPuppets = context.getLivingUnits(owner.side).filter(unit => unit.unitKind === 'summon'
        && unit.heroId === uglyWomanIds.hero && unit.summonedByUnitId === owner.unitId);
      return [
        ...previousPuppets.map(previous => ({ type: 'lose-life' as const, source, targetId: previous.unitId,
          amount: previous.hp, parentEventId: context.state.counters.action ? `action-${context.state.counters.action}` : undefined })),
        { type: 'add-status', source, targetId: target.unitId, instance: { instanceId: tetherInstanceId,
          statusId: uglyWomanIds.tether, source, stacks: 1,
          duration: { kind: 'count', remaining: 3, owner: 'target-turn' }, values: { puppetId } } },
        { type: 'summon-unit', source, unit: puppet },
      ];
    },
  };

  const definition: HeroDefinition = {
    id: uglyWomanIds.hero,
    skills: [basic, scarecrow],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const availableFire = context.state.resources[actor.side]?.fire ?? 0;
      const hasPuppet = context.getLivingUnits(actor.side).some(unit => unit.unitKind === 'summon'
        && unit.heroId === uglyWomanIds.hero && unit.summonedByUnitId === actor.unitId);
      const target = availableFire >= 2 && !hasPuppet
        ? enemies.slice().sort((left, right) => right.hp - left.hp)[0]!
        : enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId: availableFire >= 2 && !hasPuppet ? uglyWomanIds.scarecrowSkill : uglyWomanIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'action-end': { priority: 110, handle(context, event) { return applyCurseFire(context, event); } },
      'status-expiration': { priority: 110, handle(context, event) { return expireTether(context, event); } },
      'unit-defeated': { priority: 110, handle(context, event) { return removeTetherAfterPuppetDeath(context, event); } },
    },
    interceptIncomingDamage(state, _attacker, puppet, amount): DamageInterception | undefined {
      const marker = puppet.statuses.find(status => status.statusId === uglyWomanIds.scarecrow);
      const targetId = marker?.values?.tetherTargetId;
      const target = typeof targetId === 'string' ? state.units[targetId] : undefined;
      if (!marker || !target || target.hp <= 0 || !marker.source.unitId || amount <= 0) return undefined;
      return { amount, effects: [{ type: 'deal-damage', source: marker.source, targetId: target.unitId, amount,
        damageKind: 'true', precalculated: true, countsAsHit: false }] };
    },
  };
  registry.registerHero(definition);
}

function applyCurseFire(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== uglyWomanIds.hero || owner.unitKind === 'summon' || owner.hp <= 0
    || !passivesEnabled(owner)) return;
  const levelIndex = Math.max(0, Math.min(4, owner.skillLevel - 1));
  if (context.random() >= curseChances[levelIndex]!) return;
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
  if (enemies.length === 0) return;
  const target = enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!;
  const damageTaken = curseDamageTaken[levelIndex]!;
  const source = uglySource(uglyWomanIds.cursePassive, owner.unitId);
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: uglyWomanIds.curseFire, baseChance: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: event.eventId,
    values: { damageTaken } }).map(command => command.type === 'add-status' ? { ...command, instance: {
      ...command.instance, modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: damageTaken }],
    } } : command);
}

function expireTether(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== uglyWomanIds.tether) return;
  const puppetId = event.removedValues?.puppetId;
  const puppet = typeof puppetId === 'string' ? context.getUnit(puppetId) : undefined;
  if (!puppet || puppet.hp <= 0 || puppet.unitKind !== 'summon') return;
  return [{ type: 'lose-life', source: event.source, targetId: puppet.unitId, amount: puppet.hp, parentEventId: event.eventId }];
}

function removeTetherAfterPuppetDeath(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const puppet = context.getUnit(event.unitId);
  const marker = puppet?.statuses.find(status => status.statusId === uglyWomanIds.scarecrow);
  const targetId = marker?.values?.tetherTargetId;
  const tetherInstanceId = marker?.values?.tetherInstanceId;
  if (!puppet || !marker || puppet.heroId !== uglyWomanIds.hero || puppet.unitKind !== 'summon'
    || typeof targetId !== 'string' || typeof tetherInstanceId !== 'string') return;
  const source: SourceRef = marker.source;
  return [{ type: 'remove-status-instances', source, targetId, instanceIds: [tetherInstanceId], parentEventId: event.eventId }];
}

function uglySource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
