import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const nezukoIds = {
  hero: 360, basic: '3601', bloodBurst: '3602', demonForm: '3603', combo: '3604',
  demonState: 'status.hero.360.demon', sleep: 'status.hero.360.sleep', bloodBurstCrit: 'status.hero.360.blood-burst-crit',
  demonHit: 'status.hero.360.demon-hit',
} as const;

export function registerNezuko(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: nezukoIds.demonState, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: nezukoIds.sleep, mechanicsCoverage: 'partial', category: 'control', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true },
    { id: nezukoIds.bloodBurstCrit, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: nezukoIds.demonHit, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  for (const status of statuses) registry.registerStatus(status);
  registry.registerHero(createNezukoDefinition());
}

export function createNezukoDefinition(): HeroDefinition {
  const combo: SkillDefinition = {
    id: nezukoIds.combo, actionKind: 'passive', target: 'single', targetRelation: 'enemy', levels: basicLevels,
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      return [0, 1].map(() => attack(context, owner, target, nezukoSource(nezukoIds.combo, owner.unitId),
        Number(parameters.ratio ?? .8)));
    },
  };
  const basic: SkillDefinition = {
    id: nezukoIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: basicLevels,
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      const demon = hasStatus(owner, nezukoIds.demonState);
      if (demon) return combo.execute(context, intent, parameters);
      return [attack(context, owner, target, nezukoSource(nezukoIds.basic, owner.unitId), Number(parameters.ratio ?? .8))];
    },
  };

  const bloodBurst: SkillDefinition = {
    id: nezukoIds.bloodBurst, actionKind: 'skill', target: 'single', targetRelation: 'ally',
    resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: skillRank(actor, nezukoIds.bloodBurst) >= 5 ? 0 : 1 }; },
    levels: bloodBurstLevels,
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      const rank = skillRank(owner, nezukoIds.bloodBurst);
      const source = nezukoSource(nezukoIds.bloodBurst, owner.unitId);
      const commands: EffectCommand[] = [{ type: 'lose-life', source, targetId: owner.unitId,
        amount: owner.hp * Number(parameters.lifeCostRatio ?? (rank >= 2 ? .1 : .2)) }];
      commands.push({ type: 'change-action-gauge', source, targetId: target.unitId, amount: 50 });
      if (rank >= 3) {
        const control = target.statuses.find(status => context.getStatusCategory(status.statusId) === 'control');
        if (control) commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
          instanceIds: [control.instanceId], reason: 'consumed' });
      }
      if (rank >= 4) commands.push(addStatus(target, nezukoIds.bloodBurstCrit, source,
        { kind: 'count', remaining: 1, owner: 'target-turn' },
        [{ stat: 'critDamage', operation: 'flat', amount: .5 }]));
      if (target.heroId === 359) commands.push({ type: 'schedule-turn', source, unitId: target.unitId,
        scheduling: 'extra-turn', selection: 'action-gauge' });
      return commands;
    },
  };

  const demonForm: SkillDefinition = {
    id: nezukoIds.demonForm, actionKind: 'skill', target: 'single', targetRelation: 'ally', resourceCost: { resourceId: 'fire', amount: 3 },
    canUse: (_state, actor) => !hasStatus(actor, nezukoIds.demonState),
    levels: demonLevels,
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || hasStatus(owner, nezukoIds.demonState)) return [];
      const rank = skillRank(owner, nezukoIds.demonForm), source = nezukoSource(nezukoIds.demonForm, owner.unitId);
      const modifiers = [
        { stat: 'critDamage' as const, operation: 'flat' as const, amount: 1 },
        ...(rank >= 3 ? [{ stat: 'critResist' as const, operation: 'flat' as const, amount: 1 }] : []),
      ];
      return [addStatus(owner, nezukoIds.demonState, source, { kind: 'permanent' }, modifiers,
        { turnsLeft: 2, rank }), { type: 'remove-statuses', source, targetId: owner.unitId,
          statusIds: [nezukoIds.sleep], reason: 'consumed' }];
    },
  };

  return {
    id: nezukoIds.hero,
    skills: [basic, bloodBurst, demonForm, combo],
    mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3601/3602/3603/3604技能行接入普通/鬼化普攻及额外护盾伤害、血鬼术爆血的生命代价/推条/控制清除/爆伤/炭治郎额外回合、鬼化两回合强化、敌方回合末追加拳打腿踢、睡眠及满级回合回血、鬼化期间受击目标退条。鬼化自动追击的御魂/被动屏蔽，实际技能触发帧、行动条目标选择和睡眠持续窗口仍需录像核验。'],
    handlers: {
      'turn-start': { priority: 92, handle(context, event) { return onTurnStart(context, event); } },
      'turn-end': { priority: 92, handle(context, event) { return onTurnEnd(context, event); } },
      'effect-resolution': { priority: 92, handle(context, event) { return onDamage(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon' || hasStatus(owner, nezukoIds.sleep)) return undefined;
      if (hasStatus(owner, nezukoIds.demonState)) {
        const enemy = livingEnemies(context, owner).sort((a, b) => b.hp / Math.max(1, b.stats.hp) - a.hp / Math.max(1, a.stats.hp))[0];
        return enemy ? intent(owner.unitId, nezukoIds.basic, [enemy.unitId], 'enemy') : undefined;
      }
      const allies = context.getLivingUnits(owner.side).filter(ally => ally.unitKind !== 'summon');
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      if (fire >= 3 && !hasStatus(owner, nezukoIds.demonState) && owner.hp / Math.max(1, owner.stats.hp) > .25)
        return intent(owner.unitId, nezukoIds.demonForm, [owner.unitId], 'ally');
      const tanjiro = allies.find(ally => ally.heroId === 359 && ally.hp > 0
        && ally.statuses.some(status => context.getStatusCategory(status.statusId) === 'control'));
      if (tanjiro && (fire >= (skillRank(owner, nezukoIds.bloodBurst) >= 5 ? 0 : 1)))
        return intent(owner.unitId, nezukoIds.bloodBurst, [tanjiro.unitId], 'ally');
      const enemy = livingEnemies(context, owner).sort((a, b) => b.actionGauge - a.actionGauge)[0];
      return enemy ? intent(owner.unitId, nezukoIds.basic, [enemy.unitId], 'enemy') : undefined;
    },
  };
}

function onTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== nezukoIds.hero || owner.hp <= 0) return;
  const sleep = owner.statuses.find(status => status.statusId === nezukoIds.sleep);
  if (!sleep || skillRank(owner, nezukoIds.basic) < 5) return;
  return [{ type: 'remove-status-instances', source: nezukoSource(nezukoIds.basic, owner.unitId), targetId: owner.unitId,
    instanceIds: [sleep.instanceId], reason: 'consumed', parentEventId: event.eventId }];
}

function onTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  const nezukos = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === nezukoIds.hero && unit.hp > 0);
  for (const owner of nezukos) {
    const source = nezukoSource(nezukoIds.demonForm, owner.unitId);
    if (hasStatus(owner, nezukoIds.sleep) && skillRank(owner, nezukoIds.basic) >= 5)
      commands.push({ type: 'heal', source: nezukoSource(nezukoIds.basic, owner.unitId), targetId: owner.unitId,
        amount: owner.stats.hp * .1, parentEventId: event.eventId });
    if (owner.unitId === actor.unitId) {
      const form = owner.statuses.find(status => status.statusId === nezukoIds.demonState);
      if (form) {
        const turnsLeft = Number(form.values?.turnsLeft ?? 2) - 1;
        if (turnsLeft <= 0) {
          commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
            instanceIds: [form.instanceId], reason: 'expired', parentEventId: event.eventId });
          commands.push(addStatus(owner, nezukoIds.sleep, source,
            { kind: 'count', remaining: 1, owner: 'target-turn' }, [], { controlType: '沉睡' }, event.eventId));
          for (const enemy of allEnemies(context, owner)) {
            const mark = enemy.statuses.find(status => status.statusId === nezukoIds.demonHit && status.source.unitId === owner.unitId);
            if (mark && skillRank(owner, nezukoIds.demonForm) >= 5 && enemy.hp > 0)
              commands.push({ type: 'change-action-gauge', source, targetId: enemy.unitId, amount: -40, parentEventId: event.eventId });
            if (mark) commands.push({ type: 'remove-status-instances', source, targetId: enemy.unitId,
              instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId });
          }
        } else commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
          instance: { ...form, values: { ...form.values, turnsLeft } } });
      }
    }
    const form = owner.statuses.find(status => status.statusId === nezukoIds.demonState);
    if (form && actor.side !== owner.side && passivesEnabled(owner)) {
      const controls = owner.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
      if (controls.length && skillRank(owner, nezukoIds.demonForm) >= 4) {
        const control = controls[0]!;
        commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
          instanceIds: [control.instanceId], reason: 'consumed', parentEventId: event.eventId });
      } else if (!controls.length) {
        const target = livingEnemies(context, owner).filter(enemy => enemy.unitId !== actor.unitId)
          .sort((left, right) => right.actionGauge - left.actionGauge)[0];
        if (target) commands.push(scheduleCombo(context, owner, target, event.eventId));
      }
    }
  }
  return commands.length ? commands : undefined;
}

function onDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== nezukoIds.combo || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== nezukoIds.hero || !hasStatus(owner, nezukoIds.demonState) || !target) return;
  const source = nezukoSource(nezukoIds.demonForm, owner.unitId);
  const commands: EffectCommand[] = [addStatus(target, nezukoIds.demonHit, source, { kind: 'permanent' }, [],
    { ownerUnitId: owner.unitId }, event.eventId)];
  if (event.actionKind === 'passive' && event.hitIndex === 2 && target.hp > 0)
    commands.push({ type: 'change-action-gauge', source: nezukoSource(nezukoIds.combo, owner.unitId),
      targetId: target.unitId, amount: -20, parentEventId: event.eventId });
  return commands;
}

function scheduleCombo(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, parentEventId: string): EffectCommand {
  const source = nezukoSource(nezukoIds.combo, owner.unitId);
  return { type: 'schedule-attack', source, parentEventId, scheduling: 'counter',
    intent: { actorId: owner.unitId, skillId: nezukoIds.combo, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy', kind: 'passive' },
    suppressSourcePassiveTriggers: true, suppressTargetPassiveTriggers: true, suppressTargetSoulTriggers: true,
    hits: [0, 1].map(() => {
      const attacker = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defender = context.getEffectiveStats(target.unitId) ?? target.stats;
      const ratio = basicRatios[skillRank(owner, nezukoIds.basic) - 1]!;
      const hit = context.calculateDamage({ attack: attacker.attack, defense: defender.defense,
        defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: attacker.crit, critDamage: attacker.critDamage,
        shieldDmgAddRate: 1 }, owner, target);
      return { targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        isCritical: hit.isCritical };
    }) };
}

function attack(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef, ratio: number): EffectCommand {
  const attacker = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defender = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: attacker.attack, defense: defender.defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: attacker.crit, critDamage: attacker.critDamage,
    shieldDmgAddRate: 1 }, owner as UnitState, target as UnitState);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    shieldDmgAddRate: 1, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attacker.critDamage) } : {}), isCritical: result.isCritical };
}

function addStatus(target: Readonly<UnitState>, statusId: string, source: SourceRef,
  duration: StatusInstance['duration'], modifiers: NonNullable<StatusInstance['modifiers']> = [],
  values?: StatusInstance['values'], parentEventId?: string): EffectCommand {
  return { type: 'add-status', source, targetId: target.unitId, ...(parentEventId ? { parentEventId } : {}),
    instance: { instanceId: `${statusId}:${source.unitId}:${target.unitId}`, statusId, source, stacks: 1,
      duration, ...(modifiers.length ? { modifiers } : {}), ...(values ? { values } : {}) } };
}

function livingEnemies(context: BattleContext, owner: Readonly<UnitState>): UnitState[] {
  return [...context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')] as UnitState[];
}
function allEnemies(context: BattleContext, owner: Readonly<UnitState>): UnitState[] {
  const enemySide = owner.side === 'blue' ? 'red' : 'blue';
  return context.state.sides[enemySide].map(unitId => context.state.units[unitId]).filter((unit): unit is UnitState => Boolean(unit));
}
function hasStatus(owner: Readonly<UnitState>, statusId: string): boolean { return owner.statuses.some(status => status.statusId === statusId); }
function skillRank(owner: Readonly<UnitState>, skillId: string): number {
  const rank = owner.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(5, Math.floor(rank!))) : Math.max(1, Math.min(5, owner.skillLevel));
}
function nezukoSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function intent(actorId: string, skillId: string, targetIds: string[], targetRelation: 'enemy' | 'ally') {
  return { actorId, skillId, targetIds, shape: 'single' as const, targetRelation };
}

const basicRatios = [.8, .85, .9, .95, 1] as const;
const basicLevels = basicRatios.map(ratio => ({ ratio }));
const bloodBurstLevels = [{ lifeCostRatio: .2, cost: 1 }, { lifeCostRatio: .1, cost: 1 },
  { lifeCostRatio: .1, cost: 1 }, { lifeCostRatio: .1, cost: 1 }, { lifeCostRatio: .1, cost: 0 }] as const;
const demonLevels = [{}, { critDamage: 1 }, { critDamage: 1, critResist: 1 }, { critDamage: 1, critResist: 1 },
  { critDamage: 1, critResist: 1 }] as const;
