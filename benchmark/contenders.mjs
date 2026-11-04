// The three contenders (plus mock ones that cost nothing, used to test the benchmark itself).
//
//   claude        Claude Code (print mode), stripped of user plugins, MCP servers and skills
//   dsh           DeepSeek Harness (headless), clean DSH_HOME, no plugins
//   dsh-lockstep  the same, with verdent-report and model-fallback mounted
//
// Each contender has: id, label, preflight() -> null | reason it can't run, run(job) -> result.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand } from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const fwd = p => p.replaceAll('\\', '/')

// ---- Claude Code ---------------------------------------------------------------

export function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  // The desktop app keeps versioned CLI builds under Claude-Data/<id>/claude-code/<version>/<hash>/claude.exe.
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Claude-Data') : undefined
  if (base && existsSync(base)) {
    const found = []
    for (const id of readdirSync(base)) {
      const cc = join(base, id, 'claude-code')
      if (!existsSync(cc)) continue
      for (const version of readdirSync(cc)) {
        for (const hash of readdirSync(join(cc, version))) {
          const exe = join(cc, version, hash, process.platform === 'win32' ? 'claude.exe' : 'claude')
          if (existsSync(exe)) found.push({ version, exe })
        }
      }
    }
    found.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    if (found.length) return found.at(-1).exe
  }
  return 'claude'
}

const claude = {
  id: 'claude',
  label: 'Claude Code',
  preflight() {
    const bin = findClaude()
    try { execFileSync(bin, ['--version'], { stdio: 'pipe', timeout: 20_000 }) } catch { return `could not run Claude Code (${bin}); set CLAUDE_BIN to the claude executable` }
    return null
  },
  async run({ prompt, workspace, timeoutMs, opts }) {
    const args = [
      '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Bash,Edit,Write,Read,Glob,Grep',
      '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project', '--no-session-persistence',
    ]
    if (opts.claudeModel) args.push('--model', opts.claudeModel)
    if (opts.maxBudgetUsd) args.push('--max-budget-usd', String(opts.maxBudgetUsd))
    const r = await runCommand(findClaude(), args, { cwd: workspace, timeoutMs, input: prompt })
    let json
    try { json = JSON.parse(r.stdout) } catch { json = undefined }
    const u = json?.usage ?? {}
    return {
      ...r,
      text: typeof json?.result === 'string' ? json.result : r.stdout,
      costUsd: typeof json?.total_cost_usd === 'number' ? json.total_cost_usd : undefined,
      turns: json?.num_turns,
      tokens: json ? { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 } : undefined,
      error: json?.is_error ? String(json.result ?? 'error').slice(0, 300) : undefined,
    }
  },
}

// ---- DeepSeek Harness ----------------------------------------------------------

function findDsh() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  const candidates = []
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  try {
    const root = execFileSync('npm', ['root', '-g'], { shell: true, encoding: 'utf8', timeout: 20_000 }).trim()
    candidates.push(join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  } catch { /* npm not on PATH */ }
  return candidates.find(existsSync)
}

/** Folder holding the plugin version from before the fact-checking change (see benchmark/README.md). */
export const prevRoot = process.env.LOCKSTEP_PREV_ROOT ? resolve(process.env.LOCKSTEP_PREV_ROOT) : resolve(repoRoot, '..', 'LockStep-prev')

function dshPreflight(needsPlugins, root = repoRoot) {
  if (!process.env.DEEPSEEK_API_KEY) return 'set DEEPSEEK_API_KEY (headless mode cannot use the web sign-in)'
  if (!findDsh()) return 'DeepSeek Harness not found; run: npm install -g @deepseek-ai/dsh (or set DSH_BIN to its lib/bin.js)'
  if (needsPlugins && !existsSync(join(root, 'verdent-report', 'lib', 'index.js'))) {
    return `no plugin build found in ${root} (see benchmark/README.md, "Before and after")`
  }
  if (needsPlugins && !existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-llm'))) {
    return `the plugins in ${root} cannot find the harness libraries; link them: New-Item -ItemType Junction -Path "${join(root, 'node_modules', '@deepseek-ai')}" -Target "<npm root -g>\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai"`
  }
  return null
}

/**
 * Arguments for `dsh`. The launcher's own flags (--profile, --patch) must come BEFORE the
 * app's flags (--permission-mode, ...): after the first app flag the launcher stops parsing
 * and rejects --patch as unknown.
 */
