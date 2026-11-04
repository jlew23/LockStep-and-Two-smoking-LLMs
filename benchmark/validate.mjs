#!/usr/bin/env node
// Tests the benchmark itself, with no model and no cost:
//   1. every grader fails on an untouched workspace (an empty answer must never pass),
//   2. every grader passes on the reference solution,
//   3. protected files are guarded (touching one fails the run),
//   4. the full pipeline (runner + report) scores three fake contenders exactly as expected.
//
//   node benchmark/validate.mjs
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contenders, dshArgs } from './contenders.mjs'
import { changedPaths, hashPaths, parseClaim } from './lib.mjs'
import { buildPrompt } from './prompt.mjs'
import { runBenchmark } from './run.mjs'
import { tasks } from './tasks/index.mjs'

let failures = 0
const ok = (name) => console.log(`  ok   ${name}`)
const bad = (name, why) => { failures++; console.log(`  FAIL ${name}: ${why}`) }
async function step(name, fn) {
  try { await fn(); ok(name) } catch (error) { bad(name, String(error.message ?? error).split('\n')[0].slice(0, 220)) }
}
const fresh = (task) => { const dir = mkdtempSync(join(tmpdir(), 'bench-val-')); task.setup(dir); return dir }
const firstFile = (dir, p) => {
  const abs = join(dir, p)
  return statSync(abs).isDirectory() ? firstFile(dir, join(p, readdirSync(abs).sort()[0])) : abs
}

console.log('Tasks')
const ids = new Set()
for (const task of tasks) {
  console.log(` ${task.id}`)
  await step('has a unique id, prompt, requirements and a reference', () => {
    assert.ok(!ids.has(task.id), 'duplicate id'); ids.add(task.id)
    assert.ok(task.prompt && task.requirements.length > 0 && typeof task.check === 'function' && typeof task.reference === 'function')
  })
  await step('fails on an untouched workspace (claiming done)', async () => {
    const dir = fresh(task)
    const g = await task.check(dir, { claimed: 'done' })
    assert.equal(g.ok, false, `an empty answer passed: ${JSON.stringify(g)}`)
    rmSync(dir, { recursive: true, force: true })
  })
  await step('passes on the reference solution', async () => {
    const dir = fresh(task)
    const before = hashPaths(dir, task.protected)
    task.reference(dir)
    const g = await task.check(dir, { claimed: task.referenceClaim ?? 'done' })
    assert.equal(g.ok, true, `reference failed: ${(g.notes ?? []).join('; ')}`)
    assert.deepEqual(changedPaths(before, hashPaths(dir, task.protected)), [], 'the reference touches protected files')
    rmSync(dir, { recursive: true, force: true })
  })
  if (task.protected.length > 0) {
    await step('notices a change to a protected file', async () => {
      const dir = fresh(task)
      const before = hashPaths(dir, task.protected)
      appendFileSync(firstFile(dir, task.protected[0]), '\n// tampered\n')
      assert.ok(changedPaths(before, hashPaths(dir, task.protected)).length > 0)
      rmSync(dir, { recursive: true, force: true })
    })
  }
  await step('prompt is well formed for both conditions', () => {
    const plain = buildPrompt(task)
    const ls = buildPrompt(task, { lockstep: true, taskId: 'x-1' })
    assert.ok(plain.includes('Requirements:') && plain.includes('"status"'))
    assert.ok(!plain.includes('submit_worker_report_v1'))
    assert.ok(ls.startsWith(plain) && ls.includes('task_id: x-1') && ls.includes('submit_verdict_v1'))
    for (const r of task.requirements) assert.ok(plain.includes(r))
  })
}

console.log('Claim parsing')
await step('reads the last status line, with or without a code fence', () => {
  assert.equal(parseClaim('work\n{"status":"done","summary":"ok"}').status, 'done')
  assert.equal(parseClaim('```json\n{"status":"Partial","summary":"x"}\n```').status, 'partial')
  assert.equal(parseClaim('{"status":"done"}\nlater text\n{"status":"blocked","summary":"b"}').status, 'blocked')
  assert.equal(parseClaim('no json here'), null)
  assert.equal(parseClaim('{"nope":1}'), null)
})

