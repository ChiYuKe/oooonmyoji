import type { Panel } from '../../../../shared/soul-optimizer';
export type { SideId } from './core/types';

export interface BattleFighterInput { heroId: number | null; fourSuit: string; skillLevel: number; panel: Panel | null;
  points?: readonly number[]; skillLevels?: Readonly<Record<string, number>>;
  unitKind?: import('./core/types').UnitKind; awakeFilter?: number;
  damageAttributes?: Readonly<import('./core/types').DamageAttributes>; extHp?: number }
export interface DuelBattleInput { blue: BattleFighterInput[]; red: BattleFighterInput[] }
export type FighterInput = BattleFighterInput;
export type DuelState = DuelBattleInput;

export type { Panel };
