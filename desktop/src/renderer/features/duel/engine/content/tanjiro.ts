import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import { createLineupDamageSkill, lineupIntent } from './lineup-damage-skill';
import type { ContentRegistry } from './registry';

export const tanjiroIds = {
  hero: 359, basic: '3591', waterwheel: '3592', fifthForm: '3595', seventhForm: '3597',
  forms: '3593', tenthForm: '35910', hinokami: '35911', whirlpool: '3596', waterfall: '3598',
  concentration: 'status.hero.359.concentration', hinokamiUsed: 'status.hero.359.hinokami-used',
  concentrationCrit: 'status.hero.359.concentration-crit',
  tenthFormUsed: 'status.hero.359.tenth-form-used', controlExtraTurn: 'status.hero.359.control-extra-turn',
} as const;

export function registerTanjiro(registry: ContentRegistry): void {
  registry.registerStatus({ id: tanjiroIds.concentration, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack',
    stackScope: 'source-unit', maxStacks: 9 });
  registry.registerStatus({ id: tanjiroIds.hinokamiUsed, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: tanjiroIds.concentrationCrit, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: tanjiroIds.tenthFormUsed, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: tanjiroIds.controlExtraTurn, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerHero(createTanjiroDefinition());
}

export function createTanjiroDefinition(): HeroDefinition {
  const basicBase = createBasicAttackSkill(tanjiroIds.basic, [.9, 1, 1, 1, 1]);
  const basic: SkillDefinition = { ...basicBase, execute(context, intent, parameters) {
    const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
    if (!owner || !target) return [];
    const rank = skillRank(owner, tanjiroIds.basic);
    const hpRatio = target.hp / Math.max(1, target.stats.hp);
    if (rank >= 4 && hpRatio < .3) return basicDamage(context, owner, target, tanjiroIds.fifthForm, 1.4);
    if (rank >= 5 && hpRatio > .7) return basicDamage(context, owner, target, tanjiroIds.seventhForm, 1.4);
    return basicBase.execute(context, intent, parameters);
  } };
  const fifthBase = createBasicAttackSkill(tanjiroIds.fifthForm, [1.4]);
  const fifthForm: SkillDefinition = { ...fifthBase, canUse: (_state, actor) => skillRank(actor, tanjiroIds.basic) >= 4 };
  const seventhBase = createBasicAttackSkill(tanjiroIds.seventhForm, [1.4]);
  const seventhForm: SkillDefinition = { ...seventhBase, canUse: (_state, actor) => skillRank(actor, tanjiroIds.basic) >= 5 };

  const formsBase = createLineupDamageSkill(tanjiroIds.forms, [.75, .75, .75, .75, .75],
    { cost: 3, target: 'all-enemies', hits: 3 });
  const forms: SkillDefinition = formsBase;

  const waterfallBase = createLineupDamageSkill(tanjiroIds.waterfall, [.75],
    { cost: 3, target: 'all-enemies', hits: 4 });
  const waterfall: SkillDefinition = { ...waterfallBase,
    canUse: (state, actor) => skillRank(actor, tanjiroIds.forms) >= 4
      && livingEnemyCount(state, actor) > 0 && livingEnemyCount(state, actor) <= 3,
  };

  const river: SkillDefinition = {
    id: tanjiroIds.tenthForm, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 },
    levels: [{ finalRatio: .8 }, { finalRatio: .9 }, { finalRatio: 1 }, { finalRatio: 1.1 }, { finalRatio: 1.2 }],
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      const source = tanjiroSource(tanjiroIds.tenthForm, owner.unitId);
      const stacks = owner.statuses.find(status => status.statusId === tanjiroIds.concentration)?.stacks ?? 0;
      const ratios = [.5, .6, .7, .8, Number(parameters.finalRatio ?? .8) + .3 * stacks];
      return [...ratios.map(ratio => damage(context, owner, target, source, ratio)),
        ...gainConcentration(owner, source, 2),
        { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${tanjiroIds.tenthFormUsed}:${owner.unitId}`,
          statusId: tanjiroIds.tenthFormUsed, source, stacks: 1, duration: { kind: 'permanent' } } }];
    },
  };

  const hinokami: SkillDefinition = {
    id: tanjiroIds.hinokami, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    levels: [{}],
    canUse: (state, actor) => (actor.statuses.find(status => status.statusId === tanjiroIds.concentration)?.stacks ?? 0) >= 9
      && !actor.statuses.some(status => status.statusId === tanjiroIds.hinokamiUsed)
      && state.sides[actor.side === 'blue' ? 'red' : 'blue'].some(id => state.units[id]?.hp > 0),
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId);
      if (!owner) return [];
      const source = tanjiroSource(tanjiroIds.hinokami, owner.unitId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!target || target.hp <= 0) return [];
      const commands: EffectCommand[] = [.5, .6, .7, .8].map(ratio => damage(context, owner, target, source, ratio));
      commands.push({ type: 'lose-life', source, targetId: target.unitId,
        amount: Math.min(target.stats.hp * .99, owner.stats.attack * 10), parentEventId: `${source.id}:max-life-hit` });
      commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${tanjiroIds.hinokamiUsed}:${owner.unitId}`,
        statusId: tanjiroIds.hinokamiUsed, source, stacks: 1, duration: { kind: 'permanent' } } });
      return commands;
    },
  };

  return {
    id: tanjiroIds.hero, skills: [basic, fifthForm, seventhForm, forms, waterfall, river, hinokami],
    mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3591/3592/3593/3595/3596/3597/3598/3599/35910/35911技能行接入基础形态、血线型普攻、水车减伤反击与全集中、三火群攻/少敌瀑布、被控解控额外回合、九型非召唤回合后推条和暴抗、十型五段及末段叠层强化、九层解锁一次火之神神乐。探索战斗前置群攻未移入斗技；AI选择和致命生命上限伤害/抵挡窗口仍需实战帧校验。'],
    handlers: {
      'turn-start': { priority: 94, handle(context, event) { return escapeControlBeforeTurn(context, event); } },
      'turn-end': { priority: 94, handle(context, event) { return tanjiroTurnEnd(context, event); } },
    },
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || skillRank(owner, tanjiroIds.forms) < 5) return [];
      return [{ type: 'add-status', source: tanjiroSource(tanjiroIds.forms, unitId), targetId: unitId,
        instance: { instanceId: `${tanjiroIds.concentrationCrit}:${unitId}`, statusId: tanjiroIds.concentrationCrit,
          source: tanjiroSource(tanjiroIds.forms, unitId), stacks: 1, duration: { kind: 'permanent' },
          modifiers: [{ stat: 'critResist', operation: 'flat', amount: .3 }] } }];
    },
    interceptIncomingDamage(_state, attacker, target, amount, _kind, interception) {
      return interceptWaterwheel(attacker, target, amount, interception);
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      if (actor.statuses.some(status => status.statusId === tanjiroIds.controlExtraTurn)) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (hinokami.canUse?.(context.state, actor)) return lineupIntent(unitId, tanjiroIds.hinokami,
        [enemies[Math.floor(context.random() * enemies.length)]!.unitId], 'single');
      const rank = skillRank(actor, tanjiroIds.forms);
      if (enemies.length === 1 && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return lineupIntent(unitId, tanjiroIds.tenthForm, [enemies[0]!.unitId], 'single');
      if (enemies.length <= 3 && rank >= 4 && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return lineupIntent(unitId, tanjiroIds.waterfall, enemies.map(enemy => enemy.unitId), 'all-enemies');
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return lineupIntent(unitId, tanjiroIds.forms, enemies.map(enemy => enemy.unitId), 'all-enemies');
      const target = enemies.find(enemy => enemy.hp / Math.max(1, enemy.stats.hp) < .2) ?? enemies[0]!;
      const hpRatio = target.hp / Math.max(1, target.stats.hp);
      const id = skillRank(actor, tanjiroIds.basic) >= 5 && hpRatio > .7 ? tanjiroIds.seventhForm
        : skillRank(actor, tanjiroIds.basic) >= 4 && hpRatio < .3 ? tanjiroIds.fifthForm : tanjiroIds.basic;
      return lineupIntent(unitId, id, [target.unitId], 'single');
    },
  };
}

