#!/usr/bin/env node
// Grade a contender that is run by hand (an agent in a chat window, another tool, a person).
// Same tasks, same prompt, same hidden graders as the automatic runs.
//
//   node benchmark/grade.mjs setup <contender> <task> --out <dir> [--label "Name"]
//        creates a fresh workspace, saves the protected-file snapshot, prints the workspace path and the prompt
//   node benchmark/grade.mjs grade <contender> <task> --out <dir> --claim done|partial|blocked|none
//        grades the workspace and records the result in <dir>/results.json
//   node benchmark/grade.mjs report --out <dir>
//        writes <dir>/REPORT.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gradeRecord } from './run.mjs'
import { hashPaths } from './lib.mjs'
import { buildPrompt } from './prompt.mjs'
import { buildReport } from './report.mjs'
import { tasks } from './tasks/index.mjs'

const args = process.argv.slice(2)
const [cmd, a1, a2] = args
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const outDir = resolve(opt('--out') ?? '.')
const resultsPath = join(outDir, 'results.json')
const load = () => (existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : { meta: { startedAt: new Date().toISOString(), runs: 1, contenders: [], skipped: {}, tasks: [] }, results: [] })
const runDirOf = (contender, task, run = 1) => join(outDir, 'runs', contender, task, `run${run}`)

function usage() {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'))
  process.exit(1)
}

if (cmd === 'setup') {
  const task = tasks.find(t => t.id.startsWith(a2 ?? '\0'))
  if (!a1 || !task) usage()
  const runDir = runDirOf(a1, task.id)
  const workspace = join(runDir, 'workspace')
  mkdirSync(workspace, { recursive: true })
  await task.setup(workspace)
  const prompt = buildPrompt(task)
  writeFileSync(join(runDir, 'prompt.txt'), prompt)
  writeFileSync(join(runDir, 'before.json'), JSON.stringify({ startedAt: Date.now(), protected: hashPaths(workspace, task.protected) }))
  console.log(`WORKSPACE: ${workspace}\n\nPROMPT:\n${prompt}`)
} else if (cmd === 'grade') {
  const task = tasks.find(t => t.id.startsWith(a2 ?? '\0'))
  if (!a1 || !task) usage()
  const runDir = runDirOf(a1, task.id)
  const workspace = join(runDir, 'workspace')
  const saved = JSON.parse(readFileSync(join(runDir, 'before.json'), 'utf8'))
  const claim = opt('--claim') ?? 'none'
  const text = claim === 'none' ? '' : JSON.stringify({ status: claim, summary: opt('--summary') ?? '' })
  const record = await gradeRecord({
    contender: { id: a1 }, task, runIndex: 0, runDir, workspace, before: saved.protected,
    res: { text, stdout: text, stderr: '', ms: Date.now() - saved.startedAt, code: 0, timedOut: false },
  })
  const data = load()
  if (!data.meta.contenders.some(c => c.id === a1)) data.meta.contenders.push({ id: a1, label: opt('--label') ?? a1 })
  if (!data.meta.tasks.includes(task.id)) data.meta.tasks.push(task.id)
  data.results = data.results.filter(r => !(r.contender === a1 && r.task === task.id))
  data.results.push(record)
  writeFileSync(resultsPath, JSON.stringify(data, null, 2))
  console.log(`${record.passed ? 'PASS' : 'FAIL'} ${task.id} (claimed ${record.claimed ?? 'nothing'}${record.falseDone ? ', FALSE DONE' : ''}, ${(record.ms / 1000).toFixed(0)}s)`)
  for (const n of record.notes) console.log(`  - ${n}`)
} else if (cmd === 'report') {
  const data = load()
  writeFileSync(join(outDir, 'REPORT.md'), buildReport(data))
  console.log(join(outDir, 'REPORT.md'))
} else usage()
