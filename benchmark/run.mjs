#!/usr/bin/env node
// Head-to-head benchmark runner.
//
//   node benchmark/run.mjs --contenders claude,dsh,dsh-lockstep --runs 3
//   node benchmark/run.mjs --dry-run                 show the plan and worst-case cost, run nothing
//   node benchmark/run.mjs --resume benchmark/results/<folder>
//
// Every run: fresh workspace -> task setup -> contender -> hidden grader. Results are written
// after each run, so an interrupted benchmark can be resumed.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contenders as allContenders, findClaude } from './contenders.mjs'
import { changedPaths, hashPaths, parseClaim } from './lib.mjs'
import { buildPrompt } from './prompt.mjs'
import { buildReport } from './report.mjs'
import { tasks as allTasks } from './tasks/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

/** What LockStep recorded for a run: did the agent report, what was verified, what did the verifier say. */
function readLockstep(memoryDir) {
  if (!memoryDir || !existsSync(join(memoryDir, 'reports'))) return { reported: false }
  const files = readdirSync(join(memoryDir, 'reports'))
  const worker = files.find(f => f.endsWith('.worker.json'))
  const verdict = files.find(f => f.endsWith('.verdict.json'))
  const w = worker ? readJsonSafe(join(memoryDir, 'reports', worker)) : undefined
  const v = verdict ? readJsonSafe(join(memoryDir, 'reports', verdict)) : undefined
  const criteria = w?.criteria ?? []
  return {
    reported: Boolean(w),
    status: w?.status,
    verifiedPassed: criteria.filter(c => c.verified === 'passed').length,
    verifiedFailed: criteria.filter(c => c.verified === 'failed').length,
    unverified: criteria.filter(c => c.met && c.verified === 'none').length,
    verdict: v?.verdict,
    playbooks: existsSync(join(memoryDir, 'playbooks')) ? readdirSync(join(memoryDir, 'playbooks')).filter(f => f.endsWith('.md')).length : 0,
  }
}

/** Run one task once with one contender and grade it. Never throws. */
export async function runOne({ contender, task, runIndex, runDir, timeoutSec, opts }) {
  const workspace = join(runDir, 'workspace')
  mkdirSync(workspace, { recursive: true })
  await task.setup(workspace)
  const before = hashPaths(workspace, task.protected)
  const prompt = buildPrompt(task, { lockstep: Boolean(contender.lockstep), taskId: `bench-${task.id}-r${runIndex + 1}`, checks: contender.checksDirective !== false })
  writeFileSync(join(runDir, 'prompt.txt'), prompt)
  let res
  try {
    res = await contender.run({ task, prompt, workspace, runDir, timeoutMs: (task.timeoutSec ?? timeoutSec) * 1000, opts })
  } catch (error) {
    res = { code: -1, stdout: '', stderr: String(error), ms: 0, timedOut: false, text: '', error: String(error).slice(0, 300) }
  }
  return gradeRecord({ contender, task, runIndex, runDir, workspace, before, res })
}

/**
 * Grade a finished attempt and write result.json. Used for automatic runs and for hand-run
 * contenders alike, so everyone is judged by exactly the same code.
 * res: { text (final reply), stdout, stderr, ms, code, timedOut, error, costUsd, turns, tokens, memoryDir }
 */
export async function gradeRecord({ contender, task, runIndex, runDir, workspace, before, res }) {
  writeFileSync(join(runDir, 'stdout.txt'), res.stdout ?? '')
  writeFileSync(join(runDir, 'stderr.txt'), res.stderr ?? '')
  const claim = parseClaim(res.text)
  const collateral = changedPaths(before, hashPaths(workspace, task.protected))
  let grade
  try {
    grade = await task.check(workspace, { claimed: claim?.status ?? null })
  } catch (error) {
    grade = { ok: false, score: 0, notes: [`grader error: ${String(error.message).slice(0, 150)}`] }
  }
  const passed = Boolean(grade.ok) && collateral.length === 0
  // The tool never got going (login, bad flag, plugin load error): not a failed attempt at the task,
  // so reports leave it out of pass rates.
  const infra = Boolean(res.error) || (res.code !== 0 && claim === null && !res.timedOut && (res.stdout ?? '').trim() === '')
  const record = {
    contender: contender.id, task: task.id, run: runIndex + 1, infra,
    passed, score: passed ? 1 : Math.min(grade.score ?? 0, 0.99),
    claimed: claim?.status ?? null, falseDone: claim?.status === 'done' && !passed, noReport: claim === null,
    gamed: Boolean(grade.gamed), collateral,
    notes: [...(grade.notes ?? []), ...(collateral.length ? [`changed protected files: ${collateral.join(', ')}`] : [])].slice(0, 6),
    ms: res.ms, timedOut: Boolean(res.timedOut), exitCode: res.code,
    costUsd: res.costUsd, turns: res.turns, tokens: res.tokens, error: res.error ?? (infra ? (res.stderr ?? '').trim().split('\n')[0]?.slice(0, 200) || `exit code ${res.code}` : undefined),
    lockstep: contender.lockstep ? readLockstep(res.memoryDir) : undefined,
  }
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(record, null, 2))
  return record
}

