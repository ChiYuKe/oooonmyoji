import type { SoulDefinition } from '../core/definitions';
import type { SourceRef, UnitState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';
import type { ContentRegistry } from './registry';

export const flyingEdgeIds = { soul: 'soul:300073' } as const;

/** 飞缘魔四件套：附加负面状态时，无视目标30%总效果抵抗。 */
export function registerFlyingEdge(registry: ContentRegistry): void {
  const definition: SoulDefinition = {
    id: flyingEdgeIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['四件套附加负面状态时无视目标30%总效果抵抗，已接入通用减益/控制命中与雪女减速判定；二件套效果命中属性由阵容面板提供。'],
  };
  registry.registerSoul(definition);
}

/** Returns the target resistance after applying eligible source-side soul effects. */
export function effectiveTargetResistance(targetResist: number, source: SourceRef,
  getUnit: (unitId: string) => UnitState | undefined, additionalIgnore = 0): number {
  const wearer = source.unitId ? getUnit(source.unitId) : undefined;
  const soulIgnore = wearer?.soulId === flyingEdgeIds.soul && soulsEnabled(wearer) ? .3 : 0;
  const skillIgnore = Number.isFinite(additionalIgnore) ? Math.max(0, Math.min(1, additionalIgnore)) : 0;
  const ignore = 1 - (1 - soulIgnore) * (1 - skillIgnore);
  return Math.min(.95, Math.max(0, targetResist) * (1 - ignore));
}
