// Generated from src/core.ts by build.mjs. Do not edit.
/**
 * Pure logic for the Verdent report plugin: normalising and trimming reports,
 * checking verdicts against the report they grade, naming files, rendering
 * short model-facing text, and ranking playbooks. No harness or Node imports,
 * so it can be tested with plain `node --test`.
 *
 * Design rules (from the squad review):
 * - Never make the model regenerate a long report: trim and record, then say
 *   what was not saved. Reject only what cannot be stored at all.
 * - Model-facing output stays small: the Manager sees counts and the lines
 *   that need a decision, not whole documents.
 */

export const WORKER_STATUSES = ['done', 'blocked', 'partial']         
export const VERDICTS = ['PASS', 'FAIL']         

                                                         
                                             

export const LIMITS = {
  summary: 300,
  evidence: 1000,
  notes: 2000,
  listItem: 400,
  listItems: 30,
  lessons: 3,
  criteria: 50,
  /** Machine-checkable claims per criterion. */
  checks: 10,
  /** Longest `text` an equals/contains check may carry. */
  checkText: 2000,
  /** Longest `hex` string an hex check may carry (characters). */
  checkHex: 4096,
}         

/** Largest file the plugin reads into memory to check it; bigger files use size or sha256. */
export const MAX_READ = 1024 * 1024

export const CHECK_KINDS = ['exists', 'equals', 'contains', 'size', 'sha256', 'hex']         
                                                  

/**
 * A claim the plugin can verify against the real file instead of trusting the
 * model's words. Paths are relative to the session workspace.
 * - exists: the path exists
 * - equals: the file is exactly `text` (UTF-8, newline included)
 * - contains: the file contains `text`
 * - size: the file is exactly `bytes` long
 * - sha256: the file hashes to `sha256`
 * - hex: the file is exactly these bytes
 */
                        
                 
              
               
                
                 
              
 

                              
                 
              
             
                
 

/** passed: every check held; failed: one did not; none: no checks, so the claim is unverified. */
                                                   

                                  
                   
              
                  
                                                 
                  
                     
                               
 

/** Results of running checks, aligned with the submitted criteria by position. */
                                
                                        
                                                      
                  
 

                               
                 
                                                                     
                   
                     
                      
                 
                             
                         
                          
                   
                          
                                                                                   
                     
 

                                
                 
                                                                          
                                 
                  
                             
               
                     
 

                                   
                 
                      
                 
                             
                          
                           
                    
                           
 

                              
                 
                  
                             
                
 

/** A refusal the model can fix in one retry. */
export class NotSaved extends Error {
  constructor(problem        , fix        ) {
    super(`Not saved: ${problem}. ${fix}. Call again.`)
    this.name = 'NotSaved'
  }
}

const TASK_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function normalizeTaskId(raw        )         {
  const id = String(raw).trim().toLowerCase()
  if (!TASK_ID_RE.test(id)) {
    throw new NotSaved(`task_id ${describeInput(String(raw))} is not valid`, 'Use the id from the Manager: 1 to 64 letters, digits, "-" or "_"')
  }
  return id
}

/** Describe model input in an error without echoing it in full. */
export function describeInput(text        )         {
  return text.length <= 40 ? JSON.stringify(text) : `${JSON.stringify(text.slice(0, 40))}... (${text.length} chars)`
}

/** Collapse whitespace (including newlines) to single spaces. */
export function oneLine(text        )         {
  return text.replace(/\s+/g, ' ').trim()
}

/** Records what was trimmed so the reply can say so. */
export class Trimmer {
  /** Fields that were cut or dropped. */
           notes           = []
  /** Changes to the meaning of the report (status or verdict changed, criteria merged). */
           changes           = []

  text(value        , limit        , field        , collapse = false)         {
    const clean = collapse ? oneLine(value) : value.trim()
    if (clean.length <= limit) return clean
    this.notes.push(`${field} cut to ${limit} chars`)
    return `${clean.slice(0, limit - 1)}…`
  }

  list(values                      , max        , field        )           {
    const items = (values ?? []).map(v => oneLine(String(v))).filter(v => v.length > 0)
    if (items.length > max) this.notes.push(`${field}: kept first ${max} of ${items.length}`)
    return items.slice(0, max).map((v, i) => this.text(v, LIMITS.listItem, `${field}[${i}]`, true))
  }
}

