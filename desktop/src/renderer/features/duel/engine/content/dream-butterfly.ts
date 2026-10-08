import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const dreamButterflyIds = { hero: 594, basic: '5941', cocoonSkill: '5942', song: '5943', cocoon: 'status.hero.594.dream-cocoon',
  melody: 'status.hero.594.dream-song', damageTally: 'status.hero.594.damage-tally', cocoonTrigger: 'status.hero.594.cocoon-trigger' } as const;
const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const cocoonRatios = [.15, .2, .2, .2, .2] as const;
const selectedHeal = [.2, .3, .3, .3, .3] as const;
const groupHeal = [.15, .15, .15, .15, .15] as const;

export function registerDreamButterfly(registry: ContentRegistry): void {
  registry.registerStatus({ id: dreamButterflyIds.cocoon, mechanicsCoverage: 'partial', category: 'shield', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: dreamButterflyIds.melody, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: dreamButterflyIds.damageTally, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: dreamButterflyIds.cocoonTrigger, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic = createBasicAttackSkill(dreamButterflyIds.basic, basicRatios);
  const cocoon: SkillDefinition = { id: dreamButterflyIds.cocoonSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'self', targetRelation: 'ally', levels: cocoonRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId); if (!owner || owner.hp <= 0) return [];
      return [cocoonCommand(owner, Number(parameters.ratio ?? cocoonRatios[rank(owner, cocoon.id) - 1]!) * owner.stats.hp, cocoon.id)];
    } };
  const song: SkillDefinition = { id: dreamButterflyIds.song, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies', targetRelation: 'ally', levels: groupHeal.map((ratio, index) => ({ ratio, selectedRatio: selectedHeal[index]! })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId); if (!owner || owner.hp <= 0) return [];
      const selectedId = intent.selectedTargetId && intent.targetIds.includes(intent.selectedTargetId)
        ? intent.selectedTargetId : intent.targetIds.find(id => context.getUnit(id)?.hp && context.getUnit(id)?.side === owner.side);
      const selectedRatio = Number(parameters.selectedRatio ?? selectedHeal[rank(owner, song.id) - 1]!);
      const baseRatio = Number(parameters.ratio ?? groupHeal[rank(owner, song.id) - 1]!);
      const commands: EffectCommand[] = [];
      for (const ally of context.getLivingUnits(owner.side)) {
        if (ally.unitKind === 'summon') continue;
        const ratio = ally.unitId === selectedId ? selectedRatio : baseRatio;
        const amount = ally.stats.hp * ratio;
        commands.push({ type: 'heal', source: dreamSource(song.id, owner.unitId), targetId: ally.unitId, amount });
        if (ally.unitId === selectedId && rank(owner, song.id) >= 4)
          commands.push(cocoonCommand(ally, amount * .5, song.id, owner.unitId));
      }
      if (rank(owner, song.id) >= 3) for (const ally of context.getLivingUnits(owner.side))
        if (ally.unitKind !== 'summon') commands.push({ type: 'add-status', source: dreamSource(song.id, owner.unitId), targetId: ally.unitId,
          instance: { instanceId: `${dreamButterflyIds.melody}:${owner.unitId}:${ally.unitId}`, statusId: dreamButterflyIds.melody,
            source: dreamSource(song.id, owner.unitId), stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
            modifiers: [{ stat: 'damage', operation: 'percent', amount: .2 }] } });
      return commands;
    } };
  const definition: HeroDefinition = { id: dreamButterflyIds.hero, skills: [basic, cocoon, song], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于2且队友有损失生命时施放梦引之声，否则普攻；玩家操控/受睡眠后灵梦自动替换的完整决策仍需录像核验。'],
    mechanicsCoverageNotes: ['已接入摇铃等级倍率、灵梦耗1火并生成15%/20%生命上限梦茧、受到睡眠时解除睡眠并生成梦茧；梦引之声耗2火，为全体非召唤友方治疗15%生命上限，选中目标20%/30%，三级起全队增伤20%，四级起选中目标获得治疗量50%的梦茧。四级受击累计阈值按单次累计事件近似；梦茧破裂的过量伤害免疫、完整计数重置以及五级先機目标选择仍待帧核。'],
    policy(context, unitId) {
      const owner = context.getUnit(unitId); if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return;
      const allies = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon');
      const injured = allies.some(unit => unit.hp < unit.stats.hp);
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      if (fire >= 2 && injured) {
        const target = allies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
        return { actorId: unitId, skillId: dreamButterflyIds.song, targetIds: allies.map(ally => ally.unitId),
          selectedTargetId: target.unitId, shape: 'all-allies', targetRelation: 'ally' };
      }
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'control-application': { priority: 165, handle(context, event) { return replaceSleepWithCocoon(context, event); } },
      hit: { priority: 165, handle(context, event) { return triggerCocoonAtDamageThreshold(context, event); } },
      'turn-start': { priority: 165, handle(context, event) { return resetCocoonTurn(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function replaceSleepWithCocoon(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied' || !/睡眠|沉睡/.test(event.controlType ?? '')) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== dreamButterflyIds.hero || owner.hp <= 0) return;
  const source = dreamSource(dreamButterflyIds.cocoonSkill, owner.unitId);
  return [{ type: 'remove-statuses', source, targetId: owner.unitId, statusIds: [event.statusId], reason: 'consumed', parentEventId: event.eventId },
    cocoonCommand(owner, cocoonRatios[rank(owner, dreamButterflyIds.cocoonSkill) - 1]! * owner.stats.hp,
      dreamButterflyIds.cocoonSkill, owner.unitId, event.eventId)];
}

function triggerCocoonAtDamageThreshold(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== dreamButterflyIds.hero || owner.hp <= 0 || rank(owner, dreamButterflyIds.cocoonSkill) < 4
    || owner.statuses.some(status => status.statusId === dreamButterflyIds.cocoonTrigger)) return;
  const previous = owner.statuses.find(status => status.statusId === dreamButterflyIds.damageTally);
  const total = Number(previous?.values?.amount ?? 0) + event.hpLost;
  const source = dreamSource(dreamButterflyIds.cocoonSkill, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${dreamButterflyIds.damageTally}:${owner.unitId}`, statusId: dreamButterflyIds.damageTally, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { amount: total },
  } }];
  if (total > owner.stats.hp * .2) {
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${dreamButterflyIds.cocoonTrigger}:${owner.unitId}`,
      statusId: dreamButterflyIds.cocoonTrigger, source, stacks: 1, duration: { kind: 'permanent' } } });
    commands.push(cocoonCommand(owner, cocoonRatios[rank(owner, dreamButterflyIds.cocoonSkill) - 1]! * owner.stats.hp,
      dreamButterflyIds.cocoonSkill, owner.unitId, event.eventId));
  }
  return commands;
}

function resetCocoonTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || owner.heroId !== dreamButterflyIds.hero || owner.hp <= 0) return;
  const source = dreamSource(dreamButterflyIds.cocoonSkill, owner.unitId);
  const commands: EffectCommand[] = [];
  const tally = owner.statuses.find(status => status.statusId === dreamButterflyIds.damageTally);
  const trigger = owner.statuses.find(status => status.statusId === dreamButterflyIds.cocoonTrigger);
  if (tally) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId, instanceIds: [tally.instanceId], reason: 'consumed' });
  if (trigger) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId, instanceIds: [trigger.instanceId], reason: 'consumed' });
  return commands.length ? commands : undefined;
}

function cocoonCommand(target: Readonly<UnitState>, amount: number, skillId: string, sourceUnitId = target.unitId, parentEventId?: string): EffectCommand {
  const source = dreamSource(skillId, sourceUnitId);
  const modifiers = skillId === dreamButterflyIds.cocoonSkill && rank(target, dreamButterflyIds.cocoonSkill) >= 5
    ? [{ stat: 'damage' as const, operation: 'percent' as const, amount: .2 }] : undefined;
  return { type: 'add-status', source, targetId: target.unitId, ...(parentEventId ? { parentEventId } : {}), instance: {
    instanceId: `${dreamButterflyIds.cocoon}:${sourceUnitId}:${target.unitId}`, statusId: dreamButterflyIds.cocoon, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { shieldRemaining: Math.max(0, amount) },
    ...(modifiers ? { modifiers } : {}),
  } };
}
function rank(owner: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, owner.skillLevels?.[skillId] ?? owner.skillLevel)); }
function dreamSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
