import type { DamageInterception, HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveStats } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const innejakuIds = {
  hero: 365, basic: '3651', attachmentSkill: '3652', corruptSkill: '3653',
  attachment: 'status.hero.365.attachment', blood: 'status.hero.365.blood',
  speed: 'status.hero.365.corrupt-speed', resist: 'status.hero.365.corrupt-resist', damageReduction: 'status.hero.365.corrupt-reduction',
} as const;

const defenseRatios = [.5, .6, .7, .8, .9] as const;

export function registerInnejaku(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: innejakuIds.attachment, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep', preventsLethalDamage: true },
    { id: innejakuIds.blood, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit',
      healingRestriction: { allowedSourceIds: [] } },
    { id: innejakuIds.speed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
    { id: innejakuIds.resist, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
    { id: innejakuIds.damageReduction, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
  ];
  statuses.forEach(status => registry.registerStatus(status));
  registry.registerHero(createInnejakuDefinition());
}

export function createInnejakuDefinition(): HeroDefinition {
  const basic: SkillDefinition = { ...createBasicAttackSkill(innejakuIds.basic, [.5]),
    levels: defenseRatios.map((defenseRatio, index) => ({ ratio: .5, defenseRatio, rank: index + 1 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || owner.heroId !== innejakuIds.hero || !target || target.hp <= 0 || target.side === owner.side) return [];
      const offense = effectiveStats(owner), defense = effectiveStats(target);
      const normal = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio: .5,
        critChance: offense.crit, critDamage: offense.critDamage }, owner, target);
      return [
        { type: 'deal-damage', source: innejakuSource(innejakuIds.basic, owner.unitId), targetId: target.unitId,
          amount: normal.amount, ...(normal.damageOptions ? { damageOptions: normal.damageOptions } : {}), isCritical: normal.isCritical },
        { type: 'deal-damage', source: innejakuSource(innejakuIds.basic, owner.unitId), targetId: target.unitId,
          amount: effectiveStats(owner).defense * Number(parameters.defenseRatio ?? defenseRatios[skillRank(owner, innejakuIds.basic) - 1]),
          damageKind: 'true' },
      ];
    } };
  const attachmentSkill: SkillDefinition = {
    id: innejakuIds.attachmentSkill, actionKind: 'skill', target: 'single', targetRelation: 'ally', levels: [{ rank: 1 }],
    execute(context, intent) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || owner.heroId !== innejakuIds.hero || !target || target.hp <= 0
        || target.side !== owner.side || target.unitKind === 'summon') return [];
      const carrier = Object.values(context.state.units).find(unit => has(unit, innejakuIds.attachment));
      const old = carrier?.statuses.find(status => status.statusId === innejakuIds.attachment);
      return [...(carrier && old ? [{ type: 'remove-status-instances' as const, source: innejakuSource(innejakuIds.attachmentSkill, owner.unitId),
        targetId: carrier.unitId, instanceIds: [old.instanceId], reason: 'replaced' as const }] : []), attachmentStatus(owner, target)];
    },
  };
  const corruptSkill: SkillDefinition = {
    id: innejakuIds.corruptSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'ally', levels: [{ ratio: 10, rank: 1 }, { ratio: 10, rank: 2 }, { ratio: 10, rank: 3 },
      { ratio: 20, rank: 4 }, { ratio: 20, rank: 5 }],
    canUse(state, actor) {
      const id = actor.unitId;
      return actor.heroId === innejakuIds.hero && actor.hp > 0 && actor.unitKind !== 'summon'
        && (state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0) >= 3
        && Object.values(state.units).some(unit => unit.side === actor.side && unit.hp > 0 && unit.unitKind !== 'summon'
          && !unit.statuses.some(status => status.statusId === innejakuIds.blood));
    },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.heroId !== innejakuIds.hero || owner.hp <= 0 || !target || target.hp <= 0
        || target.side !== owner.side || target.unitKind === 'summon' || has(target, innejakuIds.blood)) return [];
      const rank = skillRank(owner, innejakuIds.corruptSkill);
      const cap = Math.floor(effectiveStats(owner).defense * Number(parameters.ratio ?? (rank >= 4 ? 20 : 10)));
      const lost = Math.min(cap, Math.floor(target.stats.hp * .5));
      if (lost <= 0) return [];
      const source = innejakuSource(innejakuIds.corruptSkill, owner.unitId);
      const commands: EffectCommand[] = [{ type: 'reduce-max-health', source, targetId: target.unitId, amount: lost,
        minimumRatio: .5, statusId: innejakuIds.blood }, bloodStatus(owner, target, lost * 3)];
      if (rank >= 2) commands.push(statusCommand(target, innejakuIds.speed, source, [{ stat: 'speed', operation: 'flat', amount: 10 }]));
      if (rank >= 3) commands.push(statusCommand(target, innejakuIds.resist, source, [{ stat: 'resist', operation: 'flat', amount: .2 }]));
      if (rank >= 5) commands.push(statusCommand(target, innejakuIds.damageReduction, source,
        [{ stat: 'damageTaken', operation: 'percent', amount: -.1 }]));
      return commands;
    },
  };
  return {
    id: innejakuIds.hero, skills: [basic, attachmentSkill, corruptSkill], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    handlers: {
      'battle-start': { priority: 50, handle(context, event) { return initializeAttachment(context, event); } },
    },
    interceptIncomingDamage(state, _attacker, target, amount): DamageInterception | undefined {
      if (target.hp <= 0 || amount < target.hp || !target.statuses.some(status => status.statusId === innejakuIds.attachment)) return undefined;
      const mark = target.statuses.find(status => status.statusId === innejakuIds.attachment)!;
      const owner = state.units[mark.source.unitId ?? ''];
      if (!owner || owner.hp <= 0 || owner.heroId !== innejakuIds.hero) return undefined;
      const saved = Math.max(0, target.stats.hp - 1);
      const source = innejakuSource(innejakuIds.attachmentSkill, owner.unitId);
      return { amount: 0, effects: [
        { type: 'remove-status-instances', source, targetId: target.unitId, instanceIds: [mark.instanceId], reason: 'consumed' },
        { type: 'reduce-max-health', source, targetId: target.unitId, amount: saved, minimumRatio: 0, statusId: innejakuIds.blood },
        bloodStatus(owner, target, saved * 3),
      ] };
    },
    aiCoverageNotes: ['社区式神AI条目记为“无条件→3技能、可用→1技能、可用→2技能”。AI页没有目标选择细则；当前按3火腐化优先，其次攻击，附身选择仍属部分覆盖。'],
    mechanicsCoverageNotes: ['依本地3651至3653技能和战斗状态3651/3653/3655/3656/3657接入雀啄攻防双段、腐化扣生命上限与腐血吸伤，以及附身致命保护。常规附身先机、血量改变/血液消耗/治疗限制、血液面板增伤与降暴击、附身等级成长、消耗附身后的驱散推条及协战窗口仍需逐项帧核。'],
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== innejakuIds.hero || owner.hp <= 0 || owner.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(owner.side).filter(ally => ally.unitKind !== 'summon');
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      const corruptionTarget = allies.find(ally => !has(ally, innejakuIds.blood));
      if (fire >= 3 && corruptionTarget) return intent(owner.unitId, innejakuIds.corruptSkill, [corruptionTarget.unitId], 'single', 'ally');
      const attached = allies.find(ally => has(ally, innejakuIds.attachment));
      const strongest = allies.slice().sort((a, b) => effectiveStats(b).attack - effectiveStats(a).attack)[0];
      if (strongest && !attached) return intent(owner.unitId, innejakuIds.attachmentSkill, [strongest.unitId], 'single', 'ally');
      return intent(owner.unitId, innejakuIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
  };
}

