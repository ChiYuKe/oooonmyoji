import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const nightTearStoneIds = {
  soul: 'soul:300058',
  initialStats: 'status.soul.300058.initial-stats',
  growth: 'status.soul.300058.growth',
  maxHpAdjustment: 'status.soul.300058.max-hp-adjustment',
} as const;

/** 夜啼石 gains capped temporary stats when a non-summon ally is defeated. */
export function registerNightTearStone(registry: ContentRegistry): void {
  registry.registerStatus({ id: nightTearStoneIds.initialStats, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: nightTearStoneIds.growth, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', maxStacks: 5,
    mechanicsCoverageNotes: ['夜啼石成长最多5层，攻击/防御按阵亡友方式神初始属性叠加；生命上限随同状态到期或驱散时回退'] });
  registry.registerStatus({ id: nightTearStoneIds.maxHpAdjustment, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerSoul({
    id: nightTearStoneIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['唯一效果；友方非召唤物阵亡时，携带者获得阵亡目标初始攻击、防御、生命上限各30%的成长，持续2个携带者回合，最多5层且各属性不超过携带者初始属性的150%。暂按存活的首位携带者承接唯一效果；御魂携带者阵亡后的唯一效果转移、叠层刷新窗口及临时生命上限到期规则仍需帧核'],
    initialize(context, unitId) {
      const wearer = context.getUnit(unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== nightTearStoneIds.soul) return [];
      const carrier = context.getLivingUnits(wearer.side).find(unit => unit.soulId === nightTearStoneIds.soul);
      if (carrier?.unitId !== wearer.unitId || !soulsEnabled(wearer)) return [];
      return context.getLivingUnits(wearer.side).filter(ally => ally.unitKind !== 'summon')
        .map(ally => initialStatsStatus(wearer.unitId, ally));
    },
    handlers: {
      'unit-defeated': { priority: 35, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const defeated = context.getUnit(event.unitId);
        if (!defeated || defeated.unitKind === 'summon') return;
        const wearer = context.getLivingUnits(defeated.side).find(unit => unit.soulId === nightTearStoneIds.soul
          && soulsEnabled(unit));
        if (!wearer || wearer.hp <= 0) return;
        const deadBase = initialStats(defeated);
        const wearerBase = initialStats(wearer);
        if (!deadBase || !wearerBase) return;
        return addGrowth(wearer, deadBase, wearerBase, event.eventId);
      } },
      'status-expiration': { priority: 35, handle: removeGrowthHp },
      'effect-resolution': { priority: 35, handle: removeGrowthHp },
    },
  });
}

function initialStatsStatus(ownerId: string, ally: Readonly<UnitState>): EffectCommand {
  const source = soulSource(ownerId);
  const instance: StatusInstance = { instanceId: `${nightTearStoneIds.initialStats}:${ownerId}:${ally.unitId}`,
    statusId: nightTearStoneIds.initialStats, source, stacks: 1, duration: { kind: 'permanent' },
    values: { attack: ally.stats.attack, defense: ally.stats.defense, hp: ally.stats.hp } };
  return { type: 'add-status', source, targetId: ally.unitId, instance };
}

function initialStats(unit: Readonly<UnitState>): { attack: number; defense: number; hp: number } | undefined {
  const baseline = unit.statuses.find(status => status.statusId === nightTearStoneIds.initialStats);
  if (!baseline) return undefined;
  const attack = Number(baseline.values?.attack);
  const defense = Number(baseline.values?.defense);
  const hp = Number(baseline.values?.hp);
  return Number.isFinite(attack) && Number.isFinite(defense) && Number.isFinite(hp) ? { attack, defense, hp } : undefined;
}

function addGrowth(wearer: Readonly<UnitState>, dead: { attack: number; defense: number; hp: number },
  base: { attack: number; defense: number; hp: number }, parentEventId: string): EffectCommand[] {
  const previous = wearer.statuses.find(status => status.statusId === nightTearStoneIds.growth);
  const previousAttack = Number(previous?.modifiers?.find(modifier => modifier.stat === 'attack')?.amount ?? 0);
  const previousDefense = Number(previous?.modifiers?.find(modifier => modifier.stat === 'defense')?.amount ?? 0);
  const previousHp = Number(previous?.values?.hpBonus ?? 0);
  const canGainStack = (previous?.stacks ?? 0) < 5;
  const attackBonus = Math.min(base.attack * 1.5, previousAttack + (canGainStack ? dead.attack * .3 : 0));
  const defenseBonus = Math.min(base.defense * 1.5, previousDefense + (canGainStack ? dead.defense * .3 : 0));
  const hpBonus = Math.min(base.hp * 1.5, previousHp + (canGainStack ? dead.hp * .3 : 0));
  const source = soulSource(wearer.unitId);
  const instance: StatusInstance = { instanceId: `${nightTearStoneIds.growth}:${wearer.unitId}`,
    statusId: nightTearStoneIds.growth, source, stacks: Math.min(5, (previous?.stacks ?? 0) + 1),
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'attack', operation: 'flat', amount: attackBonus },
      { stat: 'defense', operation: 'flat', amount: defenseBonus }],
    values: { hpBonus } };
  const commands: EffectCommand[] = [];
  const addedHp = hpBonus - previousHp;
  if (addedHp > 0) commands.push({ type: 'increase-max-health', source, targetId: wearer.unitId,
    amount: addedHp, parentEventId });
  commands.push({ type: 'add-status', source, targetId: wearer.unitId, instance, parentEventId });
  return commands;
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: nightTearStoneIds.soul, unitId };
}

function removeGrowthHp(_context: import('../core/types').BattleContext, event: import('../core/types').BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== nightTearStoneIds.growth || event.reason === 'replaced') return;
  const hpBonus = Number(event.removedValues?.hpBonus ?? 0);
  if (hpBonus <= 0) return;
  return [{ type: 'reduce-max-health', source: event.source, targetId: event.targetId,
    amount: hpBonus, minimumRatio: 0, statusId: nightTearStoneIds.maxHpAdjustment, parentEventId: event.eventId }];
}
