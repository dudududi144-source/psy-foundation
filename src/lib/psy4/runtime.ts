/**
 * Psy4Runtime — the WHEN/HOW layer.
 *
 * Owns: AudioContext, Transport, scheduler, synthesis, mixer, FX.
 * Does NOT own: composition decisions, harmony, groove, motifs.
 *
 * Flow:
 *   Foundation CompositionEngine → ComposedSection
 *   → FoundationMusicAdapter → PerformanceEvent[]
 *   → Psy4Runtime scheduler → AudioContext → speakers
 */

import { Transport } from '@/foundation/transport'
import { CompositionEngine } from '@/foundation/music'
import { CompositionAdaptation } from '@/foundation/music'
import type { ComposedSection, MusicalContext, AdaptedCompositionIntent, RadioMusicalContext } from '@/foundation/music'
import { FoundationMusicAdapter, buildRadioMusicalContext, type PerformanceEvent, type AdaptedSection } from './foundation-music-adapter.ts'

export interface Psy4State {
  playing: boolean
  bpm: number
  beat: number
  bar: number
  epoch: number
  style: string
  arrangementState: string
  activeRoles: string[]
  radioConnected: boolean
  radioInfluence: string
  eventsScheduled: number
  eventsPlayed: number
}

export class Psy4Runtime {
  private ctx: AudioContext | null = null
  private transport: Transport | null = null
  private engine: CompositionEngine | null = null
  private adapter: FoundationMusicAdapter
  private adaptation: CompositionAdaptation

  // Audio graph
  private masterGain: GainNode | null = null
  private kickBus: GainNode | null = null
  private bassBus: GainNode | null = null
  private leadBus: GainNode | null = null
  private percBus: GainNode | null = null
  private fxBus: GainNode | null = null
  private radioBus: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private delayNode: DelayNode | null = null
  private delayFeedback: GainNode | null = null

  // Scheduler
  private schedulerTimer: ReturnType<typeof setInterval> | null = null
  private nextEventIdx = 0
  private currentEvents: PerformanceEvent[] = []
  private currentBar = 0
  private lastRecomposedBar = -1

  // State
  private style = 'full-on'
  private seed = 42
  private playing = false
  private radioData: RadioMusicalContext | null = null
  private currentIntent: AdaptedCompositionIntent | null = null

  // Callbacks
  private stateCallback: ((state: Psy4State) => void) | null = null

  constructor() {
    this.adapter = new FoundationMusicAdapter()
    this.adaptation = new CompositionAdaptation()
  }

  onStateChange(cb: (state: Psy4State) => void): void {
    this.stateCallback = cb
  }

