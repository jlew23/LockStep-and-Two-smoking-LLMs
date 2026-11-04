// Integration tests for evidence checks: the plugin verifies file claims against the
// real disk. Runs against the built lib/ on the fake host, via `node test.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgent, createHost, loop } from './tests/fake-host.mjs'
import * as report from './verdent-report/lib/index.js'

const tmp = () => mkdtemp(join(tmpdir(), 'vr-'))
const workspace = async (files: Record<string, string> = {}) => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-'))
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text)
  return dir
}
const savedReport = async (dir: string, id: string) => JSON.parse(await readFile(join(dir, 'reports', `${id}.worker.json`), 'utf8'))
const claim = (criterion: string, checks: unknown[], evidence = 'I checked') => ({ criterion, met: true, evidence, checks })

test('a wrong hex claim is caught, recorded as not met, and kept as a lesson', async () => {
  const ws = await workspace({ 'count.txt': '1\n' })
  const dir = await tmp()
  const host = createHost({ cwd: ws })
  await report.apply(host.ctx, { memoryDir: dir, role: 'all' })
  const wrong = await loop.tool(host, 'submit_worker_report_v1', {
    task_id: 'hexclaim', status: 'done', summary: 'Wrote count.txt',
    criteria: [claim('count.txt holds 1', [{ kind: 'hex', path: 'count.txt', hex: '31 10' }], 'hex 31 10')],
  }, createAgent('w'))
  assert.match(wrong, /hexclaim partial, 0\/1 met/)
  assert.match(wrong, /failed verification \(hex count\.txt: first difference at byte 1: the file has 0a, you claimed 10\)/)
  const saved = await savedReport(dir, 'hexclaim')
  assert.equal(saved.status, 'partial')
  assert.equal(saved.criteria[0].met, false)
  assert.equal(saved.criteria[0].verified, 'failed')
  assert.match(await readFile(join(dir, 'lessons', 'inbox.md'), 'utf8'), /A claim failed verification: "count\.txt holds 1"/)
  const right = await loop.tool(host, 'submit_worker_report_v1', {
    task_id: 'hexclaim', status: 'done', summary: 'Wrote count.txt',
    criteria: [claim('count.txt holds 1', [{ kind: 'hex', path: 'count.txt', hex: '31 0a' }, { kind: 'equals', path: 'count.txt', text: '1\n' }, { kind: 'size', path: 'count.txt', bytes: 2 }])],
  }, createAgent('w'))
  assert.match(right, /hexclaim done, 1\/1 met\. 1 verified\./)
  assert.match(await loop.tool(host, 'read_task_report_v1', { task_id: 'hexclaim' }), /worker done \(1\/1 met, 1 machine-verified\)/)
})