function initializeAttachment(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  return (['blue', 'red'] as const).flatMap(side => {
    const owner = context.getLivingUnits(side).find(unit => unit.heroId === innejakuIds.hero);
    if (!owner) return [];
      const ally = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon')
        .sort((a, b) => effectiveStats(b).attack - effectiveStats(a).attack)[0];
      return ally ? [attachmentStatus(owner, ally)] : [];
    });
}
function attachmentStatus(owner: Readonly<UnitState>, target: Readonly<UnitState>): EffectCommand {
  return statusCommand(target, innejakuIds.attachment, innejakuSource(innejakuIds.attachmentSkill, owner.unitId), undefined,
    { uniqueOwnerId: owner.unitId });
}
function bloodStatus(owner: Readonly<UnitState>, target: Readonly<UnitState>, shield: number): EffectCommand {
  return statusCommand(target, innejakuIds.blood, innejakuSource(innejakuIds.corruptSkill, owner.unitId),
    [{ stat: 'damage', operation: 'percent', amount: .25 }, { stat: 'crit', operation: 'flat', amount: -.1 }], { shieldRemaining: shield });
}
function statusCommand(target: Readonly<UnitState>, statusId: string, source: SourceRef,
  modifiers?: StatusInstance['modifiers'], values?: StatusInstance['values']): EffectCommand {
  return { type: 'add-status', source, targetId: target.unitId, instance: { instanceId: `${statusId}:${source.unitId}:${target.unitId}`,
    statusId, source, stacks: 1, duration: { kind: 'permanent' }, ...(modifiers ? { modifiers } : {}), ...(values ? { values } : {}) } };
}
function has(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function innejakuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function intent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'], targetRelation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}
function skillRank(owner: Readonly<UnitState>, skillId: string): number {
  const rank = owner.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : Math.max(1, Math.min(6, owner.skillLevel));
}
