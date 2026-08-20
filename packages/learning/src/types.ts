/**
 * Learning types.
 *
 * The learning system follows the CONTEXT + ACTION + OUTCOME + REWARD model.
 * It is a contextual bandit with abstention — NOT a neural net. The goal is
 * structured learning: "in context X, action Y produced reward Z".
 *
 * DO NOTHING is always a legal action (the system can choose to stay silent).
 * This is critical for musical intelligence: sometimes the best move is not to
 * play.
 */

import type {
  Experience,
  MusicalAction,
  MusicalContext,
  MusicalOutcome,
} from '@psy-foundation/protocol'

export type { Experience, MusicalAction, MusicalContext, MusicalOutcome }

/** A learned record: aggregate of experiences for a (context-key, action) pair. */
export interface LearnedRecord {
  /** Context key (a string fingerprint of the musical context). */
  contextKey: string
  /** Action that was taken (serialized). */
  actionKey: string
  /** The action payload (for replay). */
  action: MusicalAction
  /** Number of times this action was tried in this context. */
  trials: number
  /** Cumulative reward. */
  totalReward: number
  /** Average reward (totalReward / trials). */
  avgReward: number
  /** Number of times the outcome was 'sounded' (actually played). */
  soundedCount: number
  /** Number of times the outcome was 'skipped'. */
  skippedCount: number
  /** Number of times the outcome was 'collided'. */
  collidedCount: number
  /** Last audio-time this record was updated. */
  lastUpdated: number
}

/** A decision the policy returns. */
export interface Decision {
  /** The chosen action. */
  action: MusicalAction
  /** Why this action was chosen. */
  reason: 'exploit' | 'explore' | 'abstain' | 'cold-start'
  /** The record backing the decision, or null for cold-start / abstain. */
  record: LearnedRecord | null
  /** Confidence 0..1 in this decision. */
  confidence: number
}

/** Statistics over the learning system. */
export interface LearningStats {
  /** Total experiences recorded. */
  totalExperiences: number
  /** Total unique (context, action) pairs. */
  uniqueRecords: number
  /** Fraction of decisions that were 'explore' (exploration rate). */
  explorationRate: number
  /** Fraction of decisions that were 'abstain' (do-nothing rate). */
  abstentionRate: number
  /** Average reward across all experiences. */
  averageReward: number
  /** Regret: (best possible avg reward) - (actual avg reward), per context. */
  regret: number
  /** Retrieval quality: fraction of decisions that had a non-cold-start record. */
  retrievalQuality: number
}

/** Options for the learning policy. */
export interface PolicyOptions {
  /** Exploration rate (epsilon) 0..1. Default 0.1. */
  epsilon?: number
  /** Min trials before exploiting (avoid noise). Default 3. */
  minTrials?: number
  /** Abstention threshold: if best avg reward < this, do nothing. Default 0.1. */
  abstainThreshold?: number
  /** Confidence boost per trial (asymptotic). Default 0.1. */
  confidenceGrowth?: number
}
