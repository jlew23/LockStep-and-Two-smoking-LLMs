#!/usr/bin/env node
// Turns results.json into REPORT.md.   node benchmark/report.mjs benchmark/results/<folder>
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { median, wilson } from './lib.mjs'

const pct = x => `${Math.round(x * 100)}%`
const range = (k, n) => { const [lo, hi] = wilson(k, n); return `${pct(lo)}-${pct(hi)}` }
const secs = ms => (ms === null || ms === undefined ? 'n/a' : ms >= 90_000 ? `${(ms / 60_000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`)
const sum = xs => xs.reduce((a, b) => a + b, 0)

export function buildReport({ meta, results: everyRun }) {
  // Runs where the tool never got going (login, bad flag, plugin error) say nothing about the contender.
  const infra = everyRun.filter(r => r.infra)
  const results = everyRun.filter(r => !r.infra)
  const ids = meta.contenders.map(c => c.id)
  const label = Object.fromEntries(meta.contenders.map(c => [c.id, c.label]))
  const by = id => results.filter(r => r.contender === id)
  const lines = []
  lines.push('# Head-to-head benchmark', '')
  lines.push(`Run started ${meta.startedAt}. ${meta.runs} run(s) per task and contender, ${meta.tasks.length} tasks, ${results.length} graded runs.`)
  if (infra.length || Object.keys(meta.skipped ?? {}).length) {
    lines.push('', '> **Some runs could not happen. They are excluded from every number below.**')
    for (const id of ids) {
      const bad = infra.filter(r => r.contender === id)
      if (bad.length) lines.push(`> - **${label[id]}**: ${bad.length} run(s) failed to start. First error: ${String(bad[0].error ?? 'unknown').slice(0, 200)}`)
    }
    for (const [id, why] of Object.entries(meta.skipped ?? {})) lines.push(`> - ${id}: ${why}`)
  }
  lines.push('', '## Scoreboard', '')
  lines.push('| Contender | Passed | 95% range | Mean score | Said "done" and was wrong | No report | Touched protected files | Timeouts / errors | Median time | Cost |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const id of ids) {
    const rs = by(id)
    const n = rs.length
    if (n === 0) continue
    const passed = rs.filter(r => r.passed).length
    const claimedDone = rs.filter(r => r.claimed === 'done').length
    const falseDone = rs.filter(r => r.falseDone).length
    const costs = rs.map(r => r.costUsd).filter(Number.isFinite)
    lines.push(`| **${label[id]}** | ${passed}/${n} (${pct(passed / n)}) | ${range(passed, n)} | ${(sum(rs.map(r => r.score)) / n).toFixed(2)} | ${falseDone}/${claimedDone || 0} | ${rs.filter(r => r.noReport).length} | ${rs.filter(r => r.collateral.length).length} | ${rs.filter(r => r.timedOut || r.error).length} | ${secs(median(rs.map(r => r.ms)))} | ${costs.length ? `$${sum(costs).toFixed(2)}` : 'n/a'} |`)
  }
  lines.push('', '*Passed* means the hidden grader accepted the result and no protected file was touched. *Said "done" and was wrong* counts runs where the agent reported `done` but the grader disagreed (shown as wrong/total done claims). The 95% range is a Wilson interval: with few runs it is wide, and two contenders whose ranges overlap should not be called different.')

  lines.push('', '## By task (passed / runs)', '')
  lines.push(`| Task | Category | ${ids.map(i => label[i]).join(' | ')} |`)
  lines.push(`|---|---|${ids.map(() => '---').join('|')}|`)
  for (const t of meta.tasks) {
    const cat = results.find(r => r.task === t)
    const cells = ids.map((id) => {
      const rs = results.filter(r => r.contender === id && r.task === t)
      return rs.length ? `${rs.filter(r => r.passed).length}/${rs.length}` : '-'
    })
    lines.push(`| ${t}${cat ? '' : ''} | ${categoryOf(t)} | ${cells.join(' | ')} |`)
  }

  lines.push('', '## Can you trust "done"?', '')
  lines.push('| Contender | Runs saying done | Actually passed | Claim accuracy | Honest on the impossible task |')
  lines.push('|---|---|---|---|---|')
  for (const id of ids) {
    const rs = by(id)
    if (rs.length === 0) continue
    const done = rs.filter(r => r.claimed === 'done')
    const right = done.filter(r => r.passed).length
    const imp = rs.filter(r => r.task.includes('impossible'))
    lines.push(`| **${label[id]}** | ${done.length} | ${right} | ${done.length ? `${pct(right / done.length)} (${range(right, done.length)})` : 'n/a'} | ${imp.length ? `${imp.filter(r => r.passed).length}/${imp.length}` : 'n/a'} |`)
  }

  const ls = results.filter(r => r.lockstep)
  if (ls.length) {
    lines.push('', '## What LockStep did', '')
    const reported = ls.filter(r => r.lockstep.reported).length
    const caught = ls.filter(r => r.lockstep.verifiedFailed > 0).length
    const verifiedClaims = sum(ls.map(r => r.lockstep.verifiedPassed ?? 0))
    const verdicts = ls.filter(r => r.lockstep.verdict)
    lines.push(`- The agent used the LockStep report tools in ${reported}/${ls.length} runs.`)
    lines.push(`- Wrong file claims caught and recorded as not met: in ${caught} run(s).`)
    lines.push(`- File claims verified true against the disk: ${verifiedClaims}.`)
    lines.push(`- Verifier verdicts recorded: ${verdicts.length} (${verdicts.filter(r => r.lockstep.verdict === 'FAIL').length} FAIL).`)
    lines.push('- Compare the LockStep row with plain DeepSeek Harness: they use the same model, so the difference is LockStep (and its extra prompt) alone.')
  }

  const failing = results.filter(r => !r.passed && r.notes.length)
  if (failing.length) {
    lines.push('', '## Why runs failed (first examples)', '')
    for (const id of ids) {
      for (const t of meta.tasks) {
        const f = failing.find(r => r.contender === id && r.task === t)
        if (f) lines.push(`- **${label[id]}**, ${t}, run ${f.run}: ${f.notes.slice(0, 2).join('; ').replaceAll('\n', ' ').slice(0, 260)}`)
      }
    }
  }

  lines.push('', '## Read this before quoting the numbers', '')
  lines.push('- **The models differ.** Claude Code runs an Anthropic model; the two DeepSeek rows run a DeepSeek model. Claude Code vs DeepSeek Harness compares whole products (harness and model together), not harnesses alone.')
  lines.push('- **The clean comparison is DeepSeek Harness vs DeepSeek Harness + LockStep.** Same model, same tasks. LockStep also gets its documented process directive appended to the prompt, so this measures the plugin as it is meant to be used.')
  lines.push('- **Small samples.** Nine tasks is a smoke test, not a leaderboard. Use `--runs 5` or more and read the 95% ranges.')
  lines.push('- **All tasks are offline, small, and graded by scripts**, so they favor precision and honesty over open-ended engineering. They say little about large codebases.')
  lines.push('- **Isolation.** DeepSeek runs use a clean DSH_HOME with no extra tools. Claude Code runs without user plugins, MCP servers or skills, but still carry its built-in system prompt and tools.')
  lines.push('- Raw outputs, prompts and workspaces for every run are kept under `runs/` for audit.')
  return lines.join('\n') + '\n'
}

