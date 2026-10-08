import type { ContentRegistry } from './registry';
import type { DamageInterception, RuleHandler } from '../core/definitions';
import { soulsEnabled } from '../core/soul-eligibility';
import type { SourceRef, StatusInstance } from '../core/types';

export const oceanAtlasIds = {
  soul: 'soul:300093',
  seaChartGuard: 'status.soul.300093.sea-chart-guard',
} as const;

const settleGuardLoss: RuleHandler = (_context, event) => {
  const sourceUnitId = event.type === 'status-removed' ? event.removedSource?.unitId : undefined;
  if (event.type !== 'status-removed' || event.statusId !== oceanAtlasIds.seaChartGuard
    || event.reason === 'replaced' || event.removedSource?.id !== oceanAtlasIds.soul || !sourceUnitId) return;
  const recorded = event.removedValues?.recordedLifeLoss;
  if (typeof recorded !== 'number' || !Number.isFinite(recorded) || recorded <= 0) return;
  return [{ type: 'lose-life', source: soulSource(sourceUnitId), targetId: event.targetId,
    amount: recorded, lifeLossKind: 'direct', parentEventId: event.eventId }];
};

/** 奉海图 protects allies from an attack now, then settles the recorded loss when the guard disappears. */
export function registerOceanAtlas(registry: ContentRegistry): void {
  registry.registerStatus({ id: oceanAtlasIds.seaChartGuard, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace',
    mechanicsCoverageNotes: ['持续1回合；消失时结算被延后的生命损失。驱散属性、死亡时结算和多段攻击重置回合边界待帧核'] });
  registry.registerSoul({
    id: oceanAtlasIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['客户端御魂表记载唯一效果：友方受攻击获得1回合海图守护；每次攻击伤害降低30%，单次减伤不超过携带者生命上限35%，并记录该减伤值；海图守护消失时失去等同记录值的生命。当前按每次命中削减并累计记录，状态刷新时保留已有记录，状态过期/驱散/消耗时以直接生命损失结算；多段攻击持续时间刷新、携带者阵亡与封印边界仍待帧核'],
    interceptIncomingDamage(state, attacker, target, amount): DamageInterception | undefined {
      if (!attacker || attacker.side === target.side || amount <= 0) return undefined;
      const carrier = state.sides[target.side].map(unitId => state.units[unitId])
        .find(unit => unit && unit.hp > 0 && unit.soulId === oceanAtlasIds.soul && soulsEnabled(unit));
      if (!carrier) return undefined;
      const source = soulSource(carrier.unitId);
      const previous = target.statuses.find(status => status.statusId === oceanAtlasIds.seaChartGuard
        && status.source.unitId === carrier.unitId);
      const reduction = Math.min(amount * .3, carrier.stats.hp * .35);
      if (reduction <= 0) return undefined;
      const instance: StatusInstance = { instanceId: `${oceanAtlasIds.seaChartGuard}:${carrier.unitId}:${target.unitId}`,
        statusId: oceanAtlasIds.seaChartGuard, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        values: { recordedLifeLoss: Number(previous?.values?.recordedLifeLoss ?? 0) + reduction } };
      return { amount: Math.max(0, amount - reduction), effects: [{ type: 'add-status', source, targetId: target.unitId, instance }] };
    },
    handlers: {
      'effect-resolution': { priority: 40, handle: settleGuardLoss },
      'status-expiration': { priority: 40, handle: settleGuardLoss },
    },
  });
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: oceanAtlasIds.soul, unitId };
}
