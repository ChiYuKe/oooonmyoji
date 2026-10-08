import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { attemptControl } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const oniMaskIds = {
  hero: 433,
  barrel: '4331',
  snow: '4332',
  formBarrel: 'status.hero.433.form-barrel',
  formSnow: 'status.hero.433.form-snow',
  freeze: 'status.hero.433.freeze',
} as const;

export function registerOniMask(registry: ContentRegistry): void {
  registry.registerStatus({ id: oniMaskIds.formBarrel, mechanicsCoverage: 'verified', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: oniMaskIds.formSnow, mechanicsCoverage: 'verified', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: oniMaskIds.freeze, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerHero(createOniMaskDefinition());
}

export function createOniMaskDefinition(): HeroDefinition {
  const barrel: SkillDefinition = {
    id: oniMaskIds.barrel, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: false,
    canUse: (_state, actor) => hasForm(actor, oniMaskIds.formBarrel),
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const targetId = intent.targetIds[0];
      if (!targetId) return [];
      return [...strike(context, intent.actorId, targetId, oniMaskIds.barrel, Number(parameters.ratio ?? 1)),
        ...switchForm(intent.actorId, oniMaskIds.formBarrel, oniMaskIds.formSnow)];
    },
  };
  const snow: SkillDefinition = {
    id: oniMaskIds.snow, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    useClientDamageData: false,
    canUse: (_state, actor) => hasForm(actor, oniMaskIds.formSnow),
    levels: [0.4, 0.45, 0.5, 0.55, 0.6].map(chance => ({ chance })),
    execute(context, intent, parameters) {
      const targetId = intent.targetIds[0];
      const actor = context.getUnit(intent.actorId);
      const target = targetId && context.getUnit(targetId);
      const actorStats = actor && context.getEffectiveStats(actor.unitId);
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !target || !actorStats || !targetStats || target.hp <= 0) return [];
      const source = oniMaskSource(oniMaskIds.snow, actor.unitId);
      const commands: EffectCommand[] = [];
      for (let hit = 0; hit < 3; hit++) {
        const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
          ratio: 0.4, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
        commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: damage.amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical });
        const freeze = attemptControl(context, { attemptId: `${oniMaskIds.freeze}:${actor.unitId}:${context.state.counters.action}:${hit}`,
          source, targetId: target.unitId, statusId: oniMaskIds.freeze, controlType: 'freeze',
          baseChance: Number(parameters.chance ?? 0.4), duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (freeze) commands.push(freeze);
      }
      commands.push(...switchForm(actor.unitId, oniMaskIds.formSnow, oniMaskIds.formBarrel));
      return commands;
    },
  };
  return {
    id: oniMaskIds.hero, skills: [barrel, snow], aiCoverage: 'verified', mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['按客户端技能表实现普攻100%/105%/110%/115%/125%，雪球三段每段40%攻击及每段独立40%至60%基础概率冰冻；两种技能施放后交替。正式战斗帧未提供，冰冻逐段判定与切招顺序由技能文本和回归覆盖。'],
    initialize(_context, unitId) {
      const source = oniMaskSource(oniMaskIds.formBarrel, unitId);
      return [{ type: 'add-status', source, targetId: unitId, instance: formInstance(unitId, oniMaskIds.formBarrel) }];
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const target = enemies.slice().sort((a, b) => a.hp / a.stats.hp - b.hp / b.stats.hp)[0];
      if (!target) return undefined;
      const skillId = hasForm(actor, oniMaskIds.formSnow) ? oniMaskIds.snow : oniMaskIds.barrel;
      return { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function strike(context: BattleContext, actorId: string, targetId: string, skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const target = context.getUnit(targetId);
  const actorStats = actor && context.getEffectiveStats(actorId);
  const targetStats = target && context.getEffectiveStats(targetId);
  if (!actor || !target || !actorStats || !targetStats || target.hp <= 0) return [];
  const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
    ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: oniMaskSource(skillId, actorId), targetId,
    amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
}

function switchForm(unitId: string, from: string, to: string): EffectCommand[] {
  const source = oniMaskSource(to, unitId);
  return [
    { type: 'remove-statuses', source, targetId: unitId, statusIds: [from] },
    { type: 'add-status', source, targetId: unitId, instance: formInstance(unitId, to), parentEventId: `${from}:${unitId}` },
  ];
}

function formInstance(unitId: string, statusId: string): StatusInstance {
  return { instanceId: `${statusId}:${unitId}`, statusId, source: oniMaskSource(statusId, unitId),
    stacks: 1, duration: { kind: 'permanent' } };
}

function hasForm(unit: { statuses: readonly StatusInstance[] }, statusId: string): boolean {
  return unit.statuses.some(status => status.statusId === statusId);
}

function oniMaskSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
