/**
 * @psy-foundation/learning
 *
 * Contextual learning for the PSY family. CONTEXT + ACTION + OUTCOME + REWARD.
 * DO NOTHING is a legal action. Not a neural net — a contextual bandit with
 * abstention.
 *
 * Modules:
 *  - types.ts             Experience, LearnedRecord, Decision, LearningStats, PolicyOptions
 *  - contextKey.ts        contextKey(ctx, role), actionKey(action) — deterministic fingerprints
 *  - reward.ts            defaultReward, sustainedReward, antiCollisionReward
 *  - store.ts             ExperienceStore — records experiences, aggregates to LearnedRecords
 *  - policy.ts            Policy — epsilon-greedy with abstention (DO NOTHING is legal)
 *  - stats.ts             computeStats — regret, retrieval quality, exploration/abstention rates
 *  - learner.ts           Learner — high-level facade (decide + recordOutcome + stats)
 *  - musical-learning.ts  MusicalLearning — real weighted-preference learning from motif outcomes
 */

export type { Decision, LearnedRecord, LearningStats, PolicyOptions } from './types.ts'
export type { Experience, MusicalAction, MusicalContext, MusicalOutcome } from './types.ts'
export { actionKey, contextKey } from './contextKey.ts'
export type { RewardFunction } from './reward.ts'
export { antiCollisionReward, defaultReward, sustainedReward } from './reward.ts'
export { ExperienceStore } from './store.ts'
export { Policy, bestRecord } from './policy.ts'
export { computeStats } from './stats.ts'
export { Learner } from './learner.ts'

// Musical learning (real weighted preferences, not just counters)
export type {
  LearnedFeature,
  MusicalLearningConfig,
  MusicalLearningObservation,
} from './musical-learning.ts'
export { MusicalLearning, defaultMusicalReward } from './musical-learning.ts'
