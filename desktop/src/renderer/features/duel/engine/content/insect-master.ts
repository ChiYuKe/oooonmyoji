import type { DamageInterception, DamageInterceptionContext, HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const insectMasterIds = {
  hero: 306,
  basic: '3061',
  passive: '3062',
  skill: '3063',
  trace: 'status.hero.306.insect-trace',
  triggerWindow: 'status.hero.306.trigger-window',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const healRatios = [.12, .12, .15, .15, .18] as const;
const cleanseCounts = [3, 4, 4, 4, 4] as const;
const reducedHealRatios = [.3, .3, .3, .2, .2] as const;

export function registerInsectMaster(registry: ContentRegistry): void {
  registry.registerStatus({ id: insectMasterIds.trace, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: insectMasterIds.triggerWindow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const skill: SkillDefinition = {
    id: insectMasterIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'multi', targetRelation: 'ally',
    levels: healRatios.map((healRatio, index) => ({ healRatio, cleanseCount: cleanseCounts[index]!, reducedHealRatio: reducedHealRatios[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const source = insectSource(insectMasterIds.skill, actor.unitId);
      const cleanseCount = Math.max(1, Math.floor(Number(parameters.cleanseCount ?? 3)));
      const selected = intent.targetIds.slice(0, cleanseCount).map(id => context.getUnit(id))
        .filter((unit): unit is UnitState => Boolean(unit && unit.side === actor.side && unit.hp > 0));
      const cleansedTargets = new Set<string>();
      const commands: EffectCommand[] = [];
      for (const ally of selected) {
        const removable = ally.statuses.filter(status => {
          const category = context.getStatusCategory(status.statusId);
          return (category === 'debuff' || category === 'control') && context.isStatusDispellable(status.statusId);
        });
        if (removable.length === 0) continue;
        cleansedTargets.add(ally.unitId);
        commands.push({ type: 'dispel-statuses', source, targetId: ally.unitId,
          statusIds: [...new Set(removable.map(status => status.statusId))], maxCount: 1 });
      }
      const baseHeal = actor.stats.hp * Number(parameters.healRatio ?? .12);
      const reducedRatio = Number(parameters.reducedHealRatio ?? .3);
      for (const ally of context.getLivingUnits(actor.side)) {
        const amount = baseHeal * (cleansedTargets.has(ally.unitId) ? 1 - reducedRatio : 1);
        commands.push({ type: 'heal', source, targetId: ally.unitId, amount });
      }
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: insectMasterIds.hero,
    skills: [createBasicAttackSkill(insectMasterIds.basic, basicRatios), skill],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['被动每次攻击最多触发一次，25%免伤与虫之痕附加独立判定；虫之痕易伤按客户端参数应用，二级治疗技能的 AI 选取上限按技能自身等级读取；护盾全吸收与状态抵抗下的触发边界仍未完整核验'],
    policy(context: BattleContext, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (allies.length === 0 || enemies.length === 0) return undefined;
      const lowestRatio = Math.min(...allies.map(ally => ally.hp / Math.max(1, ally.stats.hp)));
      if (lowestRatio < .7 && (context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        const limit = skillRank(actor, insectMasterIds.skill) >= 2 ? 4 : 3;
        const ordered = [...allies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
          - right.hp / Math.max(1, right.stats.hp));
        const cleanseCandidates = ordered.filter(ally => ally.statuses.some(status => {
          const category = context.getStatusCategory(status.statusId);
          return (category === 'debuff' || category === 'control') && context.isStatusDispellable(status.statusId);
        }));
        const targets = (cleanseCandidates.length > 0 ? cleanseCandidates : ordered).slice(0, limit);
        return { actorId: unitId, skillId: insectMasterIds.skill, targetIds: targets.map(ally => ally.unitId),
          shape: 'multi', targetRelation: 'ally' };
      }
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: insectMasterIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, attacker, target, amount, _kind, interceptContext) {
      return interceptInsectPassive(state, attacker, target, amount, interceptContext);
    },
    handlers: { hit: { priority: 130, handle(context, event) { return healFromTracedDamage(context, event); } } },
  };
  registry.registerHero(definition);
}

function interceptInsectPassive(state: import('../core/types').BattleState, attacker: Readonly<UnitState> | undefined,
  target: Readonly<UnitState>, amount: number, context?: DamageInterceptionContext): DamageInterception | undefined {
  if (!context || !attacker || attacker.side === target.side || target.heroId !== insectMasterIds.hero
    || target.hp <= 0 || amount <= 0 || !passivesEnabled(target) || isAsleep(target, context)) return undefined;
  const existing = target.statuses.find(status => status.statusId === insectMasterIds.triggerWindow);
  if (Number(existing?.values?.attackId ?? -1) === context.attackId) return undefined;
  const source = insectSource(insectMasterIds.passive, target.unitId);
  const window: StatusInstance = { instanceId: `${insectMasterIds.triggerWindow}:${target.unitId}`,
    statusId: insectMasterIds.triggerWindow, source, stacks: 1, duration: { kind: 'permanent' },
    values: { attackId: context.attackId } };
  const effects: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId, instance: window }];
  // Client rules describe these as separate effects: a 25% hit immunity roll,
  // then an independent debuff application roll against the attacker's resist.
  const immune = context.battle.random() < .25;
  effects.push(...attemptDebuff(context.battle, { source, targetId: attacker.unitId, statusId: insectMasterIds.trace,
    baseChance: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: .3 }] }));
  return { amount: immune ? 0 : amount, effects };
}

function isAsleep(target: Readonly<UnitState>, context: DamageInterceptionContext): boolean {
  return target.statuses.some(status => context.battle.getStatusCategory(status.statusId) === 'control'
    && status.values?.controlType === '睡眠');
}

function healFromTracedDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0) return;
  const target = context.getUnit(event.targetId);
  if (!target) return;
  const commands: EffectCommand[] = [];
  for (const trace of target.statuses.filter(status => status.statusId === insectMasterIds.trace)) {
    const owner = trace.source.unitId ? context.getUnit(trace.source.unitId) : undefined;
    if (!owner || owner.hp <= 0 || owner.heroId !== insectMasterIds.hero || !passivesEnabled(owner)) continue;
    const healTarget = context.getLivingUnits(owner.side).filter(unit => unit.unitKind !== 'summon')
      .slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
        || left.unitId.localeCompare(right.unitId))[0];
    if (!healTarget) continue;
    commands.push({ type: 'heal', source: trace.source, targetId: healTarget.unitId,
      amount: event.hpLost * .15, parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function insectSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  const rank = unit.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(6, Math.floor(rank!))) : unit.skillLevel;
}
