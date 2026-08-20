import { optimizeRender } from '@/lib/psy4/auto-fixer'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes — full 8-iteration optimization at bars=8 can take ~90s

export async function GET(req: NextRequest) {
  const seed = Number.parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const bars = Number.parseInt(req.nextUrl.searchParams.get('bars') ?? '8', 10)
  const maxIterations = Number.parseInt(req.nextUrl.searchParams.get('iterations') ?? '16', 10)
  const targetScore = Number.parseFloat(req.nextUrl.searchParams.get('target') ?? '0.75')

  try {
    const report = await optimizeRender(seed, bars, maxIterations, targetScore)
    return NextResponse.json(report)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