function cleanCriteria(values                               , t         , verify                )                    {
  let list = values ?? []
  if (list.length > LIMITS.criteria) {
    t.notes.push(`criteria: kept first ${LIMITS.criteria} of ${list.length}`)
    list = list.slice(0, LIMITS.criteria)
  }
  const byKey = new Map                ()
  const out                    = []
  list.forEach((item, i) => {
    const criterion = t.text(String(item?.criterion ?? ''), LIMITS.listItem, `criteria[${i}].criterion`, true)
    if (criterion.length === 0) throw new NotSaved(`criteria[${i}] has no criterion text`, 'Copy the criterion as given')
    let met = item.met === true
    let evidence = t.text(String(item?.evidence ?? ''), LIMITS.evidence, `criteria[${i}].evidence`)
    if (met && evidence.length === 0) {
      throw new NotSaved(`criteria[${i}] is met:true with empty evidence`, 'Add proof or set met:false')
    }
    const checks = cleanChecks((item                        )?.checks, t, i)
    const results = verify?.results[i]
    let verified                      
    if (checks.length > 0 && results) {
      const failed = results.filter(r => !r.ok)
      verified = failed.length > 0 ? 'failed' : 'passed'
      if (failed.length > 0 && met) {
        // The model claimed this was met, but the real file disagrees: never record it as met.
        met = false
        const why = failed.map(r => `${r.kind} ${r.path}: ${r.detail}`).join('; ')
        evidence = clip(`FAILED VERIFICATION: ${why}${evidence ? ` (claimed: ${evidence})` : ''}`, LIMITS.evidence)
        t.changes.push(`"${clip(criterion, 50)}" failed verification (${shortList(failed.map(r => `${r.kind} ${r.path}: ${r.detail}`), 2)}); recorded as not met`)
      }
    } else if (verify) {
      verified = 'none'
      if (met && verify.require) {
        met = false
        evidence = clip(`NO MACHINE-CHECKABLE PROOF: add checks (exists, equals, contains, size, sha256 or hex). (claimed: ${evidence})`, LIMITS.evidence)
        t.changes.push(`"${clip(criterion, 50)}" had no checks; recorded as not met`)
      }
    }
    const extra                           = {}
    if (checks.length > 0) extra.checks = checks
    if (verified) extra.verified = verified
    if (results && checks.length > 0) extra.check_results = results.map(r => ({ ...r, detail: clip(r.detail, 200) }))
    const key = criterionKey(criterion)
    const prev = byKey.get(key)
    if (prev !== undefined) {
      // Same criterion twice. Never let a pass hide a failure: keep the not-met one.
      const first = out[prev] 
      if (first.met !== met) {
        if (first.met) out[prev] = { ...first, met: false, evidence, ...extra }
        t.changes.push(`"${clip(criterion, 60)}" was listed twice with different results; kept as not met`)
      } else {
        t.notes.push(`criteria[${i}] duplicates "${clip(first.criterion, 60)}"`)
      }
      return
    }
    byKey.set(key, out.length)
    out.push({ criterion, met, evidence, ...extra })
  })
  return out
}

// ---- checks: claims verified against the real files --------------------------

const HEX_DIGITS = /^[0-9a-f]*$/

