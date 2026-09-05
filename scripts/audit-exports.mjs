#!/usr/bin/env node
/**
 * audit-exports.mjs — Dead-export audit (AUDIT_FOLLOWUP_2026-09-05 §4 item 3).
 *
 * Answers, per package: which exported symbols are (a) public v2.0.0 surface
 * (reachable from the package index), (b) internal but referenced, (c) DEAD —
 * exported from a non-index module and referenced NOWHERE else in the repo.
 *
 * Method (conservative by design):
 *  - every `export` form is parsed (named, type, star, star-as, default skipped);
 *  - a symbol counts as referenced if its identifier appears in ANY other file
 *    of the repo (source, test, script, markdown-free) — comments therefore
 *    under-report death, never over-report it;
 *  - re-export chains and `export *` are resolved so index-reachable symbols
 *    are classified PUBLIC, not dead (external family consumers are the point
 *    of the v2.0.0 channel — absence of an in-repo consumer is NOT death).
 *
 * Exit code: 0 always (report tool). Use --strict to exit 1 when DEAD > 0.
 *
 * Usage: node scripts/audit-exports.mjs [--strict] [--json <path>]
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)

// ---------- gather files ----------
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx'])
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'release',
  'archive',
  'benchmarks',
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(p, out)
    } else if (EXTS.has(entry.slice(entry.lastIndexOf('.')))) {
      out.push(p)
    }
  }
  return out
}

const allFiles = walk(ROOT).map((p) => resolve(p))
const tsFiles = allFiles.filter(
  (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.test\.ts$/.test(p)
)
const consumerFiles = allFiles // everything counts as a potential consumer

// ---------- per-file model ----------
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ')

const modules = new Map() // absPath -> { declared:Set, fromMap:Map, stars:[], nsStars:Map, identifiers:Set, pkg }

function pkgOf(file) {
  const rel = relative(ROOT, file)
  if (rel.startsWith(`packages${sep}`)) return rel.split(sep)[1]
  if (rel.startsWith(`apps${sep}`)) return `apps/${rel.split(sep)[1]}`
  if (rel.startsWith(`integration${sep}`)) return 'integration'
  return 'root'
}

function resolveSpec(fromFile, spec) {
  if (spec.startsWith('.')) {
    const base = resolve(dirname(fromFile), spec)
    const cands = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      `${base}.js`,
      `${base}.mjs`,
    ]
    for (const c of cands)
      if (modules.has(c) || tsFiles.includes(c) || allFiles.includes(c)) return c
    return null
  }
  const m = spec.match(/^@psy-foundation\/([\w-]+)(?:\/(.+))?$/)
  if (m) {
    const base = join(ROOT, 'packages', m[1], 'src')
    if (!m[2]) return join(base, 'index.ts')
    const cands = [join(base, `${m[2]}.ts`), join(base, m[2], 'index.ts')]
    for (const c of cands) if (allFiles.includes(c)) return c
    return null
  }
  return null // external dependency — out of scope
}

function parseExports(file) {
  const raw = readFileSync(file, 'utf8')
  const text = stripComments(raw)
  const identifiers = new Set(raw.match(/[A-Za-z_$][\w$]*/g) ?? [])
  const declared = new Set()
  const fromMap = new Map() // localName -> { mod, sym }
  const stars = []
  const nsStars = new Map()

  const namedRe = /export\s+(?:type\s*)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/g
  for (const m of text.matchAll(namedRe)) {
    const [, body, spec] = m
    for (const item of body.split(',')) {
      const t = item.trim()
      if (!t) continue
      const clean = t.replace(/^type\s+/, '')
      const name = clean
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (!name || name === 'default') continue
      if (spec) {
        const target = resolveSpec(file, spec)
        if (target) fromMap.set(name, { mod: target, sym: name })
        else declared.add(name) // external spec — treat as declared boundary
      } else {
        declared.add(name)
      }
    }
  }

  const declRe =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(const|let|var|function|class|enum|type|interface)\s+([A-Za-z_$][\w$]*)/g
  for (const m of text.matchAll(declRe)) declared.add(m[2])

  const starRe = /export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from\s*['"]([^'"]+)['"]/g
  for (const m of text.matchAll(starRe)) {
    const target = resolveSpec(file, m[2])
    if (!target) continue
    if (m[1]) nsStars.set(m[1], target)
    else stars.push(target)
  }

  return { declared, fromMap, stars, nsStars, identifiers }
}

for (const f of tsFiles) modules.set(f, null)
for (const f of tsFiles) modules.set(f, parseExports(f))

// ---------- public surface per package (BFS from index) ----------
const providedMemo = new Map()

function providedOf(file) {
  if (providedMemo.has(file)) return providedMemo.get(file)
  providedMemo.set(file, new Set()) // cycle guard
  const mod = modules.get(file)
  const out = new Set()
  if (!mod) return out
  for (const s of mod.declared) out.add(s)
  for (const [, { mod: target, sym }] of mod.fromMap) {
    if (modules.has(target)) {
      const provided = providedOf(target)
      out.add(provided.has(sym) ? sym : sym)
    } else out.add(sym)
  }
  for (const target of mod.stars) {
    if (modules.has(target)) for (const s of providedOf(target)) out.add(s)
  }
  for (const [, target] of mod.nsStars) {
    if (modules.has(target)) for (const s of providedOf(target)) out.add(s)
  }
  providedMemo.set(file, out)
  return out
}