export function dshArgs({ bin, patchFile, extra = [] }) {
  return [bin, '--profile', 'headless', ...(patchFile ? ['--patch', patchFile] : []),
    '--permission-mode', 'workspace-write', '--approval-policy', 'never', ...extra, '-']
}

function lockstepPatch(runDir, opts, root = repoRoot) {
  const memory = opts.lockstepMemory === 'shared' ? join(opts.outDir, `lockstep-memory-${root === repoRoot ? 'current' : 'prev'}`) : join(runDir, 'memory')
  mkdirSync(memory, { recursive: true })
  const yml = `- insert:
    - id: verdent-report
      name: '${fwd(join(root, 'verdent-report', 'lib', 'index.js'))}'
      config:
        memoryDir: '${fwd(memory)}'
        role: all
    - id: model-fallback
      name: '${fwd(join(root, 'model-fallback', 'lib', 'index.js'))}'
      config:
        chains:
          deepseek-v4-pro: [deepseek-flash]
          deepseek-flash: [deepseek-v4-pro]
`
  const file = join(runDir, 'lockstep.patch.yml')
  writeFileSync(file, yml)
  return { file, memory }
}

/**
 * lockstep: mount the plugins. root: where they come from (the current repo, or the previous version).
 * checksDirective: whether the prompt tells the agent to use `checks` (only the current version has them).
 */
function dshContender(id, label, { lockstep = false, root = repoRoot, checksDirective = true } = {}) {
  return {
    id, label, lockstep, checksDirective,
    preflight: () => dshPreflight(lockstep, root),
    async run({ prompt, workspace, runDir, timeoutMs, opts }) {
      const home = join(runDir, 'dsh-home')
      mkdirSync(home, { recursive: true })
      let memory
      let patchFile
      if (lockstep) {
        const patch = lockstepPatch(runDir, opts, root)
        memory = patch.memory
        patchFile = patch.file
      }
      const args = dshArgs({ bin: findDsh(), patchFile, extra: opts.dshExtraArgs ? opts.dshExtraArgs.split(' ').filter(Boolean) : [] })
      const r = await runCommand(process.execPath, args, { cwd: workspace, env: { DSH_HOME: home }, timeoutMs, input: prompt })
      // A failure to start (bad flag, missing credential, plugin load error) is not a failed attempt at the task.
      const startupError = r.code !== 0 && !r.timedOut ? r.stderr.split('\n').map(l => l.trim()).find(l => /^(error:|dsh:)/.test(l)) : undefined
      return { ...r, text: r.stdout, error: startupError?.slice(0, 300), memoryDir: memory }
    },
  }
}

// ---- Mock contenders: no model, no cost. They exist to test the benchmark itself. ----

const mockGood = {
  id: 'mock-good', label: 'Mock: applies the reference solution and reports honestly',
  preflight: () => null,
  async run({ task, workspace }) {
    task.reference(workspace)
    const status = task.referenceClaim ?? 'done'
    return { code: 0, stdout: '', stderr: '', ms: 5, timedOut: false, text: `All set.\n{"status":"${status}","summary":"reference"}` }
  },
}
const mockLiar = {
  id: 'mock-liar', label: 'Mock: does nothing but claims done',
  preflight: () => null,
  async run() { return { code: 0, stdout: '', stderr: '', ms: 5, timedOut: false, text: '{"status":"done","summary":"trust me"}' } },
}
const mockHonest = {
  id: 'mock-honest', label: 'Mock: does nothing and says it is blocked',
  preflight: () => null,
  async run() { return { code: 0, stdout: '', stderr: '', ms: 5, timedOut: false, text: '{"status":"blocked","summary":"did not try"}' } },
}

const mockBroken = {
  id: 'mock-broken', label: 'Mock: fails to start',
  preflight: () => null,
  async run() { return { code: 1, stdout: '', stderr: 'error: unknown option', ms: 3, timedOut: false, text: '', error: 'error: unknown option' } },
}

export const contenders = {
  claude,
  dsh: dshContender('dsh', 'DeepSeek Harness'),
  'dsh-lockstep': dshContender('dsh-lockstep', 'DeepSeek Harness + LockStep', { lockstep: true }),
  // LockStep as it was before the fact-checking (`checks`) change; its prompt does not mention checks.
  'dsh-lockstep-prev': dshContender('dsh-lockstep-prev', 'DeepSeek Harness + LockStep (before fact-checking)', { lockstep: true, root: prevRoot, checksDirective: false }),
  'mock-good': mockGood,
  'mock-liar': mockLiar,
  'mock-honest': mockHonest,
  'mock-broken': mockBroken,
}
