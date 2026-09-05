import { renderOnce, validateBarsSeed } from '@/lib/api-params'
import { optimizeRender } from '@/lib/psy4/auto-fixer'
import { enforceRateLimit } from '@/lib/rate-limit'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes — full 8-iteration optimization at bars=8 can take ~90s

export async function GET(req: NextRequest) {
  const limited = enforceRateLimit('optimize', req)
  if (limited) return limited
  const params = validateBarsSeed(req, 8)
  if (!params.ok) return params.response
  const { bars, seed } = params

  const maxIterationsRaw = Number.parseInt(req.nextUrl.searchParams.get('iterations') ?? '16', 10)
  if (!Number.isInteger(maxIterationsRaw) || maxIterationsRaw < 1 || maxIterationsRaw > 32) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: ['iterations must be an integer in [1, 32]'] },
      { status: 400 }
    )
  }
  const targetScoreRaw = Number.parseFloat(req.nextUrl.searchParams.get('target') ?? '0.75')
  if (!Number.isFinite(targetScoreRaw) || targetScoreRaw < 0 || targetScoreRaw > 1) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: ['target must be a number in [0, 1]'] },
      { status: 400 }
    )
  }

  const optimized = await renderOnce(() =>
    optimizeRender(seed, bars, maxIterationsRaw, targetScoreRaw)
  )
  if (!optimized.ok) {
    console.error('Optimize failed:', optimized.error.message)
    return NextResponse.json({ error: optimized.error.message }, { status: 500 })
  }
  return NextResponse.json(optimized.result)
}
