import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const asuraIds = {
  hero: 364, basic: '3641', sanitySkill: '3642', ultimate: '3643', madnessSkill: '3644',
  sanity: 'status.hero.364.sanity', sanityGuard: 'status.hero.364.sanity-guard', sanityDefense: 'status.hero.364.sanity-defense',
  madness: 'status.hero.364.madness', doom: 'status.hero.364.doom',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [2.9, 3.05, 3.15, 3.15, 3.15] as const;
const chaseRatios = [.54, .54, .54, .63, .63] as const;
const controlTypes = ['眩晕', '冰冻', '深度冰冻', '混乱', '沉睡', '沉默', '嘲讽', '放逐', '变形', '封印', '缴械'];

export function registerAsura(registry: ContentRegistry): void {
  const madness = createMadnessSkill();
  const statuses: StatusDefinition[] = [
    { id: asuraIds.sanity, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 9,
      mechanicsCoverageNotes: ['理性上限9，动态降低输出；行动前消耗、友方回合末回复及加血已按引擎事件接入，连续攻击的逐段理性消耗仍需帧核。'] },
    { id: asuraIds.sanityGuard, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', controlImmunityTypes: controlTypes },
    { id: asuraIds.sanityDefense, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: asuraIds.madness, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', grantedSkills: [madness],
      selectAction(context, actor) {
        if (actor.hp <= 0 || actor.heroId !== asuraIds.hero || actor.unitKind === 'summon') return undefined;
        const targets = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
          .filter(unit => unit.unitId !== actor.unitId && unit.unitKind !== 'summon');
        if (!targets.length) return undefined;
        return { actorId: actor.unitId, skillId: asuraIds.madnessSkill,
          targetIds: targets.map(unit => unit.unitId), shape: 'multi', targetRelation: 'any', kind: 'passive' };
      } },
    { id: asuraIds.doom, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', preventsRevive: true },
  ];
  for (const status of statuses) registry.registerStatus(status);
  registry.registerHero(createAsuraDefinition());
}

export function createAsuraDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(asuraIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: asuraIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map((ratio, index) => ({ ratio, chaseRatio: chaseRatios[index]!, rank: index + 1 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const rank = skillRank(owner, asuraIds.ultimate);
      const sanity = currentSanity(owner);
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side !== owner.side));
      const commands: EffectCommand[] = [];
      const mainRatio = Number(parameters.ratio ?? ultimateRatios[rank - 1]);
      const chaseRatio = Number(parameters.chaseRatio ?? chaseRatios[rank - 1]);
      for (const target of targets) commands.push(asuraDamage(context, owner, target, asuraIds.ultimate, mainRatio));
      const extraHits = Math.max(0, sanity - targets.length);
      let chaseTarget = intent.selectedTargetId ? context.getUnit(intent.selectedTargetId) : targets[0];
      for (let index = 0; index < extraHits && chaseTarget && chaseTarget.hp > 0; index += 1) {
        commands.push(asuraDamage(context, owner, chaseTarget, asuraIds.ultimate, chaseRatio));
        const sanityStatus = owner.statuses.find(status => status.statusId === asuraIds.sanity);
        if (sanityStatus && index + 1 < extraHits) commands.push({ type: 'change-status-stacks',
          source: asuraSource(asuraIds.sanitySkill, owner.unitId), targetId: owner.unitId,
          instanceId: sanityStatus.instanceId, amount: -1 });
        if (skillRank(owner, asuraIds.sanitySkill) >= 5 && index + 1 < extraHits) {
          const defense = owner.statuses.find(status => status.statusId === asuraIds.sanityDefense);
          if (defense) commands.push({ type: 'change-status-stacks', source: asuraSource(asuraIds.sanitySkill, owner.unitId),
            targetId: owner.unitId, instanceId: defense.instanceId, amount: 1 });
        }
      }
      return commands;
    },
  };
  const madness = createMadnessSkill();
  return {
    id: asuraIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== asuraIds.hero) return [];
      return [sanityStatus(owner, 9)];
    },
    handlers: {
      'battle-start': { priority: 50, handle(context, event) { return initializeSanity(context, event); } },
      'turn-start': { priority: 50, handle(context, event) { return onTurnStart(context, event); } },
      'attack-start': { priority: 50, handle(context, event) { return onAttackStart(context, event); } },
      'attack-end': { priority: 50, handle(context, event) { return onAttackEnd(context, event); } },
      'turn-end': { priority: 50, handle(context, event) { return onTurnEnd(context, event); } },
      'unit-defeated': { priority: 50, handle(context, event) { return onUnitDefeated(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.heroId !== asuraIds.hero) return undefined;
      const enemies = [...context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')];
      if (!enemies.length) return undefined;
      if (currentSanity(owner) < 9) return { actorId: owner.unitId, skillId: asuraIds.basic,
        targetIds: [enemies.sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!.unitId],
        shape: 'single', targetRelation: 'enemy' };
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 3) return { actorId: owner.unitId, skillId: asuraIds.ultimate,
        targetIds: enemies.map(unit => unit.unitId), selectedTargetId: enemies[0]!.unitId,
        shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: owner.unitId, skillId: asuraIds.basic,
        targetIds: [enemies.sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!.unitId],
        shape: 'single', targetRelation: 'enemy' };
    },
    mechanicsCoverageNotes: ['按本地3641至3644技能和103641/103642战斗状态数据接入9点理性、回合末友方回理性/治疗、攻击开始扣除所及目标数量、理性输出压制、五级失去理性减伤、低于9点控制/放逐免疫、归零自动无间杀戮、无间杀戮随机攻击全场及击败目标封复活、炼狱虐杀三火全体攻击/理性追击/五级击败转目标。连续多段攻击的逐段理性结算、回合开始的理性重置次序、击败触发后技能形态切换与御魂/被动封印边界仍需实战帧确认。'],
  };
}

function createMadnessSkill(): SkillDefinition {
  return { id: asuraIds.madnessSkill, actionKind: 'passive', target: 'multi', targetRelation: 'any', levels: [{ ratio: 2.63, rainRatio: 1.13 }],
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0
        && unit.unitId !== owner.unitId && unit.unitKind !== 'summon'));
      if (!targets.length) return [];
      const sword = targets[Math.floor(context.random() * targets.length)]!;
      const commands: EffectCommand[] = [];
      for (const target of targets) commands.push(asuraDamage(context, owner, target, asuraIds.madnessSkill,
        target.unitId === sword.unitId ? Number(parameters.ratio ?? 2.63) : Number(parameters.rainRatio ?? 1.13)));
      return commands;
    } };
}

