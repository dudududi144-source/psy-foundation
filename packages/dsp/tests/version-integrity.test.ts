import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FOUNDATION_VERSION } from '../src/version.ts'

/**
 * Release versioning integrity (PLAN_V3 3.1).
 *
 * The release version has ONE source of truth (packages/dsp/src/version.ts).
 * These are behavior tests over the REAL files on disk — if anyone bumps one
 * surface and forgets another, this dies.
 */

const repoRoot = join(import.meta.dir, '..', '..', '..')

function semverOrThrow(v: string): [number, number, number] {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!m) throw new Error(`not a valid semver: ${v}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

describe('release version integrity', () => {
  test('FOUNDATION_VERSION is a valid semver', () => {
    const [maj, min, patch] = semverOrThrow(FOUNDATION_VERSION)
    expect(maj).toBeGreaterThanOrEqual(0)
    expect(min).toBeGreaterThanOrEqual(0)
    expect(patch).toBeGreaterThanOrEqual(0)
  })

  test('root package.json version equals FOUNDATION_VERSION', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version: string
    }
    expect(pkg.version).toBe(FOUNDATION_VERSION)
  })

  test('CHANGELOG.md documents the released version', () => {
    const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')
    expect(changelog).toContain(`## [${FOUNDATION_VERSION}]`)
  })

  test('worklet artifact carries the release version marker', () => {
    const worklet = readFileSync(
      join(repoRoot, 'apps', 'web', 'public', 'worklets', 'psy4-processor.js'),
      'utf8'
    )
    expect(worklet).toContain(`PSY-FOUNDATION-VERSION: ${FOUNDATION_VERSION}`)
  })

  test('ESM release bundle carries the release version marker', () => {
    const bundle = readFileSync(join(repoRoot, 'release', 'psy-foundation.esm.js'), 'utf8')
    expect(bundle).toContain(`PSY-FOUNDATION-VERSION: ${FOUNDATION_VERSION}`)
  })

  test('every workspace package shares the release version', () => {
    const packages = [
      'dsp',
      'music',
      'transport',
      'protocol',
      'device-sdk',
      'analysis',
      'learning',
      'material',
      'scheduler',
      'fixtures',
    ]
    for (const name of packages) {
      const pkg = JSON.parse(
        readFileSync(join(repoRoot, 'packages', name, 'package.json'), 'utf8')
      ) as { version: string }
      expect(pkg.version).toBe(FOUNDATION_VERSION)
    }
  })
})
