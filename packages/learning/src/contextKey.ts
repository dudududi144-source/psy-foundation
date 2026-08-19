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

/** Quantize bpm into 10-bpm bins. */
function bpmBin(bpm: number): number {
  return Math.floor(bpm / 10) * 10
}

/**
 * Build a context key from a MusicalContext.
 * Format: `style|role|section|keyPc|energyBin|bpmBin`
 * The key is coarse on purpose — exact contexts rarely repeat, but similar
 * musical situations do.
 */
export function contextKey(ctx: MusicalContext, role: string): string {
  return [
    ctx.style,
    role,
    ctx.section,
    ctx.rootPc,
    energyBin(ctx.energy),
    bpmBin(ctx.energy), // energy is a proxy for tempo intensity; could be replaced
  ].join('|')
}

/** A shorter action key for storage (the full action is kept too). */
export function actionKey(action: import('@psy-foundation/protocol').MusicalAction): string {
  if (action.type === 'do-nothing') return 'do-nothing'
  if (action.type === 'variation') return `variation:${action.materialId}:${action.transform}`
  return `play:${action.materialId}`
}