import { tasks } from './tasks/index.mjs'
const categoryOf = id => tasks.find(t => t.id === id)?.category ?? ''

/** Merge several results folders (for example an automatic run and a hand-run contender) into one data set. */
export function mergeResults(datasets) {
  const meta = { startedAt: datasets.map(d => d.meta.startedAt).sort()[0], runs: Math.max(...datasets.map(d => d.meta.runs ?? 1)), contenders: [], skipped: {}, tasks: [] }
  const byKey = new Map()
  for (const d of datasets) {
    for (const c of d.meta.contenders) if (!meta.contenders.some(x => x.id === c.id)) meta.contenders.push(c)
    for (const t of d.meta.tasks) if (!meta.tasks.includes(t)) meta.tasks.push(t)
    Object.assign(meta.skipped, d.meta.skipped ?? {})
    for (const r of d.results) byKey.set(`${r.contender}|${r.task}|${r.run}`, r)
  }
  meta.tasks.sort()
  return { meta, results: [...byKey.values()] }
}

// node benchmark/report.mjs <folder> [<folder> ...]   (several folders are merged; the report is written to the first)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = (process.argv.length > 2 ? process.argv.slice(2) : ['.']).map(d => resolve(d))
  const data = mergeResults(dirs.map(dir => JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'))))
  const md = buildReport(data)
  writeFileSync(join(dirs[0], 'REPORT.md'), md)
  console.log(md)
}
