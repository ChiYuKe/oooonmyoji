import type { UnitState } from './types';
import type { StatusDefinition } from './definitions';

/** Canonical marker used when a unit's equipped soul effects are sealed. */
export const soulSuppressionStatusId = 'core.soul-suppression';

export const soulSuppressionStatusDefinition: StatusDefinition = {
  id: soulSuppressionStatusId,
  mechanicsCoverage: 'verified',
  category: 'control',
  dispellable: true,
  sealable: false,
  durationOwner: 'target-turn',
  refreshPolicy: 'replace',
};

export function soulsEnabled(unit: Pick<UnitState, 'statuses'>): boolean {
  return !unit.statuses.some(status => status.statusId === soulSuppressionStatusId || status.values?.sealSouls === true);
}
