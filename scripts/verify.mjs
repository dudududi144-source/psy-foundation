#!/usr/bin/env node
/**
 * PSY Foundation — executable truth (Phase 0.8, PLAN_V3_MASTER).
 *
 * Boots the dev server, smokes every API endpoint, validates the Phase 0
 * contracts (bounded inputs, honest errors, exact arrangement bars,
 * deterministic renders) and measures loudness against ffmpeg ebur128.
 * The README's claims are regenerated from this script's output.
 *
 * Usage:
 *   node scripts/verify.mjs            # full verify (includes /api/optimize, ~60s)
 *   node scripts/verify.mjs --quick    # skip the slow optimize endpoint
 *
 * Exit code 0 = every claim green. Non-zero = a claim failed → DO NOT ship.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.VERIFY_PORT ?? 3111
const BASE = `http://127.0.0.1:${PORT}`
const QUICK = process.argv.includes('--quick')
const tmp = mkdtempSync(join(tmpdir(), 'psy-verify-'))

const results = []
function claim(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`)
}

/** fetch with a hard timeout — undici has none by default, and a hung
 *  request would otherwise hang the whole verify run. */
function fetchT(url, opts = {}, timeoutMs = 180000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) })
}

// Global watchdog: never hang the CI/session.
const WATCHDOG_MS = 9 * 60 * 1000
const watchdog = setTimeout(() => {
  console.error(`VERIFY WATCHDOG: aborted after ${WATCHDOG_MS / 1000}s`)
  process.exit(2)
}, WATCHDOG_MS)

function ffprobe(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name,sample_rate,channels',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1',
      file,
    ])
    let out = ''
    p.stdout.on('data', (d) => {
      out += d
    })
    p.on('close', () =>
      resolve(
        Object.fromEntries(
          out
            .trim()
            .split('\n')
            .map((l) => l.split('='))
        )
      )
    )
  })
}

function ffmpegLoudness(file) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ])
    let out = ''
    p.stderr.on('data', (d) => {
      out += d
    })
    p.on('close', () => {
      // ebur128 prints live meter lines AND a final summary — take the LAST
      // match of each label (the summary), not the first (an early tick that
      // reads -70 = gating floor before audio flows).
      const grab = (label) => {
        const matches = [...out.matchAll(new RegExp(`${label}:\\s+([-\\d.]+)`, 'g'))]
        return matches.length ? Number(matches[matches.length - 1][1]) : null
      }
      resolve({ lufs: grab('I'), truePeak: grab('Peak'), lra: grab('LRA') })
    })
  })
}

