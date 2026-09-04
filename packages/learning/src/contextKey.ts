/**
 * Context key — a deterministic fingerprint of a musical context.
 *
 * Two contexts with the same key should be musically interchangeable: same
 * energy bin, same style, same role, same key compatibility. This lets the
 * learning system generalize across sessions.
 */

import type { MusicalContext } from '@psy-foundation/protocol'

/** Quantize energy into 5 bins so similar contexts map to the same key. */
function energyBin(energy: number): number {
  return Math.min(4, Math.floor(energy * 5))
}

/**
 * Build a context key from a MusicalContext.
 * Format: `style|role|section|keyPc|energyBin`
 * The key is coarse on purpose — exact contexts rarely repeat, but similar
 * musical situations do.
 *
 * Phase 2 honesty (D8.2): the former `bpmBin(ctx.energy)` term is REMOVED.
 * It binned BPM from ENERGY — but `MusicalContext` has no bpm field, so the
 * term was a fabricated measurement (energy relabeled as tempo). Removing it
 * changes every bandit state key → prior learned state is intentionally
 * invalidated. Honesty over compatibility.
 */
export function contextKey(ctx: MusicalContext, role: string): string {
  return [ctx.style, role, ctx.section, ctx.rootPc, energyBin(ctx.energy)].join('|')
}

/** A shorter action key for storage (the full action is kept too). */
export function actionKey(action: import('@psy-foundation/protocol').MusicalAction): string {
  if (action.type === 'do-nothing') return 'do-nothing'
  if (action.type === 'variation') return `variation:${action.materialId}:${action.transform}`
  return `play:${action.materialId}`
}
