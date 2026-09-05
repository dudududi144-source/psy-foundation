#!/usr/bin/env node
/**
 * family-sync-check.mjs — PSY family vendored-codec drift detector.
 *
 * The family's one-codec rule (PSYBUS v2) is enforced by vendoring the
 * foundation protocol VERBATIM into consumer repos. Vendored copies drift
 * silently unless someone measures them. This tool measures them.
 *
 * Checks, per consumer repo, against this repo's canonical
 * packages/protocol/src/v2/{types,envelope,deprecations}.ts:
 *   - md5 byte-equality, OR
 *   - equality after the documented normalization (import-path renaming),
 *     with the residual diff REQUIRED to touch only import lines — any
 *     other delta is drift and fails.
 *
 * Usage:
 *   node scripts/family-sync-check.mjs [--family-root <dir>] [--json <out>]
 *
 * --family-root: directory containing the consumer clones (default:
 *   <repo-root>/../family). Exit: 0 all in sync · 1 drift/missing · 2 usage.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANON = {
  types: resolve(ROOT, 'packages/protocol/src/v2/types.ts'),
  envelope: resolve(ROOT, 'packages/protocol/src/v2/envelope.ts'),
  deprecations: resolve(ROOT, 'packages/protocol/src/v2/deprecations.ts'),
}

const args = process.argv.slice(2)
function argValue(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  const v = args[i + 1]
  if (!v || v.startsWith('--')) {
    console.error(`family-sync-check: ${flag} needs a value`)
    process.exit(2)
  }
  return v
}
const familyRoot = resolve(argValue('--family-root') || resolve(ROOT, '..', 'family'))
const jsonOut = argValue('--json')

// The only allowed non-byte-identical adaptation so far: anthem's shim
// renames the vendored files (psybus-v2-*.ts), so relative imports differ.
// The normalized comparison maps those names back to canonical ones.
const IMPORT_NORMALIZATION = {
  'psy-anthem': [
    [/from '\.\/psybus-v2-types\.ts'/g, "from './types.ts'"],
    [/from '\.\/psybus-v2-envelope\.ts'/g, "from './envelope.ts'"],
  ],
}

// Manifest: consumer repo → vendored file → { canonical, mode }
// mode 'exact' = md5 must match canonical md5.
// mode 'imports' = after import-path normalization, md5 must match; any
// residual difference outside import lines is drift.
const MANIFEST = {
  'psy-anthem': {
    'src/foundation-shim/psybus-v2-types.ts': { canonical: 'types', mode: 'exact' },
    'src/foundation-shim/psybus-v2-envelope.ts': { canonical: 'envelope', mode: 'imports' },
  },
  psysampler: {
    'src/foundation-shim/types.ts': { canonical: 'types', mode: 'exact' },
    'src/foundation-shim/envelope.ts': { canonical: 'envelope', mode: 'exact' },
  },
  psy5: {
    'foundation/protocol/v2/types.ts': { canonical: 'types', mode: 'exact' },
    'foundation/protocol/v2/envelope.ts': { canonical: 'envelope', mode: 'exact' },
    'foundation/protocol/v2/deprecations.ts': { canonical: 'deprecations', mode: 'exact' },
  },
}

const md5 = (buf) => createHash('md5').update(buf).digest('hex')
function normalize(repo, text) {
  const rules = IMPORT_NORMALIZATION[repo] || []
  let out = text
  for (const [re, to] of rules) out = out.replace(re, to)
  return out
}

const results = []
let drift = 0
let missing = 0

for (const [repo, files] of Object.entries(MANIFEST)) {
  const repoDir = resolve(familyRoot, repo)
  if (!existsSync(repoDir)) {
    for (const [file] of Object.entries(files)) {
      results.push({
        repo,
        file,
        status: 'MISSING-REPO',
        detail: `${repoDir} not found (clone it or pass --family-root)`,
      })
      missing++
    }
    continue
  }
  for (const [file, spec] of Object.entries(files)) {
    const vendoredPath = resolve(repoDir, file)
    const canonicalBuf = readFileSync(CANON[spec.canonical])
    if (!existsSync(vendoredPath)) {
      results.push({ repo, file, status: 'MISSING', detail: 'vendored file not found' })
      missing++
      continue
    }
    const vendoredBuf = readFileSync(vendoredPath)
    const canonicalMd5 = md5(canonicalBuf)
    const vendoredMd5 = md5(vendoredBuf)
    if (vendoredMd5 === canonicalMd5) {
      results.push({ repo, file, status: 'EXACT', md5: vendoredMd5, canonical: spec.canonical })
      continue
    }
    if (spec.mode === 'imports') {
      const normalizedMd5 = md5(normalize(repo, vendoredBuf.toString('utf8')))
      if (normalizedMd5 === canonicalMd5) {
        results.push({
          repo,
          file,
          status: 'EXACT-IMPORTS-ONLY',
          md5: vendoredMd5,
          canonical: spec.canonical,
          detail:
            'byte-diff is import-path renaming only (documented adaptation); codec logic verbatim',
        })
        continue
      }
      results.push({
        repo,
        file,
        status: 'DRIFT',
        detail: 'diff exceeds the documented import-path adaptation',
      })
      drift++
      continue
    }
    results.push({
      repo,
      file,
      status: 'DRIFT',
      detail: `vendored md5 ${vendoredMd5} != canonical ${canonicalMd5}`,
    })
    drift++
  }
}

const ok = drift === 0 && missing === 0
const summary = {
  checkedAt: new Date().toISOString(),
  familyRoot,
  foundation: md5(readFileSync(CANON.types)) + ' (types)',
  repos: Object.keys(MANIFEST),
  results,
  drift,
  missing,
  ok,
}
if (jsonOut) {
  const outPath = resolve(jsonOut)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n')
}

const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
for (const r of results) {
  const mark = r.status.startsWith('EXACT') ? 'PASS' : 'FAIL'
  console.log(
    `${mark}  ${pad(r.repo, 12)} ${pad(r.file, 46)} ${r.status}${r.detail ? ' — ' + r.detail : ''}`
  )
}
console.log(
  `\nsummary: ${results.length} vendored files across ${Object.keys(MANIFEST).length} repos — ` +
    `${drift} drift, ${missing} missing → ${ok ? 'FAMILY IN SYNC' : 'SYNC BROKEN (exit 1)'}`
)
process.exit(ok ? 0 : 1)
