/**
 * Learning statistics — regret, retrieval quality, exploration/abstention rates.
 *
 * These are the metrics the benchmark-lab (M6) will surface. They let us
 * answer "is the system actually learning?" with numbers, not claims.
 */

import { bestRecord } from './policy.ts'
import type { ExperienceStore } from './store.ts'
import type { Decision, LearningStats } from './types.ts'

/**
 * Compute learning stats.
 *
 * @param store the experience store
 * @param decisions the recent decisions (for exploration/abstention/retrieval rates)
 */
export function computeStats(store: ExperienceStore, decisions: Decision[]): LearningStats {
  const experiences = store.allExperiences()
  const totalExperiences = experiences.length
  const uniqueRecords = store.uniqueRecords

  const explorationRate =
    decisions.length === 0
      ? 0
      : decisions.filter((d) => d.reason === 'explore').length / decisions.length
  const abstentionRate =
    decisions.length === 0
      ? 0
      : decisions.filter((d) => d.reason === 'abstain').length / decisions.length
  const retrievalQuality =
    decisions.length === 0
      ? 0
      : decisions.filter((d) => d.record !== null).length / decisions.length

  const averageReward =
    totalExperiences === 0
      ? 0
      : experiences.reduce((sum, e) => sum + e.reward, 0) / totalExperiences

  // Regret: for each context, the gap between the best action's avg reward
  // and the average reward actually achieved in that context.
  // We group by the contextKey of records and compute the weighted gap.
  // Simpler regret: average over all records of (best record avg - this record avg),
  // weighted by trials. This measures how much we lose by not always picking the best.
  let regret = 0
  const records = store.allRecords()
  const byContext = new Map<string, typeof records>()
  for (const rec of records) {
    const arr = byContext.get(rec.contextKey) ?? []
    arr.push(rec)
    byContext.set(rec.contextKey, arr)
  }
  let totalWeight = 0
  for (const [, recs] of byContext) {
    const best = bestRecord(recs)
    if (!best) continue
    for (const rec of recs) {
      const gap = best.avgReward - rec.avgReward
      regret += gap * rec.trials
      totalWeight += rec.trials
    }
  }
  regret = totalWeight > 0 ? regret / totalWeight : 0

  return {
    totalExperiences,
    uniqueRecords,
    explorationRate,
    abstentionRate,
    averageReward,
    regret,
    retrievalQuality,
  }
}
