import type { HeroSkill } from '../../../../shared/hero-skills';
import type { HeroProfile, Panel, SuitProfile } from '../../../../shared/soul-optimizer';

export type SideId = 'blue' | 'red';
export type ModStat = 'attack' | 'defense' | 'speed' | 'crit' | 'critDamage' | 'hit' | 'resist' | 'critResist' | 'damage';
export interface ActiveMod { stat: ModStat; amount: number; turns: number; flat?: boolean; source?: string }
export interface StatusTag { name: string; turns: number; absorbRemaining?: number; shieldRemaining?: number; hpReduction?: number; healingReduction?: number; damageReduction?: number; damageTakenIncrease?: number; damageBonus?: number; starfireLevel?: number; fatalPrevented?: boolean; delayedDamage?: { attack: number; crit: number; critDamage: number; skillLevel: number; judgePassive: boolean; ratio: number }; shanfengTear?: { attack: number; ratio: number; defenseIgnore: number; healingReduction: number }; sugarOwnerId?: number; sugarHeals?: number; actionImmunity?: boolean; foxSeal?: { attack: number }; redMapleDoll?: { attack: number; ratio: number; curseRatio: number; curseChance: number } }
export type Control = '眩晕' | '冰冻' | '睡眠' | '沉默' | '混乱' | '嘲讽' | '封印';
export interface BattleFighterInput { heroId: number | null; fourSuit: string; skillLevel: number; panel: Panel | null }
export interface DuelBattleInput { blue: BattleFighterInput[]; red: BattleFighterInput[] }
export type FighterInput = BattleFighterInput;
export type DuelState = DuelBattleInput;
export interface OrbMeter { progress: number; nextSupply: number }

export interface Fighter extends Panel {
  heroId: number; name: string; hpNow: number; side: SideId; fourSuit: string; skillLevel: number; skills: HeroSkill[];
  control: Control | null; controlTurns: number; shield: number; effects: ActiveMod[]; tags: StatusTag[]; gauge: number;
  starfireOpeningSpeedPending: boolean; swiftWindValue: number; swiftWindCritDamage: number; shanfengCritAdvanceUsed: boolean;
  shanfengBeastTurns: number; herbs: number; carrots: number; frogCooldown: number; foodStacks: number; remnantFlame: number;
  herbHealBonus: number; herbHealBonusTurns: number; harmony: number; harmonyProgress: number; harmonyAllies: Fighter[]; opponents: Fighter[];
  talismans: number; spellUsed: boolean; dealtDamageThisTurn: boolean; guardedAttack: boolean; guardedTarget?: Fighter; guardOwner?: Fighter;
  heartFlames: number; foxLastTarget?: Fighter; foxSameTargetCount: number; hiddenIntentTarget?: Fighter; hiddenIntentStep: number;
  bladeStacks: number; fiveMountainAttackCount: number; fiveMountainDefenseIgnoreStacks: number; bellDivineFire: boolean;
  bellFireReady: boolean; bellFireCooldown: number; bellEternalFlame: boolean; catTeacherOnceAvailable: boolean; catTeacherKnockbackNext: boolean;
  oniStanceTurns: number; oniStanceEnteredThisTurn: boolean; oniStanceDamage: number; divinePower: number; birdDamageBonus: number;
  permanentDamageBonus: number; woodCharmTriggered: boolean; mikuOpeningUsed: boolean; mikuRhythm: number; cloudYang: boolean;
  cloudYinHp: number; cloudYangHp: number; cloudFlipCost: number; inabaWishPower: number; inabaWishProvided: number;
  vigilanceLayers: number; shinkenBondUsed: boolean; bondedAlly?: Fighter; bondColor?: '赤' | '青'; bondOwnerBoostUsed: boolean;
  bondTargetBoostUsed: boolean; lostHpTotal: number; maxHpBonus: number; flowerExtraTurnUsed: boolean; himeFireTriggeredThisAction: boolean;
}

export type { HeroProfile, Panel, SuitProfile };
