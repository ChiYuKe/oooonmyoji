import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const mountainChildIds = {
  hero: 243,
  basic: '2431',
  passive: '2432',
  ultimate: '2433',
  stun: 'status.hero.243.stun',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [.35, .37, .39, .41, .43] as const;

export function registerMountainChild(registry: ContentRegistry): void {
  registry.registerStatus({ id: mountainChildIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsAction: true });
  registry.registerHero(createMountainChildDefinition());
}

export function createMountainChildDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(mountainChildIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: mountainChildIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, hits: 3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const source = mountainChildSource(mountainChildIds.ultimate, actor.unitId);
      const ratio = Number(parameters.ratio ?? .35);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        return Array.from({ length: 3 }, () => {
          const hit = context.calculateDamage({ attack: stats.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor),
            ratio, critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
          return { type: 'deal-damage' as const, source, targetId, amount: hit.amount,
            ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
        });
      });
    },
  };
  return {
    id: mountainChildIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能表接入碎岩等级倍率、崩山三段群攻/3火及怪力每次命中8%眩晕；逐段概率与客户端是否一致、觉醒防御加成的面板接入、控制抵抗/封印和正式斗技时序仍待帧图核验'],
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (enemies.length > 1 && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return mountainChildIntent(actor.unitId, mountainChildIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return mountainChildIntent(actor.unitId, mountainChildIds.basic, [enemies[0]!.unitId], 'single');
    },
    handlers: { hit: { priority: 30, handle(context, event) { return tryStun(context, event); } } },
  };
}

function tryStun(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || ![mountainChildIds.basic, mountainChildIds.ultimate]
    .includes(event.source.id as typeof mountainChildIds.basic | typeof mountainChildIds.ultimate)) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== mountainChildIds.hero || !passivesEnabled(owner) || !target || target.hp <= 0) return;
  const command = attemptControl(context, { attemptId: `${mountainChildIds.stun}:${event.eventId}`,
    source: mountainChildSource(mountainChildIds.passive, owner.unitId), targetId: target.unitId,
    statusId: mountainChildIds.stun, controlType: 'stun', baseChance: .08,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  return command ? [command] : [];
}

function mountainChildIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: 'single' | 'all-enemies'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}
function mountainChildSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