/** Hex text to bytes. Spaces, commas, "0x" and ":" separators are ignored. Undefined if not valid hex. */
export function hexToBytes(text        )                         {
  const clean = text.toLowerCase().replace(/0x/g, '').replace(/[\s,:_-]+/g, '')
  if (!HEX_DIGITS.test(clean) || clean.length % 2 !== 0) return undefined
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(bytes            , sep = '')         {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(sep)
}

/**
 * Validate the `checks` a model submitted for criterion `at`. Malformed checks
 * are refused with a one-line fix, because a silently ignored check would look
 * like a verified claim.
 */
export function cleanChecks(values         , t         , at        )          {
  if (values === undefined || values === null) return []
  if (!Array.isArray(values)) throw new NotSaved(`criteria[${at}].checks is not a list`, 'Use a list of {kind, path, ...} objects, or omit checks')
  let list = values                             
  if (list.length > LIMITS.checks) {
    t.notes.push(`criteria[${at}].checks: kept first ${LIMITS.checks} of ${list.length}`)
    list = list.slice(0, LIMITS.checks)
  }
  return list.map((raw, j) => {
    const where = `criteria[${at}].checks[${j}]`
    const kind = String(raw?.kind ?? '')             
    if (!CHECK_KINDS.includes(kind)) throw new NotSaved(`${where}.kind ${describeInput(String(raw?.kind ?? ''))} is not valid`, `Use one of: ${CHECK_KINDS.join(', ')}`)
    const path = typeof raw.path === 'string' ? raw.path.trim() : ''
    if (path === '') throw new NotSaved(`${where} has no path`, 'Give the file path, relative to the workspace')
    const check        = { kind, path }
    if (kind === 'equals' || kind === 'contains') {
      if (typeof raw.text !== 'string' || (kind === 'contains' && raw.text === '')) {
        throw new NotSaved(`${where} (${kind}) needs a text`, 'Give the exact text to look for')
      }
      if (raw.text.length > LIMITS.checkText) throw new NotSaved(`${where}.text is over ${LIMITS.checkText} chars`, 'Check a shorter excerpt, or use sha256 or size')
      check.text = raw.text
    } else if (kind === 'size') {
      if (typeof raw.bytes !== 'number' || !Number.isInteger(raw.bytes) || raw.bytes < 0) throw new NotSaved(`${where} (size) needs bytes as a whole number`, 'Give the exact size in bytes')
      check.bytes = raw.bytes
    } else if (kind === 'sha256') {
      const sha = typeof raw.sha256 === 'string' ? raw.sha256.trim().toLowerCase() : ''
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new NotSaved(`${where} (sha256) needs a 64-digit hex digest`, 'Give the full sha256 as lowercase hex')
      check.sha256 = sha
    } else if (kind === 'hex') {
      const text = typeof raw.hex === 'string' ? raw.hex : ''
      if (text.length > LIMITS.checkHex) throw new NotSaved(`${where}.hex is over ${LIMITS.checkHex} chars`, 'Check a shorter file, or use sha256 or size')
      const bytes = hexToBytes(text)
      if (!bytes) throw new NotSaved(`${where} (hex) is not valid hex`, 'Give whole bytes as hex digits, e.g. "4c 6f 63 6b 0a"')
      check.hex = bytesToHex(bytes)
    }
    return check
  })
}

/** Checks per submitted criterion, in the same positions cleanCriteria will use. */
export function extractChecks(values                               )            {
  const t = new Trimmer()
  return (values ?? []).slice(0, LIMITS.criteria).map((item, i) => cleanChecks((item                        )?.checks, t, i))
}

/** What is known about a file when a check runs. `bytes` is set only for files up to MAX_READ. */
                            
                 
                 
              
                    
                 
 

/** What a check needs read from disk: nothing, the bytes, or the hash. */
export function needsOf(check       )                              {
  return check.kind === 'equals' || check.kind === 'contains' || check.kind === 'hex' ? 'bytes' : check.kind === 'sha256' ? 'sha256' : 'none'
}

function byteDiff(actual            , claimed            )                     {
  const n = Math.min(actual.length, claimed.length)
  for (let i = 0; i < n; i++) {
    if (actual[i] !== claimed[i]) {
      return `first difference at byte ${i}: the file has ${bytesToHex(actual.slice(i, i + 1))}, you claimed ${bytesToHex(claimed.slice(i, i + 1))}`
    }
  }
  return actual.length === claimed.length ? undefined : `the file is ${actual.length} bytes, you claimed ${claimed.length}`
}

/** Judge one claim against what is on disk. Pure: the caller supplies the facts. */
export function judgeCheck(check       , facts           )              {
  const result = (ok         , detail        )              => ({ kind: check.kind, path: check.path, ok, detail })
  if (!facts.exists) return result(false, 'no such file or folder')
  if (check.kind === 'exists') return result(true, 'exists')
  if (!facts.isFile) return result(false, 'is a folder, not a file')
  if (check.kind === 'size') {
    return facts.size === check.bytes ? result(true, `${facts.size} bytes`) : result(false, `the file is ${facts.size} bytes, you claimed ${check.bytes}`)
  }
  if (check.kind === 'sha256') {
    if (!facts.sha256) return result(false, 'could not hash the file')
    return facts.sha256 === check.sha256 ? result(true, 'sha256 matches') : result(false, `sha256 is ${facts.sha256.slice(0, 16)}…, you claimed ${check.sha256 .slice(0, 16)}…`)
  }
  if (!facts.bytes) return result(false, `the file is ${facts.size} bytes, over the ${MAX_READ} byte limit for this check; use size or sha256`)
  if (check.kind === 'contains') {
    const text = new TextDecoder().decode(facts.bytes)
    return text.includes(check.text ) ? result(true, 'text found') : result(false, `text not found; the file starts with ${JSON.stringify(clip(text, 60))}`)
  }
  const claimed = check.kind === 'hex' ? hexToBytes(check.hex )  : new TextEncoder().encode(check.text )
  const diff = byteDiff(facts.bytes, claimed)
  if (!diff) return result(true, `matches (${facts.bytes.length} bytes)`)
  return result(false, check.kind === 'equals' ? `${diff}; the file starts with ${JSON.stringify(clip(new TextDecoder().decode(facts.bytes), 60))}` : diff)
}

/** Comparison key for criteria: case, spacing and punctuation do not matter. */
export function criterionKey(text        )         {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** `<task_id>-<yyyymmddhhmmss>-<8 hex>` from a date and a random source. */
export function makeReportId(taskId        , now      , rand              )         {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const hex = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0') + Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')
  return `${taskId}-${stamp}-${hex}`
}

export function buildWorkerReport(args                  , now      , rand              , verify                )                                                                 {
  const t = new Trimmer()
  const task_id = normalizeTaskId(args.task_id)
  const summary = t.text(String(args.summary ?? ''), LIMITS.summary, 'summary', true)
  if (summary.length === 0) throw new NotSaved('summary is empty', 'Add one sentence saying what you did')
  const criteria = cleanCriteria(args.criteria, t, verify)
  let status = args.status
  const report               = {
    task_id,
    report_id: makeReportId(task_id, now, rand),
    reported_at: now.toISOString(),
    status,
    summary,
    criteria,
    files_changed: t.list(args.files_changed, LIMITS.listItems, 'files_changed'),
    open_questions: t.list(args.open_questions, LIMITS.listItems, 'open_questions'),
    lessons: t.list(args.lessons, LIMITS.lessons, 'lessons'),
    playbook_steps: t.list(args.playbook_steps, LIMITS.listItems, 'playbook_steps'),
  }
  if (status === 'done') {
    if (criteria.length === 0) throw new NotSaved('status "done" with no criteria', 'List each definition-of-done item with met and evidence')
    const unmet = criteria.filter(c => !c.met).length
    if (unmet > 0) {
      // Record it as partial instead of making the model redo the report.
      status = 'partial'
      report.status = 'partial'
      t.changes.push(`recorded as "partial": ${unmet} criteria not met`)
    }
  }
  if (status === 'blocked' && report.open_questions.length === 0) {
    throw new NotSaved('status "blocked" with no open_questions', 'Add what you need to continue')
  }
  return { report, trimmed: t.notes, changes: t.changes }
}

export function buildVerdict(args             , gradedReportId               , now      , verify                )                                                                   {
  const t = new Trimmer()
  const criteria = cleanCriteria(args.criteria, t, verify)
  if (criteria.length === 0) throw new NotSaved('no criteria graded', 'Grade each definition-of-done item')
  const verdict                = {
    task_id: normalizeTaskId(args.task_id),
    graded_report_id: gradedReportId,
    verdict: args.verdict,
    criteria,
    notes: t.text(String(args.notes ?? ''), LIMITS.notes, 'notes'),
    recorded_at: now.toISOString(),
  }
  if (verdict.verdict === 'PASS') {
    const failed = criteria.filter(c => !c.met).length
    if (failed > 0) {
      verdict.verdict = 'FAIL'
      t.changes.push(`recorded as FAIL: ${failed} criteria do not pass`)
    }
  }
  if (verdict.verdict === 'FAIL' && verdict.notes.length === 0 && criteria.every(c => c.met)) {
    throw new NotSaved('FAIL with every criterion passing and no notes', 'Say in notes what is wrong, or use PASS')
  }
  return { verdict, trimmed: t.notes, changes: t.changes }
}

/** Worker criteria the verdict did not grade (matched by criterionKey). */
export function ungradedCriteria(report              , verdict               )           {
  const graded = new Set(verdict.criteria.map(c => criterionKey(c.criterion)))
  return report.criteria.filter(c => !graded.has(criterionKey(c.criterion))).map(c => c.criterion)
}

/** Lessons inbox entry. Lessons are one line each, so they cannot forge headers. */
export function lessonsEntry(date        , reportId        , source        , lines          )         {
  const items = lines.map(oneLine).filter(l => l.length > 0)
  if (items.length === 0) return ''
  return `\n## ${date} ${reportId} (${oneLine(source)})\n${items.map(l => `- ${l}`).join('\n')}\n`
}

export function playbookMarkdown(report              , verdict               )         {
  const criteria = verdict.criteria.map(c => `- ${c.criterion}`).join('\n')
  const steps = report.playbook_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const lessons = report.lessons.length > 0 ? `\n## Lessons\n${report.lessons.map(l => `- ${l}`).join('\n')}\n` : ''
  return `# ${report.summary}\n\nReport ${report.report_id}, verified PASS ${verdict.recorded_at.slice(0, 10)}.\n\n## Done means\n${criteria}\n\n## Steps that worked\n${steps}\n${lessons}`
}

/** What find_playbooks needs from a playbook file. */
                               
              
               
               
                     
              
 

export function parsePlaybook(name        , text        )               {
  const lines = text.split('\n')
  const title = (lines.find(l => l.startsWith('# ')) ?? `# ${name}`).slice(2).trim()
  let section = ''
  let steps = 0
  const doneMeans           = []
  for (const line of lines) {
    if (line.startsWith('## ')) section = line.slice(3).trim().toLowerCase()
    else if (section === 'steps that worked' && /^\d+\.\s/.test(line)) steps++
    else if (section === 'done means' && line.startsWith('- ')) doneMeans.push(line.slice(2).trim())
  }
  return { name, title, steps, doneMeans, text }
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'not', 'but', 'you', 'all', 'any', 'can', 'its', 'our', 'out', 'has', 'have', 'then', 'than', 'of', 'to', 'in', 'on', 'at', 'by', 'or', 'an', 'is', 'it', 'be', 'as', 'do', 'if', 'so', 'we'])

