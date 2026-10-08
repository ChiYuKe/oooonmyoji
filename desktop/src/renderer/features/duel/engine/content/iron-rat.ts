import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const ironRatIds = {
  hero: 232,
  basic: '2321',
  passive: '2322',
  ultimate: '2323',
  moneyHit: 'status.hero.232.money-hit',
  bought: 'status.hero.232.bought',
  flaw: 'status.hero.232.flaw',
  passiveAttackWindow: 'status.hero.232.passive-attack-window',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.44, .46, .48, .5, .52] as const;

export function registerIronRat(registry: ContentRegistry): void {
  registry.registerStatus({ id: ironRatIds.moneyHit, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: ironRatIds.bought, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: ironRatIds.flaw, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: ironRatIds.passiveAttackWindow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const basic: SkillDefinition = {
    id: ironRatIds.basic,
    actionKind: 'basic',
    target: 'single',
    targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio, moneyHitChance: .5 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      const targetId = intent.targetIds[0];
      const target = targetId ? context.getUnit(targetId) : undefined;
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !actorStats || !target || target.hp <= 0 || !targetStats) return [];
      const source = ratSource(ironRatIds.basic, actor.unitId);
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: hit.isCritical }];
      commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: ironRatIds.moneyHit,
        baseChance: Number(parameters.moneyHitChance ?? .5), duration: { kind: 'count', remaining: 2, owner: 'target-turn' } })
        .map(command => command.type === 'add-status' ? { ...command, instance: { ...command.instance,
          modifiers: [{ stat: 'crit' as const, operation: 'flat' as const, amount: -.2 }] } } : command));
      return commands;
    },
  };

  const ultimate: SkillDefinition = {
    id: ironRatIds.ultimate,
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: ultimateRatios.map(ratio => ({ ratio, flawChance: 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      if (!actor || !actorStats) return [];
      const source = ratSource(ironRatIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        for (let segment = 0; segment < 2; segment++) {
          const target = context.getUnit(targetId);
          const targetStats = context.getEffectiveStats(targetId);
          if (!target || target.hp <= 0 || !targetStats) continue;
          const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? .44),
            critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
            ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: hit.isCritical });
          // Keep each status attempt between its two hit segments so a successful first application
          // modifies the second segment through the shared damage-taken hook.
          commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: ironRatIds.flaw,
            baseChance: Number(parameters.flawChance ?? 1), duration: { kind: 'count', remaining: 2, owner: 'target-turn' } })
            .map(command => command.type === 'add-status' ? { ...command, instance: { ...command.instance,
              modifiers: [{ stat: 'damageTaken' as const, operation: 'percent' as const, amount: .2 }] } } : command));
        }
      }
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: ironRatIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const flawCount = enemies.reduce((count, enemy) => count + enemy.statuses.filter(status => status.statusId === ironRatIds.flaw).length, 0);
      const useUltimate = fire >= 2 && (fire > 5 ? flawCount < 6 : enemies.length >= 2 && flawCount === 0);
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId: useUltimate ? ironRatIds.ultimate : ironRatIds.basic,
        targetIds: useUltimate ? enemies.map(enemy => enemy.unitId) : [target.unitId],
        shape: useUltimate ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
    handlers: { hit: { priority: 130, handle(context, event) { return applyBoughtDebuff(context, event); } } },
  };
  registry.registerHero(definition);
}

function applyBoughtDebuff(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const wearer = context.getUnit(event.targetId);
  const attacker = context.getUnit(event.source.unitId);
  if (!wearer || wearer.heroId !== ironRatIds.hero || wearer.unitKind === 'summon' || wearer.hp <= 0
    || !passivesEnabled(wearer) || !attacker || attacker.hp <= 0) return;
  const attackKey = event.attackId ?? event.actionId ?? event.eventId;
  const previous = wearer.statuses.find(status => status.statusId === ironRatIds.passiveAttackWindow);
  if (previous?.values?.attackKey === attackKey) return;
  const source = ratSource(ironRatIds.passive, wearer.unitId);
  const window: EffectCommand = { type: 'add-status', source, targetId: wearer.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${ironRatIds.passiveAttackWindow}:${wearer.unitId}`, statusId: ironRatIds.passiveAttackWindow,
      source, stacks: 1, duration: { kind: 'permanent' }, values: { attackKey } } };
  if (context.random() >= .4) return [window];
  const debuff = attemptDebuff(context, { source, targetId: attacker.unitId, statusId: ironRatIds.bought, baseChance: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: event.eventId })
    .map(command => command.type === 'add-status' ? { ...command, instance: { ...command.instance,
      modifiers: [{ stat: 'attack' as const, operation: 'percent' as const, amount: -.2 }] } } : command);
  return [window, ...debuff];
}

function ratSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
