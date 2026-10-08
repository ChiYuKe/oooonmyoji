import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const inuGodIds = {
  hero: 220,
  basic: '2201',
  guardSkill: '2202',
  ultimate: '2203',
  vengeance: '2204',
  counter: '22020',
  guardian: 'status.hero.220.guardian-mark',
  bond: 'status.hero.220.bond',
  focus: 'status.hero.220.focus',
  vengeanceState: 'status.hero.220.vengeance',
  vengeanceActive: 'status.hero.220.vengeance-active',
  attackBonus: 'status.hero.220.counter-attack-bonus',
  vengeanceAttack: 'status.hero.220.vengeance-attack',
  allyShield: 'status.hero.220.ally-shield',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const counterRatios = [1.1, 1.15, 1.2, 1.25, 1.35] as const;
const ultimateRatios = [.92, .96, 1, 1.04, 1.08] as const;

export function registerInuGod(registry: ContentRegistry): void {
  for (const [id, options] of [
    [inuGodIds.guardian, { category: 'buff' as const, dispellable: false, sealable: false,
      durationOwner: 'permanent' as const, refreshPolicy: 'keep' as const }],
    [inuGodIds.bond, { category: 'buff' as const, dispellable: true, sealable: true,
      durationOwner: 'target-turn' as const, refreshPolicy: 'refresh-duration' as const }],
    [inuGodIds.focus, { category: 'debuff' as const, dispellable: true, sealable: true,
      durationOwner: 'target-turn' as const, refreshPolicy: 'refresh-duration' as const }],
    [inuGodIds.vengeanceState, { category: 'buff' as const, dispellable: false, sealable: false,
      durationOwner: 'target-turn' as const, refreshPolicy: 'replace' as const }],
    [inuGodIds.vengeanceActive, { category: 'buff' as const, dispellable: false, sealable: false,
      durationOwner: 'target-turn' as const, refreshPolicy: 'replace' as const }],
    [inuGodIds.attackBonus, { category: 'buff' as const, dispellable: false, sealable: false,
      durationOwner: 'target-turn' as const, refreshPolicy: 'replace' as const }],
    [inuGodIds.vengeanceAttack, { category: 'buff' as const, dispellable: true, sealable: true,
      durationOwner: 'target-turn' as const, refreshPolicy: 'replace' as const }],
    [inuGodIds.allyShield, { category: 'shield' as const, dispellable: true, sealable: true,
      durationOwner: 'target-turn' as const, refreshPolicy: 'replace' as const }],
  ] as const) registry.registerStatus({ id, mechanicsCoverage: 'partial', ...options });
  registry.registerHero(createInuGodDefinition());
}

export function createInuGodDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(inuGodIds.basic, basicRatios);
  const guard: SkillDefinition = {
    id: inuGodIds.guardSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'single', targetRelation: 'ally', levels: counterRatios.map(counterRatio => ({ counterRatio })),
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      return [statusCommand(inuGodIds.bond, dogSource(inuGodIds.guardSkill, owner.unitId), target.unitId,
        `bond:${owner.unitId}:${target.unitId}`, { kind: 'count', remaining: 1, owner: 'target-turn' }, { values: { ownerUnitId: owner.unitId } })];
    },
  };
  const counter: SkillDefinition = {
    id: inuGodIds.counter, actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: counterRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const hit = context.calculateDamage({ attack: stats.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner),
        ratio: Number(parameters.ratio ?? 1.1), critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
      const source = dogSource(inuGodIds.counter, owner.unitId);
      const inVengeance = owner.statuses.some(status => status.statusId === inuGodIds.vengeanceActive);
      return [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
        ...(inVengeance ? { leechRate: .15 } : {}) }];
    },
  };
  const ultimate: SkillDefinition = {
    id: inuGodIds.ultimate, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    resourceCost: { resourceId: 'fire', amount: 3 },
    resolveResourceCost(state, actor) {
      const enemies = state.sides[actor.side === 'blue' ? 'red' : 'blue'].map(id => state.units[id]).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      const reductions = (actor.statuses.some(status => status.statusId === inuGodIds.vengeanceActive) ? 2 : 0)
        + (enemies.filter(enemy => enemy.statuses.some(status => status.statusId === inuGodIds.focus
          && status.values?.ownerUnitId === actor.unitId)).length >= 2 ? 2 : 0);
      return { resourceId: 'fire', amount: Math.max(0, 3 - reductions) };
    },
    levels: ultimateRatios.map(ratio => ({ ratio, hits: 5, repeatMultiplier: .5 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner) return [];
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      if (!targets.length) return [];
      const empowered = owner.statuses.find(status => status.statusId === inuGodIds.vengeanceActive);
      const hits = Math.max(1, Number(parameters.hits ?? 5) + Number(empowered?.values?.extraHits ?? 0));
      const noDecay = Boolean(empowered);
      const counts = new Map<string, number>();
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const commands: EffectCommand[] = [];
      for (let index = 0; index < hits; index++) {
        const unhit = targets.filter(target => !counts.has(target.unitId));
        const pool = unhit.length ? unhit : targets;
        const target = pool[Math.min(pool.length - 1, Math.floor(context.random() * pool.length))]!;
        const count = counts.get(target.unitId) ?? 0;
        counts.set(target.unitId, count + 1);
        const multiplier = noDecay ? 1 : Math.pow(Number(parameters.repeatMultiplier ?? .5), count);
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const hit = context.calculateDamage({ attack: stats.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner),
          ratio: Number(parameters.ratio ?? .92) * multiplier, critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
        commands.push({ type: 'deal-damage', source: dogSource(inuGodIds.ultimate, owner.unitId), targetId: target.unitId,
          amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical });
      }
      return commands;
    },
  };
  const vengeance: SkillDefinition = {
    id: inuGodIds.vengeance, actionKind: 'skill', target: 'self', targetRelation: 'ally', levels: [{ attackBonus: 2.1 }],
    canUse(_state, actor) { return actor.statuses.some(status => status.statusId === inuGodIds.vengeanceState); },
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner) return [];
      const ready = owner.statuses.find(status => status.statusId === inuGodIds.vengeanceState);
      const commands: EffectCommand[] = [];
      if (ready) commands.push({ type: 'remove-status-instances', source: ready.source, targetId: owner.unitId,
        instanceIds: [ready.instanceId], reason: 'consumed' });
      commands.push(statusCommand(inuGodIds.vengeanceActive, dogSource(inuGodIds.vengeance, owner.unitId), owner.unitId,
        `vengeance-active:${owner.unitId}`, { kind: 'count', remaining: 1, owner: 'target-turn' }, { values: { extraHits: Number(ready?.values?.extraHits ?? 0) } }));
      commands.push(statusCommand(inuGodIds.vengeanceAttack, dogSource(inuGodIds.vengeance, owner.unitId), owner.unitId,
        `vengeance-attack:${owner.unitId}`, { kind: 'count', remaining: 1, owner: 'target-turn' },
        { modifiers: [{ stat: 'attack', operation: 'percent', amount: 2.1 }] }));
      for (const ally of context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon'))
        commands.push(statusCommand(inuGodIds.guardian, dogSource(inuGodIds.vengeance, owner.unitId), ally.unitId,
          `guardian:${owner.unitId}:${ally.unitId}`, { kind: 'permanent' }, { values: { ownerUnitId: owner.unitId } }));
      return commands;
    },
  };

  return {
    id: inuGodIds.hero, skills: [basic, guard, ultimate, counter, vengeance],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['依据客户端技能表实现心斩倍率、守护标记分配/主动挚友、受护友方被单体攻击时反击、反击后攻击成长与紧盯、心剑乱舞五段优先未命中目标及重复目标递减，挚友阵亡进入挚友之怒并获得护盾/推条/强化攻击。守护标记驱散属性、反击和薙魂等伤害链顺序、挚友触发条件、复仇态死亡追击计数及完整客户端队列仍需录像核验'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      return owner ? applyGuardianMarks(context, owner) : [];
    },
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (owner.statuses.some(status => status.statusId === inuGodIds.vengeanceState))
        return dogIntent(owner.unitId, inuGodIds.vengeance, [owner.unitId], 'self', 'ally');
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      const activeVengeance = owner.statuses.some(status => status.statusId === inuGodIds.vengeanceActive);
      const ultimateCost = ultimate.resolveResourceCost?.(context.state, owner)?.amount ?? 3;
      if (activeVengeance && fire >= ultimateCost)
        return dogIntent(owner.unitId, inuGodIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      if (!activeVengeance && fire >= 1 && !context.getLivingUnits(owner.side).some(ally => ally.statuses.some(status =>
        status.statusId === inuGodIds.bond && status.values?.ownerUnitId === owner.unitId)))
        return dogIntent(owner.unitId, inuGodIds.guardSkill, [lowestHealthAlly(context, owner)?.unitId ?? owner.unitId], 'single', 'ally');
      if (fire >= ultimateCost)
        return dogIntent(owner.unitId, inuGodIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      return dogIntent(owner.unitId, inuGodIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
    handlers: {
      'turn-end': { priority: 30, handle(context, event) {
        if (event.type !== 'turn-ended' || event.scheduling === 'extra-turn') return;
        const owner = context.getUnit(event.unitId);
        return owner?.heroId === inuGodIds.hero ? applyGuardianMarks(context, owner) : undefined;
      } },
      'attack-end': { priority: 30, handle(context, event) { return onAttackEnd(context, event); } },
      'unit-defeated': { priority: 30, handle(context, event) { return onUnitDefeated(context, event); } },
      'action-end': { priority: 30, handle(context, event) {
        if (event.type !== 'action-ended' || event.skillId !== inuGodIds.ultimate || !event.source.unitId) return;
        const owner = context.getUnit(event.source.unitId);
        const empowerment = owner?.statuses.find(status => status.statusId === inuGodIds.vengeanceActive);
        return owner && empowerment ? [{ type: 'remove-status-instances', source: empowerment.source, targetId: owner.unitId,
          instanceIds: [empowerment.instanceId], reason: 'consumed' }] : undefined;
      } },
    },
  };
}

function applyGuardianMarks(context: BattleContext, owner: Readonly<UnitState>): EffectCommand[] {
  if (!passivesEnabled(owner)) return [];
  const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon');
  const count = Math.floor(allies.length / 2);
  const selected = [...allies].sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))
    .slice(0, count);
  const selectedIds = new Set(selected.map(unit => unit.unitId));
  const commands: EffectCommand[] = [];
  for (const ally of allies) {
    const existing = ally.statuses.filter(status => status.statusId === inuGodIds.guardian
      && status.values?.ownerUnitId === owner.unitId);
    if (selectedIds.has(ally.unitId) && existing.length === 0)
      commands.push(statusCommand(inuGodIds.guardian, dogSource(inuGodIds.guardSkill, owner.unitId), ally.unitId,
        `guardian:${owner.unitId}:${ally.unitId}`, { kind: 'permanent' }, { values: { ownerUnitId: owner.unitId } }));
    if (!selectedIds.has(ally.unitId)) for (const status of existing) commands.push({ type: 'remove-status-instances',
      source: dogSource(inuGodIds.guardSkill, owner.unitId), targetId: ally.unitId, instanceIds: [status.instanceId], reason: 'consumed' });
  }
  return commands;
}

function onAttackEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || !event.targetHealthChanges?.length) return;
  if (event.source.id === inuGodIds.counter) {
    const owner = context.getUnit(event.source.unitId);
    const target = event.targetHealthChanges.map(change => context.getUnit(change.targetId)).find(Boolean);
    if (!owner || !target || owner.heroId !== inuGodIds.hero) return;
    const previous = owner.statuses.find(status => status.statusId === inuGodIds.attackBonus);
    const previousBonus = Number(previous?.values?.totalAttackAdded ?? 0);
    const baseAttack = Math.max(0, owner.stats.attack);
    const total = Math.min(baseAttack * 2.1, previousBonus + (context.getEffectiveStats(target.unitId)?.attack ?? target.stats.attack) * .3);
    const commands: EffectCommand[] = [statusCommand(inuGodIds.attackBonus, dogSource(inuGodIds.guardSkill, owner.unitId), owner.unitId,
      `attack-bonus:${owner.unitId}`, { kind: 'count', remaining: 1, owner: 'target-turn' },
      { values: { totalAttackAdded: total }, modifiers: [{ stat: 'attack', operation: 'flat', amount: total }] })];
    if (target.hp > 0) commands.push(statusCommand(inuGodIds.focus, dogSource(inuGodIds.guardSkill, owner.unitId), target.unitId,
      `focus:${owner.unitId}:${target.unitId}`, { kind: 'count', remaining: 1, owner: 'target-turn' },
      { values: { ownerUnitId: owner.unitId }, modifiers: [{ stat: 'attack', operation: 'percent', amount: -.35 }] }));
    return commands;
  }
  if (event.shape !== 'single' || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.hp <= 0) return;
  const owners = context.getLivingUnits(attacker.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === inuGodIds.hero && passivesEnabled(unit) && !context.isUnitUnableToAct(unit.unitId)
      && event.targetHealthChanges!.some(change => context.getUnit(change.targetId)?.statuses.some(status =>
        status.statusId === inuGodIds.guardian && status.values?.ownerUnitId === unit.unitId)));
  if (!owners.length) return;
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    const counterSource = dogSource(inuGodIds.guardSkill, owner.unitId);
    commands.push({ type: 'schedule-action', source: counterSource, scheduling: 'counter',
      intent: dogIntent(owner.unitId, inuGodIds.counter, [attacker.unitId], 'single', 'enemy'), parentEventId: event.eventId });
  }
  return commands;
}

