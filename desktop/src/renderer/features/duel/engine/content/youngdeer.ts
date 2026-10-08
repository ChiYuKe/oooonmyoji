import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const youngDeerIds = {
  hero: 259,
  basic: '2591',
  passive: '2592',
  ultimate: '2593',
  resistDown: 'status.hero.259.resist-down',
  spirit: 'status.hero.259.forest-spirit',
  consumedThisTurn: 'status.hero.259.spirit-consumed-this-turn',
  stun: 'status.hero.259.antler-stun',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const resistDownChances = [.5, .6, .7, .8, 1] as const;
const controlReflectChances = [.1, .12, .14, .16, .2] as const;
const ultimateRatios = [1.58, 1.66, 1.74, 1.82, 1.91] as const;

export function registerYoungDeer(registry: ContentRegistry): void {
  registry.registerStatus({ id: youngDeerIds.resistDown, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: youngDeerIds.spirit, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3 });
  registry.registerStatus({ id: youngDeerIds.consumedThisTurn, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: youngDeerIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerHero(createYoungDeerDefinition());
}

export function createYoungDeerDefinition(): HeroDefinition {
  return {
    id: youngDeerIds.hero,
    skills: [createBasic(), createUltimate()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能数据接入普攻降抵抗、森之力叠层/控制反弹/敌方耗火推条，以及鹿角冲撞的3火推条、末端眩晕、层数消耗和高等级额外目标；反弹能否再抵抗、免疫行动条边界与多目标帧序仍需录像核验'],
    handlers: {
      'turn-end': { priority: 91, handle(context, event) { return gainForestSpiritAtTurnEnd(context, event); } },
      'resource-payment': { priority: 92, handle(context, event) { return gaugeOnEnemyFireSkill(context, event); } },
      'control-application': { priority: 93, handle(context, event) {
        return consumeSpiritOnStun(context, event) ?? reflectControl(context, event);
      } },
      'effect-resolution': { priority: 94, handle(context, event) { return stunWhenPushedToEnd(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const skillId = (context.state.resources[owner.side]?.fire ?? 0) >= 3
        ? youngDeerIds.ultimate : youngDeerIds.basic;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function createBasic(): SkillDefinition {
  return { id: youngDeerIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, resistDownChance: resistDownChances[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0);
      const actorStats = actor && context.getEffectiveStats(actor.unitId), targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !target || !actorStats || !targetStats) return [];
      const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const source = deerSource(youngDeerIds.basic, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId,
        amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
      const debuff = attemptDebuff(context, { source, targetId: target.unitId, statusId: youngDeerIds.resistDown,
        baseChance: Number(parameters.resistDownChance ?? .5), duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        modifiers: [{ stat: 'resist', operation: 'flat', amount: -.2 }] });
      commands.push(...debuff);
      return commands;
    } };
}

function createUltimate(): SkillDefinition {
  return { id: youngDeerIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy',
    levels: ultimateRatios.map((ratio, index) => ({ ratio, pushback: .4, stunChance: 1,
      extraTargets: index >= 4 ? 2 : index >= 2 ? 1 : 0, perExtraSpirit: index >= 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), actorStats = context.getEffectiveStats(intent.actorId);
      if (!actor || !actorStats) return [];
      const spirit = actor.statuses.find(status => status.statusId === youngDeerIds.spirit);
      const stacks = spirit?.stacks ?? 0;
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side !== actor.side));
      const selected: UnitState[] = targets.slice(0, 1);
      const extras = stacks > 1 ? (Boolean(parameters.perExtraSpirit) ? stacks - 1 : Math.min(1, Number(parameters.extraTargets ?? 0))) : 0;
      for (let index = 0; index < extras; index++) {
        const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        if (!enemies.length) break;
        selected.push(enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!);
      }
      const hits = new Map<string, number>();
      const commands: EffectCommand[] = [];
      for (const target of selected) {
        const currentTarget = context.getUnit(target.unitId);
        const targetStats = currentTarget && context.getEffectiveStats(currentTarget.unitId);
        if (!currentTarget || !targetStats || currentTarget.hp <= 0) continue;
        const repeat = hits.get(target.unitId) ?? 0;
        hits.set(target.unitId, repeat + 1);
        const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1.58) * (repeat > 0 ? .6 : 1),
          critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, currentTarget);
        const source = deerSource(youngDeerIds.ultimate, actor.unitId);
        commands.push({ type: 'deal-damage', source, targetId: currentTarget.unitId, amount: damage.amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical });
        if (stacks > 0) commands.push({ type: 'change-action-gauge', source, targetId: currentTarget.unitId,
          amount: -100 * Number(parameters.pushback ?? .4) });
      }
      return commands;
    } };
}

function gainForestSpiritAtTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== youngDeerIds.hero || owner.hp <= 0) return;
  const spent = owner.statuses.find(status => status.statusId === youngDeerIds.consumedThisTurn);
  const commands: EffectCommand[] = [];
  if (spent) commands.push({ type: 'remove-statuses', source: spent.source, targetId: owner.unitId,
    statusIds: [youngDeerIds.consumedThisTurn], reason: 'consumed', parentEventId: event.eventId });
  if (!passivesEnabled(owner)) return commands;
  const spirit = owner.statuses.find(status => status.statusId === youngDeerIds.spirit);
  if (spent || (spirit?.stacks ?? 0) >= 3) return commands;
  const source = deerSource(youngDeerIds.passive, owner.unitId);
  commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${youngDeerIds.spirit}:${owner.unitId}`, statusId: youngDeerIds.spirit, source,
      stacks: 1, duration: { kind: 'permanent' } } });
  return commands;
}

function gaugeOnEnemyFireSkill(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after >= event.before
    || event.source.kind !== 'skill') return;
  const sourceUnit = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (!sourceUnit || sourceUnit.side !== event.side) return;
  const defendingSide = event.side === 'blue' ? 'red' : 'blue';
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(defendingSide)) {
    if (owner.heroId !== youngDeerIds.hero || !passivesEnabled(owner)) continue;
    commands.push({ type: 'change-action-gauge', source: deerSource(youngDeerIds.passive, owner.unitId),
      targetId: owner.unitId, amount: 20, parentEventId: event.eventId });
  }
  return commands;
}

function reflectControl(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied' || !event.source.unitId) return;
  const owner = context.getUnit(event.targetId), attacker = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== youngDeerIds.hero || owner.hp <= 0 || !passivesEnabled(owner)
    || !attacker || attacker.side === owner.side) return;
  const instance = owner.statuses.find(status => status.statusId === event.statusId && status.values?.controlType !== undefined);
  if (!instance || context.random() >= controlReflectChances[skillRank(owner, youngDeerIds.passive) - 1]!) return;
  const enemies = context.getLivingUnits(attacker.side);
  if (!enemies.length) return;
  const target = enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!;
  const source = deerSource(youngDeerIds.passive, owner.unitId);
  return [{ type: 'apply-control', source, targetId: target.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${youngDeerIds.passive}:reflect:${event.eventId}`, statusId: event.statusId, source,
      stacks: 1, duration: instance.duration, values: instance.values } }];
}

function stunWhenPushedToEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-gauge-changed' || event.source.id !== youngDeerIds.ultimate || event.blockedByImmunity
    || event.after > 0 || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== youngDeerIds.hero
    || !(owner.statuses.find(status => status.statusId === youngDeerIds.spirit)?.stacks ?? 0)
    || !target || target.hp <= 0) return;
  const control = attemptControl(context, { attemptId: `${youngDeerIds.stun}:${event.eventId}`, source: event.source,
    targetId: target.unitId, statusId: youngDeerIds.stun, controlType: '眩晕', baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  return control ? [control] : undefined;
}

function consumeSpiritOnStun(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied' || event.statusId !== youngDeerIds.stun || event.source.id !== youngDeerIds.ultimate
    || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  const spirit = owner?.statuses.find(status => status.statusId === youngDeerIds.spirit);
  if (!owner || owner.heroId !== youngDeerIds.hero || !spirit) return;
  const source = deerSource(youngDeerIds.passive, owner.unitId);
  const remaining = Math.max(0, spirit.stacks - 1);
  const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [youngDeerIds.spirit], reason: 'consumed', parentEventId: event.eventId }];
  if (remaining > 0) commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: { ...spirit, instanceId: `${youngDeerIds.spirit}:${owner.unitId}`, source, stacks: remaining }, parentEventId: event.eventId });
  commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${youngDeerIds.consumedThisTurn}:${owner.unitId}`, statusId: youngDeerIds.consumedThisTurn,
      source, stacks: 1, duration: { kind: 'permanent' } } });
  return commands;
}

function skillRank(owner: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel));
}
function deerSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
