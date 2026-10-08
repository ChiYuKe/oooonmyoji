import type { CoverageDiagnostic } from '../core/result';
import type { StatusInstance, UnitState } from '../core/types';
import type { ContentRegistry } from './registry';

export interface RosterContentRef {
  heroId: number;
  soulId?: string;
  statuses?: readonly Pick<StatusInstance, 'statusId'>[];
}

export function diagnoseContentCoverage(roster: readonly RosterContentRef[], registry: ContentRegistry): CoverageDiagnostic[] {
  const diagnostics = new Map<string, CoverageDiagnostic>();
  const add = (diagnostic: CoverageDiagnostic): void => {
    const key = `${diagnostic.contentType}:${diagnostic.contentId}:${diagnostic.aspect ?? ''}`;
    if (!diagnostics.has(key)) diagnostics.set(key, diagnostic);
  };
  for (const unit of roster) {
    const hero = registry.getHero(unit.heroId);
    add({ contentType: 'hero', contentId: String(unit.heroId), aspect: 'ai',
      status: hero?.aiCoverage ?? 'unsupported', ...(hero ? hero.aiCoverage === 'unsupported'
        ? { message: '仅有通用基础攻击策略，专属 AI 尚未迁移' } : hero.aiCoverage === 'partial'
          ? { message: hero.aiCoverageNotes?.join('；') ?? '专属选招或目标选择策略仍为启发式，尚未完整验证' }
          : hero.aiCoverage ? {} : { message: '该式神 AI 覆盖状态尚未声明' }
        : { message: '未注册式神 AI 策略' }) });
    add({ contentType: 'hero', contentId: String(unit.heroId), aspect: 'mechanics',
      status: hero?.mechanicsCoverage ?? 'unsupported', ...(hero ? hero.mechanicsCoverage === 'unsupported'
        ? { message: '仅使用通用基础攻击，专属技能与被动尚未迁移' } : hero.mechanicsCoverage === 'partial'
          ? { message: hero.mechanicsCoverageNotes?.join('；') ?? '部分技能、被动或触发边界仍未完整实现或验证' }
          : hero.mechanicsCoverage ? {} : { message: '该式神技能与被动覆盖状态尚未声明' }
        : { message: '未注册式神技能与被动规则' }) });
    if (unit.soulId) {
      const soul = registry.getSoul(unit.soulId);
      add({ contentType: 'soul', contentId: unit.soulId, aspect: 'mechanics',
        status: soul?.mechanicsCoverage ?? 'unsupported',
        ...(soul?.mechanicsCoverage === 'partial' ? { message: soul.mechanicsCoverageNotes?.join('；') ?? '御魂规则尚未覆盖全部触发条件' }
            : soul ? soul.mechanicsCoverage ? {} : { message: '该御魂覆盖状态尚未声明' } : { message: '未注册御魂规则' }) });
    }
    for (const statusInstance of unit.statuses ?? []) {
      const status = registry.getStatus(statusInstance.statusId);
      add({ contentType: 'status', contentId: statusInstance.statusId, aspect: 'mechanics',
        status: status?.mechanicsCoverage ?? 'unsupported', ...(status ? status.mechanicsCoverage === 'partial'
          ? { message: status.mechanicsCoverageNotes?.join('；') ?? '该状态的生命周期或交互边界仍未完整验证' }
          : status.mechanicsCoverage ? {} : { message: '该状态覆盖状态尚未声明' }
          : { message: '未注册状态规则' }) });
    }
  }
  return [...diagnostics.values()];
}

export function isRosterFullyMigrated(roster: readonly RosterContentRef[], registry: ContentRegistry): boolean {
  const diagnostics = diagnoseContentCoverage(roster, registry);
  return diagnostics.length > 0 && diagnostics.every(item => item.status === 'verified');
}

export function rosterRefsFromState(units: readonly UnitState[]): RosterContentRef[] {
  return units.map(unit => ({ heroId: unit.heroId, soulId: unit.soulId,
    statuses: unit.statuses.map(status => ({ statusId: status.statusId })) }));
}
