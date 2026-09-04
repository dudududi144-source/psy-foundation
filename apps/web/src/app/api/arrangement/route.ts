import { validateBarsSeed, validateVariations } from '@/lib/api-params'
import { ArrangementGenerator } from '@/lib/psy4/arrangement/ArrangementGenerator'
import { type NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * AI Arrangement API — generates structurally diverse arrangements.
 *
 * GET /api/arrangement?seed=42&bars=88
 *   Returns a single arrangement plan (sections + structure hash)
 *
 * GET /api/arrangement?seed=42&bars=88&variations=5
 *   Returns 5 variations for A/B comparison
 *
 * GET /api/arrangement?seed=42&bars=8&mode=short
 *   Returns a short arrangement for testing (8 bars)
 *
 * Phase 0 (truth) contract: Σ section.bars === targetBars EXACTLY (the
 * generator used to overshoot and report `totalBars` that contradicted
 * `targetBars`). Bounded inputs: bars ≤ 200 for this endpoint (plans are
 * cheap but the loop was unbounded), variations ≤ 24.
 */
export async function GET(req: NextRequest) {
  // Arrangement planning is cheap per bar but still bounded — allow up to 200.
  const MAX_ARRANGEMENT_BARS = 200
  const params = validateBarsSeed(req, 88)
  if (!params.ok) return params.response
  const { seed, bars } = params
  if (bars > MAX_ARRANGEMENT_BARS) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: [`bars must be ≤ ${MAX_ARRANGEMENT_BARS}`] },
      { status: 400 }
    )
  }
  const variations = validateVariations(req)
  if (!variations.ok) return variations.response
  const mode = req.nextUrl.searchParams.get('mode') ?? 'full'
  if (mode !== 'full' && mode !== 'short') {
    return NextResponse.json(
      {
        error: 'Invalid query parameters',
        details: [`mode must be "full" or "short" (got "${mode}")`],
      },
      { status: 400 }
    )
  }

  try {
    if (variations.variations > 1) {
      const plans = ArrangementGenerator.generateVariations(variations.variations, seed, bars)
      return NextResponse.json({
        mode: 'variations',
        count: plans.length,
        targetBars: bars,
        plans: plans.map((p) => ({
          sections: p.sections.map((s) => ({
            type: s.type,
            name: s.name,
            bars: s.bars,
            energy: Math.round(s.energy * 100) / 100,
            tensionShape: s.tensionShape,
            voices: s.voices,
            variation: Math.round(s.variation * 100) / 100,
          })),
          totalBars: p.totalBars,
          structureHash: p.structureHash,
        })),
      })
    }

    const gen = new ArrangementGenerator(seed)
    const plan = mode === 'short' ? gen.generateShort(bars) : gen.generate(bars)

    return NextResponse.json({
      mode,
      seed,
      targetBars: bars,
      totalBars: plan.totalBars,
      structureHash: plan.structureHash,
      sections: plan.sections.map((s) => ({
        type: s.type,
        name: s.name,
        bars: s.bars,
        energy: Math.round(s.energy * 100) / 100,
        tensionShape: s.tensionShape,
        voices: s.voices,
        variation: Math.round(s.variation * 100) / 100,
      })),
      // Summary for quick inspection
      summary: plan.sections.map((s) => `${s.type[0]!.toUpperCase()}${s.bars}`).join(' → '),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