function initializeSanity(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const commands = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === asuraIds.hero).flatMap(unit => [sanityStatus(unit, 9)]);
  return commands.length ? commands : undefined;
}

function onTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== asuraIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
  return gainSanity(context, actor, Math.max(0, 9 - currentSanity(actor)), event.eventId);
}

function onAttackStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-start' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== asuraIds.hero || event.targetIds.length === 0) return;
  const sanity = currentSanity(owner);
  const amount = Math.min(sanity, event.targetIds.length);
  if (amount <= 0) return;
  const status = owner.statuses.find(item => item.statusId === asuraIds.sanity);
  if (!status) return;
  const commands: EffectCommand[] = [{ type: 'change-status-stacks', source: asuraSource(asuraIds.sanitySkill, owner.unitId),
    targetId: owner.unitId, instanceId: status.instanceId, amount: -amount, parentEventId: event.eventId }];
  if (skillRank(owner, asuraIds.sanitySkill) >= 5) commands.push(changeDefenseStatus(owner, amount, true, event.eventId));
  if (sanity - amount === 0) commands.push(addStatus(owner, asuraIds.madness, asuraSource(asuraIds.madnessSkill, owner.unitId),
    { kind: 'permanent' }, undefined, { sealPassives: true, sealSouls: true }, event.eventId));
  return commands;
}

function onAttackEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== asuraIds.hero) return;
  const defeated = event.targetHealthChanges?.filter(change => change.defeatedByHit).map(change => context.getUnit(change.targetId))
    .filter((unit): unit is UnitState => Boolean(unit));
  if (!defeated?.length || event.actionKind !== 'basic') return;
  return defeated.map(unit => addStatus(unit, asuraIds.doom, asuraSource(asuraIds.basic, owner.unitId), { kind: 'permanent' }));
}

function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated' || !event.defeatedBy?.unitId || !event.defeatedBy.id.startsWith('364')) return;
  const owner = context.getUnit(event.defeatedBy.unitId), target = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== asuraIds.hero || !target) return;
  return [addStatus(target, asuraIds.doom, asuraSource(asuraIds.basic, owner.unitId), { kind: 'permanent' }),
    addStatus(owner, asuraIds.madness, asuraSource(asuraIds.madnessSkill, owner.unitId),
      { kind: 'permanent' }, undefined, { sealPassives: true, sealSouls: true }, event.eventId)];
}

function onTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const owners = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === asuraIds.hero && unit.side === actor.side && unit.unitId !== actor.unitId && passivesEnabled(unit));
  const commands = owners.flatMap(owner => gainSanity(context, owner, actor.heroId === 363 ? 4 : 1, event.eventId) ?? []);
  return commands.length ? commands : undefined;
}