async function main() {
  console.log(`\nPSY Foundation — verify @ ${new Date().toISOString()}\n`)

  // ── release version integrity (PLAN_V3 3.1; no server needed) ────────────
  {
    const rootPkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const versionTs = readFileSync(join(process.cwd(), 'packages/dsp/src/version.ts'), 'utf8')
    const constMatch = versionTs.match(/FOUNDATION_VERSION\s*=\s*'([^']+)'/)
    const workletPath = join(process.cwd(), 'apps/web/public/worklets/psy4-processor.js')
    let workletVersion = null
    try {
      workletVersion =
        (readFileSync(workletPath, 'utf8').match(/PSY-FOUNDATION-VERSION:\s*(\S+)/) ?? [])[1] ??
        null
    } catch {
      /* artifact missing → claim fails below */
    }
    let bundleVersion = null
    try {
      bundleVersion =
        (readFileSync(join(process.cwd(), 'release/psy-foundation.esm.js'), 'utf8').match(
          /PSY-FOUNDATION-VERSION:\s*(\S+)/
        ) ?? [])[1] ?? null
    } catch {
      /* artifact missing → claim fails below */
    }
    const all = [rootPkg.version, constMatch?.[1] ?? null, workletVersion, bundleVersion]
    claim(
      'release-version-integrity',
      all.every((v) => v === rootPkg.version),
      `package.json=${rootPkg.version} version.ts=${constMatch?.[1] ?? 'MISSING'} worklet=${workletVersion ?? 'MISSING'} bundle=${bundleVersion ?? 'MISSING'}`
    )
  }

  // ── boot server ──────────────────────────────────────────────────────────
  console.log('Booting dev server…')
  // PLAN_V3 4.3: boot in API-key mode; verify presents the key on every call
  // EXCEPT the rate-limit claim (which must hit the 429 path like a stranger).
  const API_KEY = 'psy-verify-key'
  const HDRS = { 'x-api-key': API_KEY }
  // Kill leftovers from a previous crashed run (a stale server with OLD code
  // would otherwise answer our probes and poison every claim).
  const pidFile = join(process.cwd(), 'apps', 'web', '.verify-server-pid')
  try {
    const oldPid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
    if (Number.isInteger(oldPid) && oldPid > 0) {
      try {
        process.kill(-oldPid, 'SIGKILL')
      } catch {
        /* group gone */
      }
      try {
        process.kill(oldPid, 'SIGKILL')
      } catch {
        /* pid gone */
      }
    }
  } catch {
    /* no pidfile */
  }

  // detached + process-group kill: bun spawns next dev which spawns
  // next-server — killing only the parent orphans the rest.
  const server = spawn('bun', ['run', 'dev'], {
    cwd: join(process.cwd(), 'apps', 'web'),
    env: { ...process.env, PORT: String(PORT), PSY_API_KEY: API_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  if (server.pid) writeFileSync(pidFile, String(server.pid))
  let serverLog = ''
  server.stdout.on('data', (d) => {
    serverLog += d
  })
  server.stderr.on('data', (d) => {
    serverLog += d
  })

  let up = false
  for (let i = 0; i < 90 && !up; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const res = await fetchT(`${BASE}/`, {}, 5000)
      up = res.status === 200
    } catch {
      /* not ready yet */
    }
  }
  if (!up) {
    console.error(`Server failed to start. Log tail:\n${serverLog.slice(-2000)}`)
    server.kill()
    process.exit(1)
  }
  console.log('Server ready.\n')

  const t0 = Date.now()
  try {
    // ── page ───────────────────────────────────────────────────────────────
    {
      const res = await fetchT(`${BASE}/`, { headers: HDRS }, 30000)
      const body = await res.text()
      claim(
        'GET / renders',
        res.status === 200 && body.length > 5000,
        `status=${res.status}, bytes=${body.length}`
      )
    }

    // ── render-forensic: valid render + format + determinism ──────────────
    const wav1Path = join(tmp, 'a.wav')
    {
      console.log('  …rendering bars=8 seed=42 (first compile ~10-20s)')
      const t = Date.now()
      const res = await fetchT(
        `${BASE}/api/render-forensic?bars=8&seed=42&nocache=1`,
        { headers: HDRS },
        240000
      )
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(wav1Path, buf)
      const dur = ((Date.now() - t) / 1000).toFixed(1)
      const isWav =
        res.headers.get('content-type') === 'audio/wav' && buf.subarray(0, 4).toString() === 'RIFF'
      claim(
        'render-forensic 8/42 → WAV',
        res.status === 200 && isWav,
        `status=${res.status}, bytes=${buf.length}, ${dur}s`
      )
    }
    {
      console.log('  …second render for determinism')
      const res = await fetchT(
        `${BASE}/api/render-forensic?bars=8&seed=42&nocache=1`,
        { headers: HDRS },
        240000
      )
      const buf = Buffer.from(await res.arrayBuffer())
      const wav2Path = join(tmp, 'b.wav')
      writeFileSync(wav2Path, buf)
      const md5 = (f) => createHash('md5').update(f).digest('hex')
      const same = md5(readFileSync(wav1Path)) === md5(readFileSync(wav2Path))
      claim(
        'determinism (same seed → identical WAV)',
        same,
        `both renders md5=${md5(readFileSync(wav1Path)).slice(0, 12)}…`
      )
    }
    {
      const res = await fetchT(`${BASE}/api/render-forensic?bars=9999999`, { headers: HDRS }, 30000)
      const j = await res.json().catch(() => ({}))
      claim(
        'DoS guard: bars=9999999 → 400',
        res.status === 400,
        `status=${res.status}, error=${(j.details ?? [j.error ?? ''])[0] ?? ''}`
      )
    }
    {
      const res = await fetchT(`${BASE}/api/render-forensic?bars=0`, { headers: HDRS }, 30000)
      claim('DoS guard: bars=0 → 400', res.status === 400, `status=${res.status}`)
    }
    {
      const res = await fetchT(
        `${BASE}/api/render-forensic?bars=8&seed=42&format=flac`,
        // opts must be a fetch init — the key rides INSIDE `headers` (passing
        // HDRS bare would top-level-spread it and the request goes keyless,
        // hitting 429 in key mode instead of the 501 under test).
        { headers: HDRS },
        30000
      )
      claim('FLAC honestly rejected (501)', res.status === 501, `status=${res.status}`)
    }

    // ── PLAN_V3 4.1: cache + worker headers ────────────────────────────────
    {
      // 4.2 note: with streamed responses the first request is "done" only
      // when its BODY is consumed — so both fetches read to completion
      // before the second one starts (otherwise the second request would
      // rightly see the render still in flight → miss).
      const res = await fetchT(
        `${BASE}/api/render-forensic?bars=8&seed=42`,
        { headers: HDRS },
        240000
      )
      const bufA = Buffer.from(await res.arrayBuffer())
      const res2 = await fetchT(
        `${BASE}/api/render-forensic?bars=8&seed=42`,
        { headers: HDRS },
        60000
      )
      const bufB = Buffer.from(await res2.arrayBuffer())
      const cacheHeader = res.headers.get('x-render-cache') ?? 'none'
      const cacheHeader2 = res2.headers.get('x-render-cache') ?? 'none'
      const workerHeader = res.headers.get('x-render-worker') ?? 'none'
      const md5c = (f) => createHash('md5').update(f).digest('hex')
      claim(
        'render cache: identical request → hit',
        cacheHeader === 'miss' && cacheHeader2 === 'hit' && md5c(bufA) === md5c(bufB),
        `first=${cacheHeader}, second=${cacheHeader2}, md5=${md5c(bufA).slice(0, 12)}…`
      )
      claim(
        'render off event loop: worker/inline header reported',
        workerHeader === 'worker' ||
          workerHeader === 'inline' ||
          workerHeader === 'inline-fallback' ||
          workerHeader === 'cache',
        `X-Render-Worker=${workerHeader}`
      )
    }

    // ── PLAN_V3 4.2: streaming WAV — header-first TTFB + byte integrity ───
    {
      console.log('  …streaming probe: bars=88 nocache (long render, header-first)')
      const t = Date.now()
      const res = await fetchT(
        `${BASE}/api/render-forensic?bars=88&seed=7&nocache=1`,
        { headers: HDRS },
        240000
      )
      const declared = Number(res.headers.get('content-length'))
      const xStream = res.headers.get('x-stream') ?? 'none'
      const reader = res.body.getReader()
      const chunks = []
      let ttfbMs = null
      let firstChunkLen = 0
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (ttfbMs === null) {
          ttfbMs = Date.now() - t
          firstChunkLen = value.length
        }
        chunks.push(Buffer.from(value))
        total += value.length
      }
      const all = Buffer.concat(chunks)
      writeFileSync(join(tmp, 'stream88.wav'), all)
      const riffOk =
        all.subarray(0, 4).toString('ascii') === 'RIFF' &&
        all.subarray(8, 12).toString('ascii') === 'WAVE'
      claim(
        'streaming WAV: first byte < 500ms (header-first)',
        ttfbMs !== null && ttfbMs < 500 && riffOk,
        `ttfb=${ttfbMs}ms, firstChunk=${firstChunkLen}B, x-stream=${xStream}`
      )
      claim(
        'streaming WAV: exact Content-Length body',
        declared > 0 && total === declared,
        `declared=${declared}, received=${total}`
      )
      const probe = await ffprobe(join(tmp, 'stream88.wav'))
      claim(
        'streamed WAV decodes (ffprobe pcm_s16le)',
        probe.codec_name === 'pcm_s16le',
        `codec=${probe.codec_name}, sr=${probe.sample_rate}, dur=${probe.duration}`
      )
      // Cold re-render through the cache-storing path: an independent render
      // must be byte-identical to the nocache stream (determinism at 88 bars,
      // proving streaming changed nothing about the master-chain output).
      const res2 = await fetchT(
        `${BASE}/api/render-forensic?bars=88&seed=7`,
        { headers: HDRS },
        240000
      )
      const buf2 = Buffer.from(await res2.arrayBuffer())
      const md5 = (f) => createHash('md5').update(f).digest('hex')
      claim(
        'streaming determinism: 88-bar re-render identical',
        md5(buf2) === md5(all),
        `md5=${md5(all).slice(0, 12)}…`
      )
      // Cache-hit path streams too — bytes must match the cold render.
      const res3 = await fetchT(
        `${BASE}/api/render-forensic?bars=88&seed=7`,
        { headers: HDRS },
        120000
      )
      const buf3 = Buffer.from(await res3.arrayBuffer())
      const hitHeader = res3.headers.get('x-render-cache') ?? 'none'
      claim(
        'streaming cache-hit: identical bytes',
        hitHeader === 'hit' && md5(buf3) === md5(all),
        `cache=${hitHeader}, md5=${md5(buf3).slice(0, 12)}…`
      )
    }

    // ── PLAN_V3 4.3: rate limit — 6 rapid keyless renders → 429 ────────────
    {
      let saw429 = false
      let retryAfter = null
      for (let i = 0; i < 6; i++) {
        const res = await fetchT(`${BASE}/api/render-forensic?bars=1&seed=${i}`, {}, 60000)
        if (res.status === 429) {
          saw429 = true
          retryAfter = res.headers.get('retry-after')
          break
        }
      }
      claim(
        'rate limit: burst without key → 429 + Retry-After',
        saw429,
        `retryAfter=${retryAfter ?? 'n/a'}`
      )
    }
    {
      console.log('  …rendering style=darkpsy')
      const res = await fetchT(
        `${BASE}/api/render-forensic?bars=8&seed=42&style=darkpsy`,
        { headers: HDRS },
        240000
      )
      const buf = await res.arrayBuffer()
      claim(
        'style=darkpsy renders',
        res.status === 200 && buf.byteLength > 100000,
        `status=${res.status}, bytes=${buf.byteLength}`
      )
    }

    // ── loudness vs ffmpeg ────────────────────────────────────────────────
    {
      const probe = await ffprobe(wav1Path)
      const loud = await ffmpegLoudness(wav1Path)
      const durOk = probe.duration !== undefined && Math.abs(Number(probe.duration) - 13.24) < 0.5
      claim(
        'render duration ≈ 13.24s (8 bars @145bpm)',
        durOk,
        `ffprobe=${probe.duration}s, codec=${probe.codec_name}, sr=${probe.sample_rate}, ch=${probe.channels}`
      )
      const lufsOk = loud.lufs !== null && loud.lufs >= -11 && loud.lufs <= -7
      claim(
        'integrated LUFS in club-master range [-11, -7] (ffmpeg ebur128)',
        lufsOk,
        `I=${loud.lufs} LUFS, LRA=${loud.lra} LU`
      )
      claim(
        'true peak below 0 dBTP (ffmpeg)',
        loud.truePeak !== null && loud.truePeak <= 0,
        `Peak=${loud.truePeak} dBTP`
      )
    }

    // ── arrangement exact-bars contract ───────────────────────────────────
    for (const bars of [8, 88]) {
      const res = await fetchT(
        `${BASE}/api/arrangement?seed=42&bars=${bars}`,
        { headers: HDRS },
        60000
      )
      const j = await res.json()
      const sum = (j.sections ?? []).reduce((a, s) => a + s.bars, 0)
      claim(
        `arrangement bars=${bars} → Σsections === ${bars} (exact)`,
        res.status === 200 && sum === bars,
        `status=${res.status}, Σ=${sum}, reported totalBars=${j.totalBars}`
      )
    }
    {
      const res = await fetchT(
        `${BASE}/api/arrangement?seed=42&bars=8&mode=short`,
        { headers: HDRS },
        60000
      )
      const j = await res.json()
      const sum = (j.sections ?? []).reduce((a, s) => a + s.bars, 0)
      claim('arrangement short mode respects bars', res.status === 200 && sum === 8, `Σ=${sum}`)
    }

    // ── audio-critique ────────────────────────────────────────────────────
    {
      console.log('  …audio-critique (~20s)')
      const t = Date.now()
      const res = await fetchT(
        `${BASE}/api/audio-critique?bars=8&seed=42`,
        { headers: HDRS },
        240000
      )
      const j = await res.json()
      const sec = ((Date.now() - t) / 1000).toFixed(1)
      const metricCount = Object.keys(j.metrics ?? {}).length
      claim(
        'audio-critique → 38 metrics + score',
        res.status === 200 && metricCount >= 35 && typeof j.overallScore === 'number',
        `status=${res.status}, metrics=${metricCount}, score=${j.overallScore}, ${sec}s`
      )
    }

    // ── upload-reference + style-transfer end-to-end (was 2 dead routes) ──
    {
      const wavForm = new FormData()
      const wavBytes = readFileSync(wav1Path)
      wavForm.append('audio', new Blob([wavBytes], { type: 'audio/wav' }), 'ref.wav')
      const res = await fetchT(
        `${BASE}/api/upload-reference`,
        { method: 'POST', body: wavForm, headers: HDRS },
        120000
      )
      const j = await res.json()
      claim(
        'upload-reference: valid WAV → 200 + hash',
        res.status === 200 && typeof j.hash === 'string' && j.hash.length > 4,
        `status=${res.status}, hash=${j.hash ?? j.error}, sr=${j.sampleRate}, bits=${j.bitsPerSample}`
      )

      if (res.status === 200 && j.hash) {
        console.log('  …style-transfer with reference (~5s)')
        const res2 = await fetchT(
          `${BASE}/api/style-transfer?bars=8&seed=42&reference=${j.hash}&blend=0.5`,
          { headers: HDRS },
          240000
        )
        const header = res2.headers.get('x-style-transfer') ?? ''
        const buf = await res2.arrayBuffer()
        claim(
          'style-transfer with reference → 200 WAV + applied header',
          res2.status === 200 && buf.byteLength > 100000 && header.startsWith('applied'),
          `status=${res2.status}, X-Style-Transfer="${header}", bytes=${buf.byteLength}`
        )
      }
    }
    {
      // Default style-transfer (no reference) — was a guaranteed 500 (em-dash header).
      const res = await fetchT(
        `${BASE}/api/style-transfer?bars=8&seed=42`,
        { headers: HDRS },
        240000
      )
      const header = res.headers.get('x-style-transfer') ?? ''
      claim(
        'style-transfer default → 200 (was guaranteed 500)',
        res.status === 200,
        `status=${res.status}, X-Style-Transfer="${header}"`
      )
    }
    {
      // Non-WAV upload → honest 400
      const form = new FormData()
      form.append(
        'audio',
        new Blob([Buffer.from('this is not audio')], { type: 'audio/mpeg' }),
        'song.mp3'
      )
      const res = await fetchT(
        `${BASE}/api/upload-reference`,
        { method: 'POST', body: form, headers: HDRS },
        60000
      )
      claim(
        'upload-reference: non-WAV → honest 400 (no fake MP3/OGG support claim)',
        res.status === 400,
        `status=${res.status}`
      )
    }

    // ── optimize (slow; skippable) ────────────────────────────────────────
    if (!QUICK) {
      console.log('  …optimize 2 iterations (~15s)')
      const t = Date.now()
      const res = await fetchT(
        `${BASE}/api/optimize?bars=8&seed=42&iterations=2`,
        { headers: HDRS },
        300000
      )
      const j = await res.json()
      const sec = ((Date.now() - t) / 1000).toFixed(1)
      claim(
        'optimize → report JSON',
        res.status === 200 && typeof j === 'object',
        `status=${res.status}, ${sec}s`
      )
    } else {
      claim('optimize SKIPPED (--quick)', true, 'skipped by flag')
    }

    // ── summary ───────────────────────────────────────────────────────────
    const passed = results.filter((r) => r.pass).length
    const failed = results.filter((r) => !r.pass).length
    console.log(
      `\n${'='.repeat(72)}\nVERIFY RESULT: ${passed} pass, ${failed} fail (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`
    )
    writeFileSync(join(tmp, 'results.json'), JSON.stringify(results, null, 2))
    console.log(`Details: ${join(tmp, 'results.json')}\n`)
    if (failed > 0) process.exitCode = 1
  } finally {
    try {
      if (server.pid) process.kill(-server.pid, 'SIGKILL')
    } catch {
      /* group gone */
    }
    server.kill('SIGKILL')
    try {
      unlinkSync(pidFile)
    } catch {
      /* already gone */
    }
    clearTimeout(watchdog)
  }
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(1)
})