function interceptWaterwheel(attacker: Readonly<UnitState> | undefined, target: Readonly<UnitState>, amount: number,
  interception: import('../core/definitions').DamageInterceptionContext | undefined) {
  if (target.heroId !== tanjiroIds.hero || target.hp <= 0 || amount <= 0 || !attacker || attacker.side === target.side
    || !interception || interception.isUnitUnableToAct(target.unitId) || !passivesEnabled(target)
    || skillRank(target, tanjiroIds.basic) < 3) return undefined;
  const hpRatio = target.hp / Math.max(1, target.stats.hp);
  const missingSteps = Math.max(0, Math.floor((1 - hpRatio + 1e-9) / .2));
  const chance = Math.min(1, .3 + .2 * missingSteps);
  if (interception.battle.random() >= chance) return undefined;
  const source = tanjiroSource(tanjiroIds.waterwheel, target.unitId);
  const counter: EffectCommand[] = [damage(interception.battle, target, attacker, source, .6),
    ...gainConcentration(target, source, 1)];
  return { amount: amount * .3, effects: counter };
}

function escapeControlBeforeTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started' || event.scheduling === 'extra-turn') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== tanjiroIds.hero || owner.hp <= 0 || skillRank(owner, tanjiroIds.forms) < 3
    || !passivesEnabled(owner) || owner.statuses.some(status => status.statusId === tanjiroIds.controlExtraTurn)) return;
  const controls = owner.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
  if (!controls.length) return;
  const source = tanjiroSource(tanjiroIds.whirlpool, owner.unitId);
  return [
    ...controls.map(status => ({ type: 'remove-status-instances' as const, source, targetId: owner.unitId,
      instanceIds: [status.instanceId], reason: 'consumed' as const, parentEventId: event.eventId })),
    { type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${tanjiroIds.controlExtraTurn}:${owner.unitId}`, statusId: tanjiroIds.controlExtraTurn,
        source, stacks: 1, duration: { kind: 'permanent' as const } } },
    { type: 'schedule-turn', source, unitId: owner.unitId, scheduling: 'extra-turn', selection: 'action-gauge', parentEventId: event.eventId },
  ];
}

function tanjiroTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner) return;
  const source = tanjiroSource(tanjiroIds.tenthForm, owner.unitId);
  const commands: EffectCommand[] = [];
  if (owner.heroId === tanjiroIds.hero && owner.unitKind !== 'summon') {
    if (owner.statuses.some(status => status.statusId === tanjiroIds.tenthFormUsed)) {
      commands.push(...gainConcentration(owner, source, 1));
      commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
        statusIds: [tanjiroIds.tenthFormUsed], reason: 'consumed', parentEventId: event.eventId });
    }
    const skip = owner.statuses.some(status => status.statusId === tanjiroIds.controlExtraTurn);
    if (skip) commands.push({ type: 'remove-statuses', source: tanjiroSource(tanjiroIds.whirlpool, owner.unitId),
      targetId: owner.unitId, statusIds: [tanjiroIds.controlExtraTurn], reason: 'consumed', parentEventId: event.eventId });
  }
  if (owner.unitKind !== 'summon') {
    for (const tanjiro of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')].filter(unit => unit.heroId === tanjiroIds.hero
      && skillRank(unit, tanjiroIds.forms) >= 5 && passivesEnabled(unit))) {
      const gaugeSource = tanjiroSource('3599', tanjiro.unitId);
      commands.push({ type: 'change-action-gauge', source: gaugeSource, targetId: tanjiro.unitId,
        amount: 3, parentEventId: event.eventId });
    }
  }
  return commands.length ? commands : undefined;
}

function basicDamage(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  return [damage(context, owner, target, tanjiroSource(skillId, owner.unitId), ratio)];
}

function damage(context: BattleContext, attacker: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(attacker.unitId) ?? attacker.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(attacker), ratio, critChance: attack.crit, critDamage: attack.critDamage }, attacker, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}),
    isCritical: result.isCritical };
}

function gainConcentration(owner: Readonly<UnitState>, source: SourceRef, amount: number): EffectCommand[] {
  const current = owner.statuses.find(status => status.statusId === tanjiroIds.concentration)?.stacks ?? 0;
  const stacks = Math.min(9, current + amount);
  if (stacks <= current) return [];
  const instance: StatusInstance = { instanceId: `${tanjiroIds.concentration}:${owner.unitId}`,
    statusId: tanjiroIds.concentration, source, stacks: amount,
    duration: { kind: 'permanent' } };
  return [{ type: 'add-status', source, targetId: owner.unitId, instance }];
}

function livingEnemyCount(state: import('../core/types').BattleState, actor: Readonly<UnitState>): number {
  return state.sides[actor.side === 'blue' ? 'red' : 'blue'].map(id => state.units[id])
    .filter(unit => unit && unit.hp > 0 && unit.unitKind !== 'summon').length;
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : unit.skillLevel;
}

function tanjiroSource(id: string, unitId: string): SourceRef {
  return { kind: 'skill', id, unitId };
}
