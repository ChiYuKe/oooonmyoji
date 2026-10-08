import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const xiazhongshaonvIds = { hero: 287, basic: '2871', passive: '2872', dream: '2873',
  shield: 'status.hero.287.rainbow-shield', dreamRecord: 'status.hero.287.dream-record', dreamGuard: 'status.hero.287.dream-guard' } as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const dreamRatios = [.3, .6, .5, .6, .6] as const;

export function registerXiazhongshaonv(registry: ContentRegistry): void {
  registry.registerStatus({ id: xiazhongshaonvIds.shield, mechanicsCoverage: 'partial', category: 'shield', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' } satisfies StatusDefinition);
  registry.registerStatus({ id: xiazhongshaonvIds.dreamRecord, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: xiazhongshaonvIds.dreamGuard, mechanicsCoverage: 'partial', category: 'other', dispellable: true,
    sealable: false, durationOwner: 'source-turn', refreshPolicy: 'replace', preventsLethalDamage: true });

  const basic: SkillDefinition = { id: xiazhongshaonvIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    useClientDamageData: true, levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== xiazhongshaonvIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense, ratio: Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]),
        defenseIgnore: effectiveDefenseIgnore(actor), dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
      return [{ type: 'deal-damage', source: source(basic.id, actor.unitId), targetId: target.unitId, amount: hit.amount,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
    } };

  const dream: SkillDefinition = { id: xiazhongshaonvIds.dream, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'self', targetRelation: 'ally', levels: dreamRatios.map(threshold => ({ threshold })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== xiazhongshaonvIds.hero || actor.hp <= 0) return [];
      const threshold = Math.max(0, Math.min(1, Number(parameters.threshold ?? dreamRatios[rank(actor, dream.id) - 1])));
      const commands: EffectCommand[] = [];
      for (const ally of context.getLivingUnits(actor.side)) {
        if (ally.unitKind === 'summon') continue;
        const ref = source(dream.id, actor.unitId);
        const recordId = `${xiazhongshaonvIds.dreamRecord}:${actor.unitId}:${ally.unitId}`;
        const guardId = `${xiazhongshaonvIds.dreamGuard}:${actor.unitId}:${ally.unitId}`;
        const values = { recordedHp: ally.hp, threshold };
        commands.push({ type: 'add-status', source: ref, targetId: ally.unitId, instance: { instanceId: recordId,
          statusId: xiazhongshaonvIds.dreamRecord, source: ref, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'source-turn' }, values } });
        commands.push({ type: 'add-status', source: ref, targetId: ally.unitId, instance: { instanceId: guardId,
          statusId: xiazhongshaonvIds.dreamGuard, source: ref, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'source-turn' }, values } });
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: xiazhongshaonvIds.hero, skills: [basic, dream], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入流光按等级100%至125%伤害；溢彩在友方行动前按客户端概率80%提供匣中少女生命上限8%的护盾；回梦消耗3火，记录非召唤友方当前生命，2个匣中少女回合后将低于记录比例的友方恢复到等级阈值，并允许记录中的友方免疫一次致命伤害后立即结算。技能表提供阈值30%/60%等等级值，但等级3参数与相邻等级不单调；受击后施加给攻击者的溢彩减益及溢彩附加状态效果缺少可解码数值，未冒充已实现；回梦冷却、护盾精确时序和标记驱散交互仍需客户端帧核。'],
    handlers: {
      'turn-start': { priority: 46, handle(context, event) { return applyAllyTurnShield(context, event); } },
      hit: { priority: 46, handle(context, event) { return resolveFatalDream(context, event); } },
      'status-expiration': { priority: 46, handle(context, event) { return resolveDreamRecord(context, event); } },
    },
  };
  registry.registerHero(definition);
}

function applyAllyTurnShield(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const ally = context.getUnit(event.unitId);
  if (!ally || ally.hp <= 0 || ally.unitKind === 'summon') return;
  const owners = context.getLivingUnits(ally.side).filter(owner => owner.heroId === xiazhongshaonvIds.hero
    && owner.unitKind !== 'summon' && passivesEnabled(owner));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    if (context.random() >= .8) continue;
    const ref = source(xiazhongshaonvIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source: ref, targetId: ally.unitId, instance: {
      instanceId: `${xiazhongshaonvIds.shield}:${owner.unitId}:${ally.unitId}`, statusId: xiazhongshaonvIds.shield,
      source: ref, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { shieldRemaining: (context.getEffectiveStats(owner.unitId) ?? owner.stats).hp * .08 },
    } });
  }
  return commands.length ? commands : undefined;
}

function resolveFatalDream(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.fatalProtectionStatusId !== xiazhongshaonvIds.dreamGuard) return;
  const ally = context.getUnit(event.targetId);
  const record = ally?.statuses.find(status => status.statusId === xiazhongshaonvIds.dreamRecord);
  if (!ally || !record) return;
  return settleDream(ally, record, event.eventId);
}

function resolveDreamRecord(_context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== xiazhongshaonvIds.dreamRecord || event.reason !== 'expired') return;
  const ally = _context.getUnit(event.targetId);
  const values = event.removedValues;
  if (!ally || !values || typeof values.recordedHp !== 'number' || typeof values.threshold !== 'number') return;
  return settleDream(ally, { source: event.removedSource ?? source(xiazhongshaonvIds.dream, ''), values }, event.eventId);
}

function settleDream(ally: Readonly<UnitState>, record: { source: SourceRef; values?: Readonly<Record<string, number | string | boolean>> }, parentEventId: string): EffectCommand[] {
  const recordedHp = Number(record.values?.recordedHp ?? 0);
  const threshold = Number(record.values?.threshold ?? .3);
  const amount = Math.max(0, recordedHp * threshold - ally.hp);
  const commands: EffectCommand[] = [];
  if (amount > 0 && ally.hp > 0) commands.push({ type: 'restore-health', source: record.source, targetId: ally.unitId, amount, parentEventId });
  commands.push({ type: 'remove-statuses', source: record.source, targetId: ally.unitId,
    statusIds: [xiazhongshaonvIds.dreamRecord, xiazhongshaonvIds.dreamGuard], reason: 'consumed', parentEventId });
  return commands;
}

function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