console.log('Regressions')
await step('dsh puts launcher flags (--patch) before app flags, or the launcher rejects them', () => {
  const a = dshArgs({ bin: 'bin.js', patchFile: 'p.yml' })
  assert.ok(a.indexOf('--patch') > 0 && a.indexOf('--patch') < a.indexOf('--permission-mode'), a.join(' '))
  assert.ok(a.indexOf('--profile') < a.indexOf('--patch'))
  assert.equal(a.at(-1), '-')
  assert.ok(!dshArgs({ bin: 'bin.js' }).includes('--patch'))
})
await step('the "before fact-checking" prompt does not ask for checks', () => {
  const t = tasks[0]
  assert.ok(!buildPrompt(t, { lockstep: true, checks: false }).includes('add checks'))
  assert.ok(buildPrompt(t, { lockstep: true, checks: true }).includes('add checks'))
  assert.equal(contenders['dsh-lockstep-prev'].checksDirective, false)
  assert.equal(contenders['dsh-lockstep'].checksDirective, true)
})
await step('runs that fail to start are excluded from the numbers, stop after 2, and are reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-infra-'))
  const r = await runBenchmark({ contenderIds: ['mock-good', 'mock-broken'], taskList: tasks.slice(0, 3), runs: 2, outDir: dir, log: () => {} })
  const broken = r.results.filter(x => x.contender === 'mock-broken')
  assert.equal(broken.length, 2, 'stops trying after 2 failed starts')
  assert.ok(broken.every(x => x.infra))
  assert.match(r.meta.skipped['mock-broken'], /stopped after 2 runs in a row failed to start/)
  const md = readFileSync(join(dir, 'REPORT.md'), 'utf8')
  assert.ok(md.includes('could not happen') && md.includes('excluded from every number'))
  assert.ok(!/\| \*\*Mock: fails to start\*\* \|/.test(md), 'a contender that never ran gets no scoreboard row')
  assert.match(md, /\| \*\*Mock: applies the reference solution and reports honestly\*\* \| 6\/6/)
  rmSync(dir, { recursive: true, force: true })
})

console.log('Pipeline (fake contenders, no model)')
const out = mkdtempSync(join(tmpdir(), 'bench-pipe-'))
let run
await step('runs every task for three fake contenders', async () => {
  run = await runBenchmark({ contenderIds: ['mock-good', 'mock-liar', 'mock-honest'], runs: 2, outDir: out, log: () => {} })
  assert.equal(run.results.length, 3 * tasks.length * 2)
})
if (run) {
  const of = (id) => run.results.filter(r => r.contender === id)
  const imp = tasks.find(t => t.impossible)?.id
  await step('mock-good (reference + honest claim) passes everything', () => {
    const rs = of('mock-good')
    assert.equal(rs.filter(r => r.passed).length, rs.length, rs.filter(r => !r.passed).map(r => `${r.task}: ${r.notes}`).join(' | '))
    assert.equal(rs.filter(r => r.falseDone).length, 0)
  })
  await step('mock-liar (does nothing, claims done) passes nothing and every claim is a false done', () => {
    const rs = of('mock-liar')
    assert.equal(rs.filter(r => r.passed).length, 0)
    assert.equal(rs.filter(r => r.falseDone).length, rs.length)
  })
  await step('mock-honest (does nothing, says blocked) passes only the impossible task', () => {
    const rs = of('mock-honest')
    assert.deepEqual([...new Set(rs.filter(r => r.passed).map(r => r.task))], [imp])
    assert.equal(rs.filter(r => r.falseDone).length, 0)
  })
  await step('writes results.json, per-run files and REPORT.md', () => {
    const report = readdirSync(out)
    assert.ok(report.includes('results.json') && report.includes('REPORT.md') && report.includes('runs'))
    assert.ok(readdirSync(join(out, 'runs', 'mock-good', tasks[0].id, 'run1')).includes('workspace'))
  })
  await step('report has the scoreboard, the trust table and the caveats', async () => {
    const { readFileSync } = await import('node:fs')
    const md = readFileSync(join(out, 'REPORT.md'), 'utf8')
    for (const s of ['## Scoreboard', '## By task', '## Can you trust "done"?', 'Read this before quoting the numbers', 'Mock: does nothing but claims done']) assert.ok(md.includes(s), `missing: ${s}`)
  })
  await step('resuming a finished run does no new work', async () => {
    const again = await runBenchmark({ contenderIds: ['mock-good'], runs: 2, outDir: out, log: () => {} })
    assert.equal(again.results.length, run.results.length)
  })
}
rmSync(out, { recursive: true, force: true })

console.log(failures === 0 ? '\nAll benchmark checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