  async play(): Promise<void> {
    if (this.playing) return
    this.ensureAudio()
    if (!this.ctx) return

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    // Initialize Transport
    if (!this.transport) {
      this.transport = new Transport(() => this.ctx!.currentTime, { initialBpm: 145 })
    }
    this.transport.start()

    // Initialize CompositionEngine
    if (!this.engine) {
      const context = this.buildMusicalContext()
      this.engine = new CompositionEngine({ seed: this.seed, context })
    }

    // Compose first section
    this.recompose()

    this.playing = true
    this.startScheduler()
    this.emitState()
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }
    this.transport?.stop()
    this.emitState()
  }

  setStyle(style: string): void {
    this.style = style
    // Force recomposition on next phrase boundary
    this.lastRecomposedBar = -1
  }

  setSeed(seed: number): void {
    this.seed = seed
    if (this.engine) {
      const context = this.buildMusicalContext()
      this.engine = new CompositionEngine({ seed, context })
    }
    this.lastRecomposedBar = -1
  }

  updateRadio(radio: RadioMusicalContext | null): void {
    this.radioData = radio
    // Adaptation happens at phrase boundary, not immediately
  }

  private ensureAudio(): void {
    if (this.ctx) return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()

    // Build audio graph
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 0.7

    this.kickBus = this.ctx.createGain()
    this.bassBus = this.ctx.createGain()
    this.leadBus = this.ctx.createGain()
    this.percBus = this.ctx.createGain()
    this.fxBus = this.ctx.createGain()
    this.radioBus = this.ctx.createGain()

    // Delay
    this.delayNode = this.ctx.createDelay(1.0)
    this.delayNode.delayTime.value = 0.375 // dotted eighth at 145bpm
    this.delayFeedback = this.ctx.createGain()
    this.delayFeedback.gain.value = 0.35

    // Analyser
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 512

    // Connect buses → master
    this.kickBus.connect(this.masterGain)
    this.bassBus.connect(this.masterGain)
    this.leadBus.connect(this.masterGain)
    this.percBus.connect(this.masterGain)
    this.radioBus.connect(this.masterGain)

    // Delay send
    this.leadBus.connect(this.delayNode)
    this.delayNode.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delayNode)
    this.delayNode.connect(this.fxBus)
    this.fxBus.connect(this.masterGain)

    // Master → analyser → destination
    this.masterGain.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  private buildMusicalContext(): MusicalContext {
    const styleMap: Record<string, { density: number; energy: number; tension: number; octave: number }> = {
      'full-on': { density: 0.8, energy: 0.8, tension: 0.3, octave: 4 },
      progressive: { density: 0.5, energy: 0.6, tension: 0.2, octave: 4 },
      dark: { density: 0.6, energy: 0.7, tension: 0.6, octave: 3 },
      acid: { density: 0.7, energy: 0.75, tension: 0.4, octave: 4 },
    }
    const s = styleMap[this.style] ?? styleMap['full-on']
    return {
      tonic: 4,
      scaleName: 'phrygian-dominant',
      octave: s.octave,
      bpm: 145,
      beatsPerBar: 4,
      beatPosition: 0,
      barPosition: 0,
      phrasePosition: 0,
      harmonicContext: [],
      density: s.density,
      energy: s.energy,
      tension: s.tension,
      sectionRole: 'ESTABLISH',
      repetitionPressure: 0.3,
      noveltyPressure: 0.5,
    }
  }

  private recompose(): void {
    if (!this.engine || !this.transport) return
    const snap = this.transport.snapshot()

    // Compose 32 bars ahead
    const section = this.engine.composeSection({ bars: 32 })

    // Build adaptation if radio is present
    if (this.radioData && this.radioData.available) {
      const opportunities = buildOpportunityMap(this.radioData)
      this.currentIntent = this.adaptation.adapt({
        baseContext: this.buildMusicalContext(),
        radio: this.radioData,
        opportunities,
        currentBar: this.currentBar,
        phraseBar: this.currentBar % 8,
      })
    } else {
      this.currentIntent = undefined
    }

    // Adapt section through adapter
    const adapted = this.adapter.adaptSection(
      section,
      { bpm: snap.bpm, beatDuration: snap.beatDuration, beatTime: snap.beatTime, beatIndex: snap.beatIndex },
      this.currentIntent ?? undefined,
    )

    this.currentEvents = adapted.events
    this.nextEventIdx = 0
    this.lastRecomposedBar = this.currentBar
  }

  private startScheduler(): void {
    const lookahead = 25 // ms
    const scheduleAhead = 0.15 // seconds
    this.schedulerTimer = setInterval(() => this.scheduler(), lookahead)
  }

  private scheduler(): void {
    if (!this.ctx || !this.transport || !this.playing) return

    const now = this.ctx.currentTime
    const snap = this.transport.snapshot()
    this.currentBar = snap.bar

    // Check if we need to recompose (every 16 bars = 2 phrases)
    if (this.currentBar >= this.lastRecomposedBar + 16) {
      this.recompose()
    }

    // Schedule events that fall within the lookahead window
    while (this.nextEventIdx < this.currentEvents.length) {
      const event = this.currentEvents[this.nextEventIdx]
      if (!event) break

      // Convert beat-grid time to AudioContext time
      const eventTime = snap.beatTime + (event.provenance.bar * snap.beatsPerBar * 4 + event.provenance.step) * (snap.beatDuration / 4) - snap.beatTime + snap.timestamp

      if (eventTime < now) {
        // Past event — skip
        this.nextEventIdx++
        continue
      }

      if (eventTime > now + 0.15) {
        // Too far ahead — wait
        break
      }

      // Schedule the event
      this.scheduleEvent(event, eventTime)
      this.nextEventIdx++
    }

    this.emitState()
  }

  private scheduleEvent(event: PerformanceEvent, time: number): void {
    if (!this.ctx) return

    switch (event.role) {
      case 'kick':
        this.synthKick(time, event.velocity)
        break
      case 'bass':
        this.synthBass(time, event.pitch, event.duration, event.velocity)
        break
      case 'lead':
        this.synthLead(time, event.pitch, event.duration, event.velocity)
        break
      case 'hats':
        this.synthHat(time, event.velocity)
        break
    }
  }

  private synthKick(time: number, vel: number): void {
    if (!this.ctx || !this.kickBus) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.frequency.setValueAtTime(150, time)
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.1)
    gain.gain.setValueAtTime(vel * 0.8, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15)
    osc.connect(gain)
    gain.connect(this.kickBus)
    osc.start(time)
    osc.stop(time + 0.15)
  }

  private synthBass(time: number, midi: number, dur: number, vel: number): void {
    if (!this.ctx || !this.bassBus) return
    const freq = 440 * Math.pow(2, (midi - 69) / 12)
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    const filter = this.ctx.createBiquadFilter()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(800, time)
    filter.frequency.exponentialRampToValueAtTime(200, time + dur * 0.8)
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(vel * 0.5, time + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur)
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(this.bassBus)
    osc.start(time)
    osc.stop(time + dur)
  }

  private synthLead(time: number, midi: number, dur: number, vel: number): void {
    if (!this.ctx || !this.leadBus) return
    const freq = 440 * Math.pow(2, (midi - 69) / 12)
    const osc = this.ctx.createOscillator()
    const osc2 = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    const filter = this.ctx.createBiquadFilter()
    osc.type = 'sawtooth'
    osc2.type = 'sawtooth'
    osc.frequency.value = freq
    osc2.frequency.value = freq * 1.005 // slight detune
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(3000, time)
    filter.frequency.exponentialRampToValueAtTime(800, time + dur)
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(vel * 0.3, time + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur)
    osc.connect(filter)
    osc2.connect(filter)
    filter.connect(gain)
    gain.connect(this.leadBus)
    osc.start(time)
    osc2.start(time)
    osc.stop(time + dur)
    osc2.stop(time + dur)
  }

  private synthHat(time: number, vel: number): void {
    if (!this.ctx || !this.percBus) return
    const bufferSize = this.ctx.sampleRate * 0.05
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 7000
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(vel * 0.15, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.percBus)
    source.start(time)
  }

  private emitState(): void {
    if (!this.stateCallback || !this.transport) return
    const snap = this.transport.snapshot()
    this.stateCallback({
      playing: this.playing,
      bpm: snap.bpm,
      beat: snap.beat,
      bar: snap.bar,
      epoch: snap.epoch,
      style: this.style,
      arrangementState: this.currentEvents[this.nextEventIdx - 1]?.provenance.arrangementState ?? '—',
      activeRoles: Array.from(this.adapter.getCachedEvents().length > 0
        ? new Set(this.currentEvents.slice(0, 20).map(e => e.role))
        : []),
      radioConnected: this.radioData?.available ?? false,
      radioInfluence: this.currentIntent
        ? `bass=${this.currentIntent.bassPressure.toFixed(2)} lead=${this.currentIntent.leadPressure.toFixed(2)} rest=${this.currentIntent.restPressure.toFixed(2)}`
        : 'none',
      eventsScheduled: this.currentEvents.length,
      eventsPlayed: this.nextEventIdx,
    })
  }

  dispose(): void {
    this.stop()
    if (this.ctx) {
      this.ctx.close()
      this.ctx = null
    }
  }
}
