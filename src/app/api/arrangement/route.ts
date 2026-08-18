import { NextRequest, NextResponse } from 'next/server'
import { ArrangementGenerator } from '@/lib/psy4/arrangement/ArrangementGenerator'

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
 * Every seed produces a different arrangement — no two outputs sound the same.
 * Structure hash uniquely identifies each arrangement for reproducibility.
 */
export async function GET(req: NextRequest) {
  const seed = parseInt(req.nextUrl.searchParams.get('seed') ?? '42', 10)
  const bars = parseInt(req.nextUrl.searchParams.get('bars') ?? '88', 10)
  const variations = parseInt(req.nextUrl.searchParams.get('variations') ?? '1', 10)
  const mode = req.nextUrl.searchParams.get('mode') ?? 'full'

  try {
    if (variations > 1) {
      const plans = ArrangementGenerator.generateVariations(variations, seed, bars)
      return NextResponse.json({
        mode: 'variations',
        count: plans.length,
        targetBars: bars,
        plans: plans.map(p => ({
          sections: p.sections.map(s => ({
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
      sections: plan.sections.map(s => ({
        type: s.type,
        name: s.name,
        bars: s.bars,
        energy: Math.round(s.energy * 100) / 100,
        tensionShape: s.tensionShape,
        voices: s.voices,
        variation: Math.round(s.variation * 100) / 100,
      })),
      // Summary for quick inspection
      summary: plan.sections.map(s => `${s.type[0]!.toUpperCase()}${s.bars}`).join(' → '),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