const HAN_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/**
 * Keyword tokens: Unicode letters and digits; 2+ chars (digits of any length);
 * a small English stop list; trailing "s" folded (shots -> shot); Chinese and
 * Japanese runs split into overlapping pairs, since they have no spaces.
 */
export function words(text        )           {
  const out           = []
  for (const raw of text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []) {
    // Split mixed tokens such as "Unreal渲染" into their Latin and CJK parts.
    for (const part of raw.match(SCRIPT_RUN) ?? []) {
      if (HAN_KANA.test(part)) {
        const chars = [...part]
        if (chars.length === 1) out.push(part)
        for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]  + chars[i + 1] )
        continue
      }
      if (STOP_WORDS.has(part)) continue
      if (part.length < 2 && !/^\d+$/.test(part)) continue
      out.push(part.length > 3 && part.endsWith('s') && !part.endsWith('ss') ? part.slice(0, -1) : part)
    }
  }
  return out
}

const SCRIPT_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu

/** A playbook prepared for ranking, so a search needn't re-read or re-tokenize files. */
                                  
                    
                         
                        
 

export function indexPlaybook(name        , text        )                  {
  const meta = parsePlaybook(name, text)
  return { meta: { ...meta, text: '' }, titleWords: new Set(words(meta.title)), bodyWords: new Set(words(text)) }
}

                              
              
               
 