function publicSurface(pkg, idxPath) {
  const idx = idxPath ?? join(ROOT, 'packages', pkg, 'src', 'index.ts')
  if (!modules.has(idx)) return new Map() // pkg -> Map<sym, declaringFile>
  const seen = new Map() // sym -> declaring file
  const mod = modules.get(idx)
  const visit = (file, sym) => {
    if (!seen.has(sym)) seen.set(sym, file)
  }
  for (const s of mod.declared) visit(idx, s)
  for (const [, { mod: target, sym }] of mod.fromMap) {
    if (modules.has(target)) {
      const targetMod = modules.get(target)
      if (targetMod.fromMap.has(sym)) visit(targetMod.fromMap.get(sym).mod, sym)
      else visit(target, sym)
    } else visit(idx, sym)
  }
  for (const target of mod.stars) {
    if (modules.has(target)) {
      const targetMod = modules.get(target)
      for (const s of providedOf(target)) {
        const origin = targetMod.fromMap.has(s) ? targetMod.fromMap.get(s).mod : target
        visit(origin, s)
      }
    }
  }
  for (const [, target] of mod.nsStars) {
    if (modules.has(target)) for (const s of providedOf(target)) visit(target, s)
  }
  return seen
}

// ---------- reference index (per-file identifier sets) ----------
const refIndex = consumerFiles.map((f) => {
  let set
  try {
    set = new Set(readFileSync(f, 'utf8').match(/[A-Za-z_$][\w$]*/g) ?? [])
  } catch {
    set = new Set()
  }
  return { file: f, set, isTs: modules.has(f) }
})

function refFiles(symbol, declaringFile) {
  const out = []
  for (const { file, set } of refIndex) {
    if (file === declaringFile) continue
    if (set.has(symbol)) out.push(file)
  }
  return out
}

// ---------- classify ----------
const includeApps = process.argv.includes('--include-apps')
const pkgs = [
  ...new Set(
    tsFiles
      .map((f) => pkgOf(f))
      .filter((p) => (includeApps ? p !== 'root' : !p.startsWith('apps/')))
  ),
]

// App barrels: an app's "index" is its internal barrel file, if any.
const APP_BARRELS = { web: join(ROOT, 'apps', 'web', 'src', 'lib', 'psy4', 'index.ts') }

const report = { generatedAt: new Date().toISOString(), packages: {} }
let totalDead = 0
let totalPublic = 0
let totalInternalUsed = 0

for (const pkg of pkgs.sort()) {
  const isApp = pkg.startsWith('apps/')
  const app = isApp ? pkg.split('/')[1] : null
  const pub = isApp
    ? modules.has(APP_BARRELS[app])
      ? publicSurface(pkg, APP_BARRELS[app])
      : new Map()
    : publicSurface(pkg)
  const files = tsFiles.filter((f) => pkgOf(f) === pkg)
  const dead = []
  const publicNoConsumer = []
  const publicUsed = []
  const internalUsed = []

  for (const file of files) {
    const mod = modules.get(file)
    for (const sym of mod.declared) {
      if (pub.has(sym)) {
        const refs = refFiles(sym, file)
        if (refs.length === 0) publicNoConsumer.push({ sym, file: relative(ROOT, file) })
        else publicUsed.push({ sym, file: relative(ROOT, file), consumers: refs.length })
        continue
      }
      const refs = refFiles(sym, file)
      if (refs.length === 0) dead.push({ sym, file: relative(ROOT, file) })
      else internalUsed.push({ sym, file: relative(ROOT, file), consumers: refs.length })
    }
  }

  totalDead += dead.length
  totalPublic += publicUsed.length + publicNoConsumer.length
  totalInternalUsed += internalUsed.length
  report.packages[pkg] = {
    public: { usedInRepo: publicUsed.length, awaitingExternalConsumer: publicNoConsumer.length },
    internalUsed: internalUsed.length,
    dead,
    publicNoConsumer: publicNoConsumer.map((x) => `${x.sym} (${x.file})`),
  }

  console.log(`\n=== ${pkg} ===`)
  console.log(
    `  PUBLIC surface: ${pub.size} symbols (${publicUsed.length} with in-repo consumers, ${publicNoConsumer.length} awaiting external consumers)`
  )
  console.log(`  INTERNAL used : ${internalUsed.length}`)
  console.log(`  DEAD exports  : ${dead.length}`)
  for (const d of dead) console.log(`    - ${d.sym}  (${d.file})`)
}

console.log('\n================ SUMMARY ================')
console.log(`packages scanned : ${pkgs.length}`)
console.log(`public symbols   : ${totalPublic}`)
console.log(`internal used    : ${totalInternalUsed}`)
console.log(`DEAD exports     : ${totalDead}`)

if (process.argv.includes('--json')) {
  const i = process.argv.indexOf('--json')
  const out = process.argv[i + 1] ?? 'audit/dead-exports-report.json'
  writeFileSync(join(ROOT, out), JSON.stringify(report, null, 2))
  console.log(`json report -> ${out}`)
}

if (process.argv.includes('--strict') && totalDead > 0) process.exit(1)