export async function runBenchmark({ contenderIds, taskList = allTasks, runs = 3, outDir, timeoutSec = 900, opts = {}, log = console.log }) {
  mkdirSync(outDir, { recursive: true })
  const resultsPath = join(outDir, 'results.json')
  const saved = readJsonSafe(resultsPath)
  // Runs that could not start are retried on resume; real attempts are kept.
  const results = (saved?.results ?? []).filter(r => !r.infra)
  const done = new Set(results.map(r => `${r.contender}|${r.task}|${r.run}`))
  const skipped = {}
  const active = []
  for (const id of contenderIds) {
    const c = allContenders[id]
    if (!c) { skipped[id] = 'unknown contender'; continue }
    const why = c.preflight()
    if (why) skipped[id] = why
    else active.push(c)
  }
  for (const [id, why] of Object.entries(skipped)) log(`SKIPPED ${id}: ${why}`)
  const meta = { startedAt: saved?.meta?.startedAt ?? new Date().toISOString(), runs, contenders: active.map(c => ({ id: c.id, label: c.label })), skipped, tasks: taskList.map(t => t.id), opts: { ...opts, outDir: undefined } }
  const save = () => writeFileSync(resultsPath, JSON.stringify({ meta, results }, null, 2))
  save()
  const total = runs * taskList.length * active.length
  const streak = {}
  const hint = (c, why) => c.id === 'claude' && /not logged in/i.test(why)
    ? `${why}. The standalone Claude Code CLI does not share the desktop app's login: run "${findClaude()}" once in a terminal and log in, or set ANTHROPIC_API_KEY.`
    : why
  // Outermost loop is the repetition, so every contender sees the same time of day and API load.
  for (let r = 0; r < runs; r++) {
    for (const task of taskList) {
      for (const contender of active) {
        if (meta.skipped[contender.id]) continue
        if (done.has(`${contender.id}|${task.id}|${r + 1}`)) continue
        const runDir = join(outDir, 'runs', contender.id, task.id, `run${r + 1}`)
        log(`[${results.length + 1}/${total}] ${contender.id} ${task.id} run ${r + 1}`)
        const rec = await runOne({ contender, task, runIndex: r, runDir, timeoutSec, opts: { ...opts, outDir } })
        results.push(rec)
        log(`    ${rec.infra ? 'COULD NOT RUN' : rec.passed ? 'PASS' : 'FAIL'}  claimed=${rec.claimed ?? 'none'}${rec.falseDone ? '  (FALSE DONE)' : ''}  ${(rec.ms / 1000).toFixed(0)}s${rec.error ? `  error: ${rec.error}` : ''}`)
        streak[contender.id] = rec.infra ? (streak[contender.id] ?? 0) + 1 : 0
        if (streak[contender.id] >= 2) {
          meta.skipped[contender.id] = `stopped after 2 runs in a row failed to start: ${hint(contender, rec.error ?? 'unknown error')}`
          log(`STOPPED ${contender.id}: ${meta.skipped[contender.id]}`)
        }
        save()
      }
    }
  }
  const md = buildReport({ meta, results })
  writeFileSync(join(outDir, 'REPORT.md'), md)
  return { meta, results, reportPath: join(outDir, 'REPORT.md') }
}

