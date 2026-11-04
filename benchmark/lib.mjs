// Shared helpers for the benchmark: file trees, hashing, running programs with a hard timeout.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** Write {relativePath: string|Buffer} under dir, creating folders. */
export function writeTree(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

export const sha256 = data => createHash('sha256').update(data).digest('hex')

/** Hash every file under each path (file or folder), keyed by path relative to dir. Missing paths hash as null. */
export function hashPaths(dir, paths) {
  const out = {}
  const walk = (abs) => {
    let st
    try { st = statSync(abs) } catch { out[relative(dir, abs).replaceAll('\\', '/')] = null; return }
    if (st.isDirectory()) for (const name of readdirSync(abs).sort()) walk(join(abs, name))
    else out[relative(dir, abs).replaceAll('\\', '/')] = sha256(readFileSync(abs))
  }
  for (const p of paths) walk(join(dir, p))
  return out
}

/** Files whose hash differs from the snapshot (changed, deleted, or new inside a protected folder). */
export function changedPaths(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...names].filter(n => before[n] !== after[n]).sort()
}

/**
 * Run a program with a hard timeout; the whole process tree is killed on timeout.
 * Never rejects: problems come back in the result.
 */
export function runCommand(command, args, { cwd, env, timeoutMs = 600_000, input } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stdout, stderr: String(error), timedOut, ms: 0 })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      else child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', (error) => { stderr += String(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr, timedOut, ms: Date.now() - started })
    })
    child.stdin.on('error', () => {})
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

/** Run a small Node program (as text) and return its parsed JSON output, or an error. Used by graders. */
export async function runNodeJson(script, args, { cwd, timeoutMs = 30_000 } = {}) {
  const r = await runCommand(process.execPath, ['-e', script, ...args], { cwd, timeoutMs })
  if (r.timedOut) return { error: 'timed out' }
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    return { error: (r.stderr || r.stdout || `exit ${r.code}`).trim().slice(0, 300) }
  }
}

/** Run `node --test <files>` in dir; returns {passed, failed, ok}. */
export async function runNodeTests(dir, files, { timeoutMs = 60_000 } = {}) {
  const r = await runCommand(process.execPath, ['--test', ...files], { cwd: dir, timeoutMs })
  const num = name => Number((r.stdout.match(new RegExp(`^ℹ ${name} (\\d+)`, 'm')) ?? [])[1] ?? 0)
  return { passed: num('pass'), failed: num('fail'), ok: r.code === 0 && !r.timedOut && num('pass') > 0, output: (r.stdout + r.stderr).slice(-600) }
}

/** The last JSON object on its own line that has a "status" field, as the agent was asked to print. */
export function parseClaim(text) {
  const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean).reverse()
  for (const line of lines) {
    const candidate = line.replace(/^```(json)?|```$/g, '').trim()
    if (!candidate.startsWith('{')) continue
    try {
      const obj = JSON.parse(candidate)
      if (typeof obj.status === 'string') return { status: obj.status.toLowerCase(), summary: String(obj.summary ?? '') }
    } catch {
      // keep looking
    }
  }
  return null
}

/** Wilson 95% interval for k successes in n trials, as [low, high] fractions. */
export function wilson(k, n) {
  if (n === 0) return [0, 0]
  const z = 1.96
  const p = k / n
  const denom = 1 + z * z / n
  const center = (p + z * z / (2 * n)) / denom
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
  return [Math.max(0, center - half), Math.min(1, center + half)]
}

export const median = (xs) => {
  const s = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (s.length === 0) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
