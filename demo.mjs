// Runnable demo for LockStep. Runs the two plugins on the stand-in host from
// tests/fake-host.mjs: no DeepSeek Harness install, no API key, no network.
//
//   node build.mjs && node demo.mjs
//
// Every line printed below comes from the plugins' real code paths. The agents
// are scripted: this is a simulation of four failure modes, not a live run.
//
// Like test.mjs, the demo copies the plugins to a temp folder and gives them
// tiny stand-ins for the two DeepSeek helper packages, so nothing is written
// into this repo and the real packages are never shadowed.
import { cp, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const sandbox = await mkdtemp(join(tmpdir(), 'lockstep-demo-'))
for (const p of ['verdent-report', 'model-fallback', 'tests']) {
  await cp(join(root, p), join(sandbox, p), { recursive: true })
}
const stubs = {
  'dsh-tools': 'export const defineTool = t => t\n',
  'dsh-llm': 'export const createUserMessage = m => ({ ...m, role: "user" })\n',
}
for (const [name, code] of Object.entries(stubs)) {
  const dir = join(sandbox, 'node_modules', '@deepseek-ai', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, type: 'module', main: 'index.js' }))
  await writeFile(join(dir, 'index.js'), code)
}

const hostModule = await import(pathToFileURL(join(sandbox, 'tests', 'fake-host.mjs')).href)
const report = await import(pathToFileURL(join(sandbox, 'verdent-report', 'lib', 'index.js')).href)
const fallback = await import(pathToFileURL(join(sandbox, 'model-fallback', 'lib', 'index.js')).href)
const { createAgent, createHost, loop, mountLlmRetry, step, msg } = hostModule

const line = (s = '') => console.log(s)
const scene = (n, title) => {
  line()
  line(`\x1b[1mScene ${n} — ${title}\x1b[0m`)
  line('─'.repeat(72))
}
const out = label => s => line(`  ${label.padEnd(10)} ${String(s).replace(/\n/g, '\n             ')}`)

const ws = await mkdtemp(join(tmpdir(), 'lockstep-demo-ws-'))
const mem = await mkdtemp(join(tmpdir(), 'lockstep-demo-mem-'))
await writeFile(join(ws, 'VERSION'), '1.4.0\n')

const host = createHost({ cwd: ws, presets: { w: 'worker-verdent', v: 'verifier-verdent' } })
await report.apply(host.ctx, { memoryDir: mem, role: 'all' })
const worker = createAgent('worker-1')
const verifier = createAgent('verifier-1')

line('LockStep demo — stand-in host, scripted agents, no API calls.')
line(`workspace: ${ws}`)
line(`memory:    ${mem}`)

// 1. A report claims a file says 1.4.1. The file says 1.4.0. The plugin reads
//    the file and downgrades the report instead of trusting the claim.
scene(1, 'A Worker reports "done" and a file claim that is false')
out('worker →')(await loop.tool(host, 'submit_worker_report_v1', {
  task_id: 'bump-version',
  status: 'done',
  summary: 'Bumped VERSION to 1.4.1',
  criteria: [{
    criterion: 'VERSION is exactly 1.4.1',
    met: true,
    evidence: 'I wrote it',
    checks: [{ kind: 'equals', path: 'VERSION', text: '1.4.1\n' }],
  }],
  lessons: ['VERSION is the one that ships'],
}, worker))

// 2. The Worker actually fixes the file and resubmits. Now the claim verifies,
//    and a Verifier PASS saves a playbook named after the report id.
scene(2, 'The Worker fixes the file; the Verifier passes; a playbook is saved')
await writeFile(join(ws, 'VERSION'), '1.4.1\n')
out('worker →')(await loop.tool(host, 'submit_worker_report_v1', {
  task_id: 'bump-version',
  status: 'done',
  summary: 'Bumped VERSION to 1.4.1',
  criteria: [{
    criterion: 'VERSION is exactly 1.4.1',
    met: true,
    evidence: 'wrote 1.4.1 with a trailing newline',
    checks: [{ kind: 'equals', path: 'VERSION', text: '1.4.1\n' }],
  }],
  playbook_steps: ['read VERSION', 'write the new value with one trailing newline', 're-read it'],
}, worker))
out('verifier →')(await loop.tool(host, 'submit_verdict_v1', {
  task_id: 'bump-version',
  verdict: 'PASS',
  criteria: [{ criterion: 'VERSION is exactly 1.4.1', met: true, evidence: 'read the file' }],
}, verifier))
const playbooks = (await readdir(join(mem, 'playbooks'))).filter((n) => n.endsWith('.md'))
line(`  playbooks  ${playbooks.join(', ') || '(none)'}`)

// 3. The file changes after the Worker reported. The Verifier still says PASS,
//    but the plugin re-checks the Worker's file claims on disk and records FAIL.
scene(3, 'The file changes before grading; the Verifier\'s PASS becomes a FAIL')
await writeFile(join(ws, 'VERSION'), '1.4.2\n')
out('verifier →')(await loop.tool(host, 'submit_verdict_v1', {
  task_id: 'bump-version',
  verdict: 'PASS',
  criteria: [{ criterion: 'VERSION is exactly 1.4.1', met: true, evidence: 'looks fine to me' }],
}, verifier))
line(`  playbooks  ${(await readdir(join(mem, 'playbooks'))).filter((n) => n.endsWith('.md')).join(', ') || '(none — the playbook was retired)'}`)

// 4. A provider outage. The step that hits it still fails; from the next turn
//    the agent runs on the backup, and other agents follow the outage memory.
scene(4, 'A provider outage: the failing step fails, the fleet moves to the backup')
const fleet = createHost()
mountLlmRetry(fleet, { maxRetries: 1 })
fallback.apply(fleet.ctx, { chains: { 'deepseek-v4-pro': ['deepseek-flash'] }, cooldownMs: 50 })
const a = createAgent('agent-a')
const b = createAgent('agent-b')
const s1 = await step(fleet, a, { turn: 1, outcomes: ['SERVER', 'SERVER'] })
line(`  agent-a    turn 1 on ${s1.selection.model}: ${s1.result} after ${s1.attempts} attempt(s) — the failing step still fails`)
const s2 = await step(fleet, a, { turn: 2, messages: [msg.agent('retry it')] })
line(`  agent-a    turn 2 on ${s2.selection.model} — the backup, no retry burned`)
const s3 = await step(fleet, b, { turn: 1 })
line(`  agent-b    turn 1 on ${s3.selection.model} — its first step was already fixed`)
const s3b = await step(fleet, b, { turn: 2 })
line(`  agent-b    turn 2 on ${s3b.selection.model} — follows the outage it never hit`)
await new Promise((r) => setTimeout(r, 80))
await loop.stop(fleet, a, 2)
const s4 = await step(fleet, a, { turn: 3 })
line(`  agent-a    turn 3 on ${s4.selection.model} — back to the primary after the cooldown`)

line()
line('\x1b[1mDone.\x1b[0m Four failure modes, each handled by a plugin. The same checks run in')
line('`node test.mjs` (41 tests) against the stand-in host.')
line('\x1b[2mSimulated host and scripted agents: this demo does not call a model.\x1b[0m')