function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated || defeated.unitKind === 'summon') return;
  const bond = defeated.statuses.find(status => status.statusId === inuGodIds.bond);
  const ownerId = String(bond?.values?.ownerUnitId ?? '');
  const owner = ownerId ? context.getUnit(ownerId) : undefined;
  const commands: EffectCommand[] = [];
  if (owner && owner.hp > 0 && owner.heroId === inuGodIds.hero && passivesEnabled(owner)) {
    const source = dogSource(inuGodIds.guardSkill, owner.unitId);
    commands.push({ type: 'change-action-gauge', source, targetId: owner.unitId, amount: 30, parentEventId: event.eventId });
    const controls = owner.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
    if (controls.length) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
      instanceIds: controls.map(status => status.instanceId), reason: 'consumed', parentEventId: event.eventId });
    commands.push(statusCommand(inuGodIds.vengeanceState, source, owner.unitId, `vengeance:${owner.unitId}:${event.eventId}`,
      { kind: 'count', remaining: 1, owner: 'target-turn' }, { values: { extraHits: 0 } }));
    for (const ally of context.getLivingUnits(owner.side)) {
      const amount = (context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack) * (ally.unitId === owner.unitId ? 1 : .3);
      commands.push(statusCommand(inuGodIds.allyShield, source, ally.unitId, `dog-shield:${owner.unitId}:${ally.unitId}:${event.eventId}`,
        { kind: 'count', remaining: 1, owner: 'target-turn' }, { values: { shieldRemaining: amount } }));
    }
  }
  for (const allyId of context.state.sides[defeated.side]) {
    const unit = context.getUnit(allyId);
    const empowerment = unit?.statuses.find(status => status.statusId === inuGodIds.vengeanceActive);
    if (!unit || unit.heroId !== inuGodIds.hero || unit.hp <= 0 || !empowerment || !passivesEnabled(unit)) continue;
    commands.push(statusCommand(inuGodIds.vengeanceActive, empowerment.source, unit.unitId, empowerment.instanceId,
      empowerment.duration, { values: { ...empowerment.values, extraHits: Number(empowerment.values?.extraHits ?? 0) + 1 } }));
  }
  return commands.length ? commands : undefined;
}

function statusCommand(statusId: string, source: SourceRef, targetId: string, instanceId: string,
  duration: StatusInstance['duration'], extras: Pick<StatusInstance, 'values' | 'modifiers'> = {}): EffectCommand {
  return { type: 'add-status', source, targetId, instance: { instanceId, statusId, source, stacks: 1, duration,
    ...('values' in extras && extras.values ? { values: extras.values } : {}),
    ...('modifiers' in extras && extras.modifiers ? { modifiers: extras.modifiers } : {}) } };
}

function lowestHealthAlly(context: BattleContext, owner: Readonly<UnitState>): UnitState | undefined {
  return context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon')
    .slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
}
function dogIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent { return { actorId, skillId, targetIds, shape, targetRelation }; }
function dogSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