/**
 * Rank playbooks by keyword overlap. Title words count 3, body words 1.
 * Weak hits are dropped (score < 3, or under half the best score) because a
 * wrong playbook is followed faithfully by a cheap model. Ties go to the
 * newest file (names start with the report id, which embeds a timestamp).
 */
export function rankPlaybooks(query        , files                                                      , limit = 3)                {
  const wanted = new Set(words(query))
  if (wanted.size === 0) return []
  const hits                = []
  for (const file of files) {
    const entry = 'meta' in file ? file : indexPlaybook(file.name, file.text)
    let score = 0
    for (const w of wanted) {
      if (entry.titleWords.has(w)) score += 3
      else if (entry.bodyWords.has(w)) score += 1
    }
    if (score > 0) hits.push({ name: entry.meta.name, score })
  }
  hits.sort((a, b) => b.score - a.score || stampOf(b.name).localeCompare(stampOf(a.name)) || a.name.localeCompare(b.name))
  const top = hits[0]?.score ?? 0
  return hits.filter(h => h.score >= 3 && h.score * 2 >= top).slice(0, limit)
}

function stampOf(name        )         {
  return name.match(/-(\d{14})-[0-9a-f]{4,8}\.md$/)?.[1] ?? ''
}

export function clip(text        , max        )         {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ---- model-facing text ------------------------------------------------------

/** Short list: the first few items, then a count. */
export function shortList(items          , show = 3)         {
  if (items.length <= show) return items.join('; ')
  return `${items.slice(0, show).join('; ')}; and ${items.length - show} more`
}

function notesText(trimmed          , changes          )         {
  const parts           = []
  if (changes.length > 0) parts.push(` ${shortList(changes)}.`)
  if (trimmed.length > 0) parts.push(` Trimmed ${trimmed.length} field${trimmed.length === 1 ? '' : 's'}: ${shortList(trimmed)}.`)
  return parts.join('')
}

const DONE = ' You are done: end with one line, no repeat summary.'

/** " 2 verified, 1 unverified." — how many met claims the plugin checked against real files. Empty when checks were never in play. */
export function verificationSummary(criteria                   , showUnverified = true)         {
  if (!criteria.some(c => c.verified !== undefined)) return ''
  const passed = criteria.filter(c => c.verified === 'passed').length
  const unverified = showUnverified ? criteria.filter(c => c.met && c.verified === 'none').length : 0
  const parts = [passed > 0 ? `${passed} verified` : '', unverified > 0 ? `${unverified} met without checks (unverified)` : ''].filter(Boolean)
  return parts.length > 0 ? ` ${parts.join(', ')}.` : ''
}

export function renderWorkerSaved(report              , trimmed          , warnings          , changes           = [])         {
  const met = report.criteria.filter(c => c.met).length
  return `Saved: ${report.task_id} ${report.status}, ${met}/${report.criteria.length} met.${verificationSummary(report.criteria)}${notesText(trimmed, changes)}`
    + (warnings.length > 0 ? ` ${warnings.join(' ')}` : '') + DONE
}

export function renderVerdictSaved(verdict               , trimmed          , outcome        , changes           = [])         {
  const met = verdict.criteria.filter(c => c.met).length
  return `Saved: ${verdict.task_id} ${verdict.verdict}, ${met}/${verdict.criteria.length} pass.${verificationSummary(verdict.criteria, false)}${notesText(trimmed, changes)} ${outcome}`.trimEnd() + DONE
}

/**
 * Compact task view for the Manager: one State line that says what to decide,
 * only the criteria that need attention, and where the full record is.
 */
export function renderTaskView(
  taskId        ,
  report                          ,
  verdict                           ,
  paths                                     ,
  max = 2000,
)         {
  if (!report && !verdict) return `No report saved for ${taskId}.`
  const current = verdict !== undefined && (report === undefined || verdict.graded_report_id === report.report_id)
  const v = current ? verdict : undefined
  const wMet = report ? report.criteria.filter(c => c.met).length : 0
  const vMet = v ? v.criteria.filter(c => c.met).length : 0
  const ungraded = report && v ? ungradedCriteria(report, v).length : 0
  const wChecked = report ? report.criteria.filter(c => c.verified === 'passed').length : 0
  const head = [
    report ? `worker ${report.status} (${wMet}/${report.criteria.length} met${wChecked > 0 ? `, ${wChecked} machine-verified` : ''})` : 'no worker report',
    v ? `verifier ${v.verdict} (${vMet}/${v.criteria.length})` : 'not verified',
  ]
  const state = !report ? 'verdict without a worker report'
    : !v ? (verdict ? 'not verified (the saved verdict is for an older report)' : report.status === 'blocked' ? 'blocked, needs an answer' : 'not verified yet')
      : v.verdict === 'PASS' ? (ungraded > 0 ? `PASS, but ${ungraded} worker criteria were not graded (no playbook saved)` : 'PASS')
        : 'failed verification'
  // Most decision-relevant first: state, questions, notes, then the criteria.
  const lines           = [`Task ${taskId}: ${head.join(', ')}. State: ${state}.`]
  if (report?.open_questions.length) lines.push(`Open questions: ${clip(report.open_questions.join('; '), 400)}`)
  if (v?.notes) lines.push(`Verifier notes: ${clip(oneLine(v.notes), 300)}`)
  if (report?.files_changed.length) lines.push(`Files: ${clip(report.files_changed.join(', '), 200)}`)
  if (report) {
    const vByKey = new Map((v?.criteria ?? []).map(c => [criterionKey(c.criterion), c]))
    const attention           = []
    for (const c of report.criteria) {
      const g = vByKey.get(criterionKey(c.criterion))
      if (c.met && g?.met === true) continue
      const wPart = c.met ? 'worker met' : `worker not met: ${clip(oneLine(c.evidence || 'no evidence'), 100)}`
      const vPart = !v ? '' : !g ? '; verifier did not grade' : g.met ? '; verifier met' : `; verifier not: ${clip(oneLine(g.evidence || 'no evidence'), 100)}`
      attention.push(`- "${clip(c.criterion, 120)}": ${wPart}${vPart}`)
    }
    if (attention.length > 0) {
      lines.push('Not met or disputed:', ...attention.slice(0, 3))
      if (attention.length > 3) lines.push(`+${attention.length - 3} more not met or disputed (see JSON).`)
    }
  }
  const tail = `JSON: ${clip(paths.worker, 300)}${verdict ? `, ${clip(paths.verdict, 300)}` : ''}`
  const body = lines.join('\n')
  const room = Math.max(0, max - tail.length - 1)
  return `${body.length > room ? `${body.slice(0, Math.max(0, room - 8))}… (cut)` : body}\n${tail}`
}

export function renderPlaybookList(hits               , metas                           )         {
  if (hits.length === 0) return 'No close playbook matches. Plan from scratch.'
  const lines = [`${hits.length} close match${hits.length === 1 ? '' : 'es'}:`]
  hits.forEach((h, i) => {
    const m = metas.get(h.name) 
    const done = m.doneMeans.length > 0 ? ` Done means: ${clip(m.doneMeans.join('; '), 160)}.` : ''
    lines.push(`${i + 1}. ${h.name.replace(/\.md$/, '')} (score ${h.score}) "${clip(m.title, 120)}", ${m.steps} steps.${done}`)
  })
  lines.push('Give the Worker the name; it reads it with read_playbook_v1.')
  return lines.join('\n')
}

export function renderLessons(entries          , max = 1500)         {
  if (entries.length === 0) return 'No matching lessons.'
  let out = ''
  for (const e of entries) {
    if (out.length + e.length + 1 > max) break
    out += `${e}\n`
  }
  return out.trimEnd()
}

                                                           

export function missingReportReminder(kind              , attempt        , max        , taskId                    )         {
  const task = taskId ? ` for ${taskId}` : ''
  const n = `(${attempt}/${max})`
  if (kind === 'worker') {
    return `You have not called submit_worker_report_v1${task}. Call it now with what you already found; do not redo work. Unfinished: "partial". Need help: "blocked" + open_questions. ${n}`
  }
  if (kind === 'verifier') {
    return `You have not called submit_verdict_v1${task}. Call it now with the checks you already ran; anything unchecked counts as not met. ${n}`
  }
  return `You have not reported${task}. Worker: call submit_worker_report_v1. Verifier: call submit_verdict_v1. Use what you already have; do not redo work. ${n}`
}

/**
 * Task id named in a message: `task_id: x` or `task id = x` (a ":" or "=" is
 * required, so prose like "what is the task id format" does not count).
 */
export function taskIdInText(text        )                     {
  const m = text.match(/\btask[ _-]?id\s*[:=]\s*[`"']?([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?![A-Za-z0-9_-])/i)
  return m ? m[1] .toLowerCase() : undefined
}
