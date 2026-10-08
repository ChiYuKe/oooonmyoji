import { soulCatalog } from '../../../../shared/soul-catalog-data';
import type { CoverageDiagnostic } from '../engine/core/result';

/** Returns a prominent caveat when a lineup contains rules that can materially skew simulated odds. */
export function predictionCoverageWarning(diagnostics: readonly CoverageDiagnostic[]): string | undefined {
  const uncovered = diagnostics.filter(item => item.status !== 'verified');
  if (uncovered.length === 0) return undefined;

  const incompleteHeroes = new Set(uncovered
    .filter(item => item.contentType === 'hero')
    .map(item => item.contentId));
  const unsupportedHeroes = new Set(uncovered
    .filter(item => item.contentType === 'hero' && item.status === 'unsupported')
    .map(item => item.contentId));
  if (incompleteHeroes.size > 0) {
    const names = new Map(soulCatalog.heroes.map(hero => [String(hero.id), hero.name]));
    const heroNames = [...incompleteHeroes].map(id => names.get(id) ?? id).join('、');
    const otherRules = uncovered.filter(item => item.contentType !== 'hero').length;
    const unmigrated = unsupportedHeroes.size > 0 ? `，其中 ${unsupportedHeroes.size} 名式神的专属规则尚未迁移` : '';
    const otherSummary = otherRules > 0 ? `，另有 ${otherRules} 项御魂或状态规则未完整验证` : '';
    const directionalRisk = unsupportedHeroes.size > 0 ? '，结果可能与游戏胜负相反' : '，结果方向仍可能偏离实战';
    return `本阵容有 ${incompleteHeroes.size} 名式神的 AI 或技能机制未完整验证（${heroNames}）${unmigrated}${otherSummary}。上方胜率只代表当前模拟模型，不是实战概率${directionalRisk}。`;
  }

  return '本阵容仍有部分式神、御魂或状态规则未完整验证。上方胜率只代表当前模拟模型，不是实战概率。';
}