function gainSanity(context: BattleContext, owner: Readonly<UnitState>, wanted: number, parentEventId: string): EffectCommand[] | undefined {
  const current = currentSanity(owner);
  const amount = Math.min(Math.max(0, wanted), 9 - current);
  if (!amount) return;
  const sanity = owner.statuses.find(status => status.statusId === asuraIds.sanity);
  if (!sanity) return [sanityStatus(owner, amount, parentEventId), healSanity(owner, amount, parentEventId)];
  const commands: EffectCommand[] = [{ type: 'change-status-stacks', source: asuraSource(asuraIds.sanitySkill, owner.unitId),
    targetId: owner.unitId, instanceId: sanity.instanceId, amount, parentEventId }, healSanity(owner, amount, parentEventId)];
  if (skillRank(owner, asuraIds.sanitySkill) >= 5) commands.push(changeDefenseStatus(owner, amount, false, parentEventId));
  if (current + amount >= 9) {
    const madness = owner.statuses.find(status => status.statusId === asuraIds.madness);
    if (madness) commands.push({ type: 'remove-status-instances', source: asuraSource(asuraIds.madnessSkill, owner.unitId),
      targetId: owner.unitId, instanceIds: [madness.instanceId], reason: 'consumed', parentEventId });
  }
  return commands;
}

function onEffectResolution(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== asuraIds.sanity) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== asuraIds.hero || currentSanity(owner) > 0) return;
  return [addStatus(owner, asuraIds.madness, asuraSource(asuraIds.madnessSkill, owner.unitId),
    { kind: 'permanent' }, undefined, { sealPassives: true, sealSouls: true }, event.eventId)];
}

function asuraDamage(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio,
    defenseIgnore: effectiveDefenseIgnore(owner), critChance: offense.crit, critDamage: offense.critDamage }, owner, target);
  return { type: 'deal-damage', source: asuraSource(skillId, owner.unitId), targetId: target.unitId,
    amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, offense.critDamage) } : {}), isCritical: result.isCritical };
}

function sanityStatus(owner: Readonly<UnitState>, stacks: number, parentEventId?: string): EffectCommand {
  const rank = skillRank(owner, asuraIds.sanitySkill), damageDown = [.09, .08, .07, .06, .06][rank - 1]!;
  return addStatus(owner, asuraIds.sanity, asuraSource(asuraIds.sanitySkill, owner.unitId), { kind: 'permanent' },
    [{ stat: 'damage', operation: 'percent', amount: -damageDown, perStack: true }], undefined, parentEventId, stacks);
}

function changeDefenseStatus(owner: Readonly<UnitState>, amount: number, losing: boolean, parentEventId: string): EffectCommand {
  const existing = owner.statuses.find(status => status.statusId === asuraIds.sanityDefense);
  if (losing) return existing
    ? { type: 'change-status-stacks', source: asuraSource(asuraIds.sanitySkill, owner.unitId), targetId: owner.unitId,
        instanceId: existing.instanceId, amount, parentEventId }
    : addStatus(owner, asuraIds.sanityDefense, asuraSource(asuraIds.sanitySkill, owner.unitId), { kind: 'permanent' },
        [{ stat: 'damageTaken', operation: 'percent', amount: -.06, perStack: true }], undefined, parentEventId, amount);
  return existing ? { type: 'change-status-stacks', source: asuraSource(asuraIds.sanitySkill, owner.unitId), targetId: owner.unitId,
    instanceId: existing.instanceId, amount: -amount, parentEventId } : { type: 'change-action-gauge', source: asuraSource(asuraIds.sanitySkill, owner.unitId), targetId: owner.unitId, amount: 0 };
}

function healSanity(owner: Readonly<UnitState>, amount: number, parentEventId: string): EffectCommand {
  return { type: 'heal', source: asuraSource(asuraIds.sanitySkill, owner.unitId), targetId: owner.unitId,
    amount: owner.stats.hp * .08 * amount, parentEventId };
}
function currentSanity(owner: Readonly<UnitState>): number { return owner.statuses.find(status => status.statusId === asuraIds.sanity)?.stacks ?? 0; }
function addStatus(target: Readonly<UnitState>, statusId: string, source: SourceRef, duration: StatusInstance['duration'],
  modifiers?: StatusInstance['modifiers'], values?: StatusInstance['values'], parentEventId?: string, stacks = 1): EffectCommand {
  return { type: 'add-status', source, targetId: target.unitId, ...(parentEventId ? { parentEventId } : {}),
    instance: { instanceId: `${statusId}:${source.unitId}:${target.unitId}`, statusId, source, stacks, duration,
      ...(modifiers ? { modifiers } : {}), ...(values ? { values } : {}) } };
}
function asuraSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillRank(owner: Readonly<UnitState>, skillId: string): number {
  const rank = owner.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(5, Math.floor(rank!))) : Math.max(1, Math.min(5, owner.skillLevel));
}
