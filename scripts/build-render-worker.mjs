#!/usr/bin/env bun
/**
 * PLAN_V3 4.1 — build the render worker bundle.
 *
 * Source:   apps/web/src/workers/render-worker.ts
 * Artifact: apps/web/workers/render-worker.mjs (GENERATED, committed — the
 *           D6 worklet precedent: a generated artifact the runtime loads and
 *           tests assert on).
 *
 * Reproducibility gate: two consecutive builds must be byte-identical.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(repoRoot, 'apps/web/src/workers/render-worker.ts')
const outdir = join(repoRoot, 'apps/web/workers')
const outfile = join(outdir, 'render-worker.mjs')

async function buildOnce() {
  return Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    minify: false,
    naming: 'render-worker.mjs',
  })
}

console.log(`building ${entry} → ${outfile}`)
mkdirSync(outdir, { recursive: true })

const r1 = await buildOnce()
if (!r1.success) {
  console.error('render-worker build FAILED:')
  for (const log of r1.logs) console.error(String(log))
  process.exit(1)
}
const code1 = await r1.outputs[0].text()
writeFileSync(outfile, code1)

const r2 = await buildOnce()
const code2 = r2.success ? await r2.outputs[0].text() : ''

const md5 = createHash('md5').update(code1).digest('hex')
if (code1 !== code2) {
  console.error('render-worker build FAILED: output NOT deterministic')
  console.error(`  md5(first)  = ${md5}`)
  console.error(`  md5(second) = ${createHash('md5').update(code2).digest('hex')}`)
  process.exit(1)
}

// Sanity: the artifact exposes the message handler (imports the bridge).
if (!code1.includes('must run under worker_threads parentPort or child_process IPC')) {
  console.error('render-worker build FAILED: worker entry marker missing from bundle')
  process.exit(1)
}

console.log(
  `render-worker build OK (${statSync(outfile).size} bytes, md5=${md5}, deterministic ×2)`
)