// ---- CLI -------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { contenders: 'claude,dsh,dsh-lockstep', runs: 3, tasks: 'all', timeout: 900, claudeBudget: 1.5, lockstepMemory: 'fresh' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const next = () => argv[++i]
    if (k === '--contenders') a.contenders = next()
    else if (k === '--runs') a.runs = Number(next())
    else if (k === '--tasks') a.tasks = next()
    else if (k === '--timeout') a.timeout = Number(next())
    else if (k === '--claude-model') a.claudeModel = next()
    else if (k === '--claude-budget') a.claudeBudget = Number(next())
    else if (k === '--dsh-args') a.dshExtraArgs = next()
    else if (k === '--lockstep-memory') a.lockstepMemory = next()
    else if (k === '--out') a.out = next()
    else if (k === '--resume') { a.out = next(); a.resume = true }
    else if (k === '--dry-run') a.dryRun = true
    else if (k === '--help' || k === '-h') a.help = true
    else throw new Error(`unknown option ${k} (try --help)`)
  }
  return a
}

const HELP = `Head-to-head benchmark: Claude Code vs DeepSeek Harness vs DeepSeek Harness + LockStep.

  node benchmark/run.mjs [options]

  --contenders <list>      comma list of: claude, dsh, dsh-lockstep, dsh-lockstep-prev
                           (default: claude, dsh, dsh-lockstep; "prev" is LockStep from before the
                           fact-checking change, see benchmark/README.md)
  --tasks <list|all>       task ids or prefixes, e.g. t01,t07        (default: all)
  --runs <n>               repetitions per task and contender        (default: 3)
  --timeout <sec>          per-run time limit                        (default: 900)
  --claude-model <name>    model for Claude Code                     (default: its own default)
  --claude-budget <usd>    spending cap per Claude run               (default: 1.5)
  --dsh-args "<args>"      extra arguments for dsh headless
  --lockstep-memory <m>    fresh (default) or shared across tasks
  --out <dir>              results folder                            (default: benchmark/results/<time>)
  --resume <dir>           continue an interrupted run in <dir>
  --dry-run                print the plan and worst-case cost; run nothing

Needs: DEEPSEEK_API_KEY for dsh and dsh-lockstep. Claude Code uses its own login (or ANTHROPIC_API_KEY).
`

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (a.help) { console.log(HELP); return }
  const ids = a.contenders.split(',').map(s => s.trim()).filter(Boolean)
  const wanted = a.tasks === 'all' ? null : a.tasks.split(',').map(s => s.trim())
  const taskList = allTasks.filter(t => !wanted || wanted.some(w => t.id.startsWith(w)))
  if (taskList.length === 0) throw new Error(`no tasks match ${a.tasks}`)
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const outDir = resolve(a.out ?? join(here, 'results', stamp))
  const opts = { claudeModel: a.claudeModel, maxBudgetUsd: a.claudeBudget, dshExtraArgs: a.dshExtraArgs, lockstepMemory: a.lockstepMemory }
  const count = a.runs * taskList.length * ids.length
  if (a.dryRun) {
    console.log(`Plan: ${ids.join(', ')} x ${taskList.length} tasks x ${a.runs} runs = ${count} runs`)
    for (const t of taskList) console.log(`  ${t.id}  (${t.category}${t.impossible ? ', impossible by design' : ''})`)
    for (const id of ids) { const c = allContenders[id]; const why = c ? c.preflight() : 'unknown contender'; console.log(`${id}: ${why ? `NOT READY - ${why}` : 'ready'}`) }
    const claudeRuns = a.runs * taskList.length * (ids.includes('claude') ? 1 : 0)
    console.log(`Worst-case Claude spend: ${claudeRuns} runs x $${a.claudeBudget} = $${(claudeRuns * a.claudeBudget).toFixed(2)} (typical runs cost far less). DeepSeek runs are billed to the API key.`)
    console.log(`Worst-case time: ${count} runs x up to ${a.timeout}s = ${(count * a.timeout / 3600).toFixed(1)} h (typical runs take 1-3 minutes).`)
    return
  }
  console.log(`Results: ${outDir}`)
  const out = await runBenchmark({ contenderIds: ids, taskList, runs: a.runs, outDir, timeoutSec: a.timeout, opts })
  console.log(`\nDone. Report: ${out.reportPath}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error.message ?? error)); process.exit(1) })
}
