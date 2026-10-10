import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, UnitState } from '../core/types';
import { calculateIndirectDamage, indirectBuffLv } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { effectiveTargetResistance } from './flying-edge';
import { rollAddBuffChance } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const threeTailFoxIds = {
  hero: 202,
  basic: '2021',
  passive: '2022',
  ultimate: '2023',
  speed: 'status.hero.202.speed',
  poison: 'status.hero.202.poison',
  foxMark: 'status.hero.202.fox-mark',
} as const;

/**
 * 按**技能等级**取值（缺 per-skill rank 时回落到全局 skillLevel）。
 * 客户端逐级 param 已核对（`game-skill-data.generated.json`）：
 *   2022 passive  lv1 param2=0.2 / lv2 param1=0.5,param2=0.25 / lv3 param1=1 / lv4 param2=0.4 / lv5 param4=0.15
 *   2021 basic    lv2 param1=12（加速量）…
 *   2023 ultimate … 每层印记伤害随等级变化
 * ⇒ 本文件所有 `skillLevel >= n` 判定都应改用对应技能的等级。
 */
const rank = (unit: Readonly<UnitState>, skillId: string): number => Math.max(1, Math.min(6,
  unit.skillLevels?.[skillId] ?? unit.skillLevel ?? 1));

export function registerThreeTailFox(registry: ContentRegistry): void {
  registry.registerStatus({ id: threeTailFoxIds.speed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: threeTailFoxIds.poison, mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack' });
  // 客户端 `[2024, 1]`（印记）的 `indirectDmgType = 1` ⇒ 它计入目标的间接伤害层数（getIndirectBuffLv）
  registry.registerStatus({ id: threeTailFoxIds.foxMark, mechanicsCoverage: 'verified', category: 'mark', dispellable: true, negativeEffect: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack', indirectDamageLevel: 1 });

  const basic = createThreeTailBasic();
  const ultimate = createThreeTailUltimate();
  registry.registerHero({
    id: threeTailFoxIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    modifyOutgoingDamage(attacker, _target, amount, _kind) {
      return rank(attacker, threeTailFoxIds.passive) >= 5 && attacker.hp >= attacker.stats.hp ? amount * 1.15 : amount;
    },
    handlers: {
      hit: { priority: 135, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId) return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || attacker.heroId !== threeTailFoxIds.hero || !passivesEnabled(attacker)) return;
        const commands: EffectCommand[] = [];
        const lifeStealChance = rank(attacker, threeTailFoxIds.passive) >= 3 ? 1 : .5;
        if (event.hpLost > 0 && context.random() < lifeStealChance) {
          const ratio = rank(attacker, threeTailFoxIds.passive) >= 4 ? .4 : rank(attacker, threeTailFoxIds.passive) >= 2 ? .25 : .2;
          commands.push({ type: 'restore-health', source: foxSource(threeTailFoxIds.passive, attacker.unitId),
            targetId: attacker.unitId, amount: event.hpLost * ratio, parentEventId: event.eventId });
        }
        if (event.source.id === threeTailFoxIds.basic && rank(attacker, threeTailFoxIds.basic) >= 2 && target?.hp && target.hp > 0) {
          const chance = rank(attacker, threeTailFoxIds.basic) >= 4 ? .3 : .2;
          if (context.random() < chance) {
            const duration = rank(attacker, threeTailFoxIds.basic) >= 6 ? 2 : 1;
            const amount = rank(attacker, threeTailFoxIds.basic) >= 5 ? 20 : 12;
            const source = foxSource(threeTailFoxIds.basic, attacker.unitId);
            commands.push({ type: 'add-status', source, targetId: attacker.unitId, instance: {
              instanceId: `${threeTailFoxIds.speed}:${attacker.unitId}:${event.eventId}`, statusId: threeTailFoxIds.speed,
              source, stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'target-turn' },
              modifiers: [{ stat: 'speed', operation: 'flat', amount }],
            }, parentEventId: event.eventId });
          }
        }
        if (event.source.id === threeTailFoxIds.ultimate && rank(attacker, threeTailFoxIds.ultimate) >= 3 && target && target.hp > 0) {
          const result = rollAddBuffChance(context, 1 + (context.getEffectiveStats(attacker.unitId)?.hit ?? 0),
            effectiveTargetResistance(context.getEffectiveStats(target.unitId)?.resist ?? 0,
              foxSource(threeTailFoxIds.ultimate, attacker.unitId), context.getUnit));
          if (result === 'success') {
            const duration = rank(attacker, threeTailFoxIds.ultimate) >= 6 ? 3 : 2;
            const damageRatio = rank(attacker, threeTailFoxIds.ultimate) >= 5 ? .2 : .1;
            const poisonSource = foxSource(threeTailFoxIds.ultimate, attacker.unitId);
            commands.push({ type: 'add-status', source: poisonSource, targetId: target.unitId, instance: {
              instanceId: `${threeTailFoxIds.poison}:${attacker.unitId}:${target.unitId}`,
              statusId: threeTailFoxIds.poison, source: poisonSource, stacks: 1,
              duration: { kind: 'count', remaining: duration, owner: 'target-turn' }, values: { level: 5 },
              modifiers: [{ stat: 'speed', operation: 'percent', amount: -.1 }],
            }, parentEventId: event.eventId });
            commands.push({ type: 'add-status', source: poisonSource, targetId: target.unitId, instance: {
              instanceId: `${threeTailFoxIds.foxMark}:${attacker.unitId}:${target.unitId}`,
              statusId: threeTailFoxIds.foxMark, source: poisonSource, stacks: 1,
              duration: { kind: 'count', remaining: duration, owner: 'target-turn' }, values: { damageRatio },
            }, parentEventId: event.eventId });
          }
        }
        return commands;
      } },
      'turn-start': { priority: 25, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const target = context.getUnit(event.unitId);
        if (!target || target.hp <= 0) return;
        return target.statuses.filter(status => status.statusId === threeTailFoxIds.foxMark).flatMap(status => {
          const source = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
          const ratio = Number(status.values?.damageRatio ?? .1);
          const sourceStats = source && context.getEffectiveStats(source.unitId);
          const targetStats = context.getEffectiveStats(target.unitId);
          if (!source || !sourceStats || !targetStats || !Number.isFinite(ratio) || ratio <= 0) return [];
          const poisonDefenseIgnore = target.statuses.filter(poison => poison.statusId === threeTailFoxIds.poison)
            .reduce((total, poison) => total + poison.stacks * 10 * Math.max(0, Number(poison.values?.level ?? 0)), 0);
          const indirect = calculateIndirectDamage({ attack: sourceStats.attack, defense: targetStats.defense,
            defenseIgnore: poisonDefenseIgnore, ratio: ratio * status.stacks, critDamage: sourceStats.critDamage,
            // 客户端 indirectDamageCalc：间接攻击额外无视 `getIndirectBuffLv() × 10` 防御
            // （印记自己 indirectDmgType=1，按层计入；毒是 0，不计层，只走上面的 poisonDefenseIgnore）
            layers: indirectBuffLv(target) }, context.random);
          return [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId,
            amount: indirect.amount,
            lifeLossKind: 'indirect',
            parentEventId: event.eventId }];
        });
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 3) {
        const target = enemies.length > 1 ? enemies[Math.floor(context.random() * enemies.length)]! : enemies[0]!;
        return { actorId: unitId, skillId: threeTailFoxIds.ultimate, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const lowTarget = enemies.filter(enemy => enemy.hp / Math.max(1, enemy.stats.hp) < .3)
        .sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]
        ?? enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: threeTailFoxIds.basic, targetIds: [lowTarget.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  });
}

function createThreeTailBasic(): SkillDefinition {
  const ratios = [1, 1, 1.1, 1.1, 1.2, 1.2] as const;
  return { id: threeTailFoxIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: ratios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      return makeHit(context, intent.actorId, intent.targetIds[0] ?? '', threeTailFoxIds.basic, Number(parameters.ratio ?? 1));
    } };
}

function createThreeTailUltimate(): SkillDefinition {
  const ratios = [.88, .97, .97, 1.06, 1.06, 1.06] as const;
  return { id: threeTailFoxIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ratios.map(ratio => ({ ratio })), execute(context, intent, parameters) {
      return makeHit(context, intent.actorId, intent.targetIds[0] ?? '', threeTailFoxIds.ultimate, Number(parameters.ratio ?? .88), 3);
    } };
}

function makeHit(context: BattleContext, actorId: string, targetId: string, skillId: string, ratio: number, count = 1): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const actorStats = context.getEffectiveStats(actorId);
  const target = context.getUnit(targetId);
  const targetStats = target && context.getEffectiveStats(targetId);
  if (!actor || !actorStats || !target || !targetStats) return [];
  const source = foxSource(skillId, actorId);
  return Array.from({ length: count }, () => {
    const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
    return { type: 'deal-damage' as const, source, targetId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical };
  });
}

function foxSource(id: string, unitId: string): SourceRef {
  return { kind: 'skill', id, unitId };
}
