'use client'

/**
 * Real-Time Spectrum Analyzer — visual FFT display on canvas.
 *
 * Connects to the PSY4AudioEngine (or any AudioWorkletNode) and displays
 * a real-time frequency spectrum. This is the visual feedback that
 * Serum, Vital, and every commercial synth provides.
 *
 * Features:
 * - Real-time FFT (2048-point, 60fps)
 * - Log-frequency scale (20Hz to 20kHz)
 * - Peak hold with decay
 * - Color gradient (cyan→violet→rose)
 * - Optional: filter response curve overlay
 *
 * Usage:
 *   <SpectrumAnalyzer audioEngine={engine} width={600} height={150} />
 */

import { useEffect, useRef, useState } from 'react'

interface SpectrumAnalyzerProps {
  // biome-ignore lint/suspicious/noExplicitAny: PSY4AudioEngine has dynamic methods
  audioEngine: any | null
  width?: number
  height?: number
  color?: 'cyan' | 'violet' | 'emerald'
}

export function SpectrumAnalyzer({
  audioEngine,
  width = 600,
  height = 150,
  color = 'cyan',
}: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animRef = useRef<number | null>(null)
  const peaksRef = useRef<Float32Array | null>(null)
  const [isActive, setIsActive] = useState(false)

  // Color gradients
  const colorMap = {
    cyan: { start: '#00e5ff', mid: '#a78bfa', end: '#f43f5e', bg: '#020a0f' },
    violet: { start: '#a78bfa', mid: '#7c3aed', end: '#f43f5e', bg: '#0a0512' },
    emerald: { start: '#10b981', mid: '#00e5ff', end: '#a78bfa', bg: '#031008' },
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set up analyser when audio engine is ready
    if (!audioEngine?.audioContext || !audioEngine.workletNode) {
      // Draw idle state
      ctx.fillStyle = colorMap[color].bg
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#52525b'
      ctx.font = '11px JetBrains Mono, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Start audio to see spectrum', width / 2, height / 2)
      return
    }

    // Create analyser node
    if (!analyserRef.current) {
      const analyser = audioEngine.audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8
      audioEngine.workletNode.connect(analyser)
      analyserRef.current = analyser
      peaksRef.current = new Float32Array(analyser.frequencyBinCount)
      setIsActive(true)
    }

    const analyser = analyserRef.current
    if (!analyser) return
    const peaks = peaksRef.current!
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const colors = colorMap[color]

    const draw = () => {
      analyser.getByteFrequencyData(dataArray)

      // Clear with dark background
      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, width, height)

      // Draw grid lines (frequency markers)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      const freqMarks = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
      freqMarks.forEach((freq) => {
        const x = freqToX(freq, width)
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
        // Frequency label
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.font = '9px JetBrains Mono, monospace'
        ctx.textAlign = 'center'
        const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`
        ctx.fillText(label, x, height - 4)
      })

      // Draw spectrum bars
      const barWidth = (width / bufferLength) * 2
      for (let i = 0; i < bufferLength; i++) {
        const freq = (i * audioEngine.audioContext.sampleRate) / analyser.fftSize
        if (freq < 20 || freq > 20000) continue

        const x = freqToX(freq, width)
        const value = dataArray[i]! / 255
        const barHeight = value * height * 0.9

        // Peak hold with decay
        if (value > peaks[i]!) {
          peaks[i] = value
        } else {
          peaks[i]! *= 0.95 // decay
        }
        const peakHeight = peaks[i]! * height * 0.9

        // Color gradient based on frequency
        const _hue = (i / bufferLength) * 360
        let fillColor: string
        if (freq < 250) {
          fillColor = colors.start
        } else if (freq < 2000) {
          fillColor = colors.mid
        } else {
          fillColor = colors.end
        }

        // Draw bar
        ctx.fillStyle = fillColor
        ctx.globalAlpha = 0.8
        ctx.fillRect(x, height - barHeight, Math.max(1, barWidth), barHeight)

        // Draw peak hold line
        ctx.globalAlpha = 1.0
        ctx.fillStyle = fillColor
        ctx.fillRect(x, height - peakHeight - 2, Math.max(1, barWidth), 2)
      }
      ctx.globalAlpha = 1.0

      // Draw frequency axis
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.font = '10px JetBrains Mono, monospace'
      ctx.textAlign = 'left'
      ctx.fillText('20Hz', 4, 12)
      ctx.textAlign = 'right'
      ctx.fillText('20kHz', width - 4, 12)

      animRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [audioEngine, width, height, color])

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full rounded border border-zinc-800"
        style={{ background: colorMap[color].bg }}
      />
      {isActive && (
        <div className="absolute top-1 right-2 text-[10px] text-emerald-400 font-mono">● LIVE</div>
      )}
    </div>
  )
}

/** Convert frequency to X coordinate (log scale) */
function freqToX(freq: number, width: number): number {
  const minFreq = 20
  const maxFreq = 20000
  const logMin = Math.log10(minFreq)
  const logMax = Math.log10(maxFreq)
  const logFreq = Math.log10(Math.max(minFreq, Math.min(maxFreq, freq)))
  return ((logFreq - logMin) / (logMax - logMin)) * width
}
