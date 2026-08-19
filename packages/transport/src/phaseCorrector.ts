import type { AudioTime, MusicalTransport, TransportClockOptions } from './types.ts'

export interface PhaseCorrection {
  origin: MusicalTransport['origin']
  observedBeatIndex: number
  phaseOffsetBeats: number
  phaseOffsetSec: number
  relocked: boolean
  withinWindow: boolean
}

export class PhaseCorrector {
  private readonly relockWindow: number
  private readonly correctionRate: number

  constructor(opts: Required<Pick<TransportClockOptions, 'relockWindow' | 'phaseCorrectionRate'>>) {
    this.relockWindow = opts.relockWindow
    this.correctionRate = opts.phaseCorrectionRate
  }

  evaluate(
    origin: MusicalTransport['origin'],
    bpm: number,
    observedAt: AudioTime
  ): PhaseCorrection {
    const secPerBeat = 60 / bpm
    const elapsed = observedAt - origin.audioTime
    const predictedBeatIndex = origin.beatIndex + elapsed / secPerBeat
    const observedBeatIndex = Math.round(predictedBeatIndex)
    const phaseOffsetBeats = predictedBeatIndex - observedBeatIndex
    const phaseOffsetSec = phaseOffsetBeats * secPerBeat
    const withinWindow = Math.abs(phaseOffsetSec) <= this.relockWindow

    if (withinWindow) {
      if (this.correctionRate > 0 && Math.abs(phaseOffsetSec) > 1e-6) {
        const nudge = phaseOffsetSec * this.correctionRate
        const nudgedOrigin = {
          audioTime: origin.audioTime + nudge,
          beatIndex: observedBeatIndex,
          bpm,
        }
        return {
          origin: nudgedOrigin,
          observedBeatIndex,
          phaseOffsetBeats: phaseOffsetBeats - nudge / secPerBeat,
          phaseOffsetSec: phaseOffsetSec - nudge,
          relocked: false,
          withinWindow: true,
        }
      }
      return {
        origin,
        observedBeatIndex,
        phaseOffsetBeats,
        phaseOffsetSec,
        relocked: false,
        withinWindow: true,
      }
    }

    const relockedOrigin = { audioTime: observedAt, beatIndex: observedBeatIndex, bpm }
    return {
      origin: relockedOrigin,
      observedBeatIndex,
      phaseOffsetBeats,
      phaseOffsetSec,
      relocked: true,
      withinWindow: false,
    }
  }
}