test('the verdict re-checks the worker claims, whatever the verifier says', async () => {
  const ws = await workspace({ 'out.txt': 'LockStep online\n' })
  const dir = await tmp()
  const host = createHost({ cwd: ws })
  await report.apply(host.ctx, { memoryDir: dir, role: 'all' })
  await loop.tool(host, 'submit_worker_report_v1', {
    task_id: 'recheck', status: 'done', summary: 'Write out.txt', playbook_steps: ['write the file'],
    criteria: [claim('out.txt says it', [{ kind: 'equals', path: 'out.txt', text: 'LockStep online\n' }])],
  }, createAgent('w'))
  const pass = await loop.tool(host, 'submit_verdict_v1', { task_id: 'recheck', verdict: 'PASS', criteria: [{ criterion: 'out.txt says it', met: true, evidence: 'read it' }] }, createAgent('v'))
  assert.match(pass, /PASS, 1\/1 pass\..*Playbook saved/)
  assert.equal((await readdir(join(dir, 'playbooks'))).filter(n => n.endsWith('.md')).length, 1)
  // The file changes after the worker reported; a lazy verifier still says PASS.
  await writeFile(join(ws, 'out.txt'), 'something else\n')
  const again = await loop.tool(host, 'submit_verdict_v1', { task_id: 'recheck', verdict: 'PASS', criteria: [{ criterion: 'out.txt says it', met: true, evidence: 'looks fine' }] }, createAgent('v'))
  assert.match(again, /recorded as FAIL: 1 of the worker's file claims do not hold on disk/)
  assert.match(again, /Its playbook was retired\./)
  assert.equal((await readdir(join(dir, 'playbooks'))).filter(n => n.endsWith('.md')).length, 0)
  const v = JSON.parse(await readFile(join(dir, 'reports', 'recheck.verdict.json'), 'utf8'))
  assert.equal(v.verdict, 'FAIL')
  assert.match(v.notes, /re-checked at grading and failed.*equals out\.txt/)
})

test('paths cannot leave the workspace', async () => {
  const parent = await workspace({ 'secret.txt': 'TOP-SECRET-CONTENT' })
  const ws = join(parent, 'work')
  await mkdir(ws)
  await writeFile(join(ws, 'ok.txt'), 'ok')
  const dir = await tmp()
  const host = createHost({ cwd: ws })
  await report.apply(host.ctx, { memoryDir: dir, role: 'worker' })
  const out = await loop.tool(host, 'submit_worker_report_v1', {
    task_id: 'escape', status: 'done', summary: 's',
    criteria: [
      claim('relative escape', [{ kind: 'contains', path: '../secret.txt', text: 'guess' }]),
      claim('absolute escape', [{ kind: 'exists', path: join(parent, 'secret.txt') }]),
      claim('inside is fine', [{ kind: 'equals', path: 'ok.txt', text: 'ok' }]),
    ],
  }, createAgent('w'))
  assert.match(out, /escape partial, 1\/3 met/)
  const saved = await savedReport(dir, 'escape')
  assert.match(saved.criteria[0].evidence, /the path is outside the workspace/)
  assert.match(saved.criteria[1].evidence, /the path is outside the workspace/)
  assert.ok(!JSON.stringify(saved).includes('TOP-SECRET-CONTENT'), 'a file outside the workspace is never read')
  assert.equal(saved.criteria[2].verified, 'passed')
})

test('with no known workspace a file claim fails closed; checkRoot supplies one', async () => {
  const ws = await workspace({ 'a.txt': 'a' })
  const args = { task_id: 'noroot', status: 'done', summary: 's', criteria: [claim('a exists', [{ kind: 'exists', path: 'a.txt' }])] }
  const dirA = await tmp()
  const hostA = createHost()
  await report.apply(hostA.ctx, { memoryDir: dirA, role: 'worker' })
  assert.match(await loop.tool(hostA, 'submit_worker_report_v1', args, createAgent('w')), /noroot partial, 0\/1 met.*workspace folder is unknown/)
  const dirB = await tmp()
  const hostB = createHost()
  await report.apply(hostB.ctx, { memoryDir: dirB, role: 'worker', checkRoot: ws })
  assert.match(await loop.tool(hostB, 'submit_worker_report_v1', args, createAgent('w')), /noroot done, 1\/1 met\. 1 verified/)
  await assert.rejects(report.apply(createHost().ctx, { memoryDir: dirB, role: 'worker', checkRoot: 'relative/dir' }), /checkRoot must be a full folder path/)
})

test('strict mode records claims without checks as not met; malformed checks are refused', async () => {
  const ws = await workspace({ 'a.txt': 'a' })
  const dir = await tmp()
  const host = createHost({ cwd: ws })
  await report.apply(host.ctx, { memoryDir: dir, role: 'worker', requireChecks: true })
  const out = await loop.tool(host, 'submit_worker_report_v1', {
    task_id: 'strict', status: 'done', summary: 's',
    criteria: [{ criterion: 'trust me', met: true, evidence: 'I did it' }, claim('a is there', [{ kind: 'exists', path: 'a.txt' }])],
  }, createAgent('w'))
  assert.match(out, /strict partial, 1\/2 met.*"trust me" had no checks; recorded as not met/)
  await assert.rejects(loop.tool(host, 'submit_worker_report_v1', {
    task_id: 'strict2', status: 'done', summary: 's', criteria: [claim('x', [{ kind: 'hex', path: 'a.txt', hex: 'zz' }])],
  }, createAgent('w')), /not valid hex\. Give whole bytes as hex digits.*Call again/)
})
