// Data processing with exact numbers, quoted CSV fields, and a hash of the agent's own output file.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256, writeTree } from '../lib.mjs'

const CATEGORIES = ['Books', 'Home, Garden', 'Toys', 'Electronics', 'Food']
const REGIONS = ['north', 'south', 'east', 'west']

function rows() {
  const out = []
  let seed = 12345
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let id = 1; id <= 240; id++) {
    const category = CATEGORIES[Math.floor(rnd() * CATEGORIES.length)]
    const region = REGIONS[Math.floor(rnd() * REGIONS.length)]
    const amount = id % 23 === 0 ? '' : String(100 + Math.floor(rnd() * 9900))
    out.push({ id, category, amount, region })
  }
  return out
}

const csvText = () => 'id,category,amount_cents,region\n' + rows().map(r => `${r.id},${r.category.includes(',') ? `"${r.category}"` : r.category},${r.amount},${r.region}`).join('\n') + '\n'

function expectedReport() {
  const used = rows().filter(r => r.amount !== '')
  const by = {}
  const regions = {}
  let total = 0
  for (const r of used) {
    const a = Number(r.amount)
    total += a
    by[r.category] = (by[r.category] ?? 0) + a
    regions[r.region] = (regions[r.region] ?? 0) + a
  }
  const sortedBy = Object.fromEntries(Object.keys(by).sort().map(k => [k, by[k]]))
  const top3 = Object.entries(regions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
  return { row_count: used.length, total_cents: total, by_category: sortedBy, top3_regions: top3 }
}

const dollars = cents => (cents / 100).toFixed(2)

export default {
  id: 't08-csv-report',
  title: 'Aggregate a CSV into exact reports',
  category: 'data',
  timeoutSec: 900,
  prompt: 'data.csv has sales rows (id, category, amount_cents, region). Some category names are quoted because they contain a comma. Rows with an empty amount_cents are skipped entirely (they do not count anywhere). Produce three files from it.',
  requirements: [
    'report.json is a JSON object with: row_count (rows used), total_cents (sum of amount_cents), by_category (object mapping each category name to its total cents, keys sorted alphabetically), and top3_regions (the three regions with the largest total cents, as an array of [region, total_cents] pairs, largest first, ties broken by region name A to Z).',
    'report.md contains a markdown table with one row per category, in the form "| <category> | <total in dollars with exactly 2 decimals> |" (dollars = cents / 100).',
    'report.sha256 contains the lowercase hex SHA-256 of the exact bytes of report.json, followed by a single newline.',
  ],
  protected: ['data.csv'],
  setup(dir) { writeTree(dir, { 'data.csv': csvText() }) },
  async check(dir) {
    const want = expectedReport()
    const notes = []
    let json = false
    let raw
    try {
      raw = readFileSync(join(dir, 'report.json'))
      const got = JSON.parse(raw.toString('utf8'))
      const same = JSON.stringify([got.row_count, got.total_cents, Object.entries(got.by_category ?? {}), got.top3_regions])
        === JSON.stringify([want.row_count, want.total_cents, Object.entries(want.by_category), want.top3_regions])
      json = same
      if (!same) notes.push(`report.json differs from expected (expected ${JSON.stringify(want)})`)
    } catch (error) { notes.push(`report.json: ${String(error.message).slice(0, 100)}`) }
    let md = false
    try {
      const text = readFileSync(join(dir, 'report.md'), 'utf8')
      md = Object.entries(want.by_category).every(([c, v]) => new RegExp(`\\|\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*${dollars(v).replace('.', '\\.')}\\s*\\|`).test(text))
      if (!md) notes.push('report.md is missing or has wrong category rows')
    } catch { notes.push('report.md missing') }
    let hash = false
    try {
      const text = readFileSync(join(dir, 'report.sha256'), 'utf8').replaceAll('\r\n', '\n')
      hash = raw !== undefined && text === `${sha256(raw)}\n`
      if (!hash) notes.push('report.sha256 does not match the bytes of report.json')
    } catch { notes.push('report.sha256 missing') }
    const parts = [json, md, hash]
    return { ok: parts.every(Boolean), score: parts.filter(Boolean).length / parts.length, notes }
  },
  reference(dir) {
    const want = expectedReport()
    const json = JSON.stringify(want, null, 2) + '\n'
    const md = '| category | total |\n|---|---|\n' + Object.entries(want.by_category).map(([c, v]) => `| ${c} | ${dollars(v)} |`).join('\n') + '\n'
    writeTree(dir, { 'report.json': json, 'report.md': md, 'report.sha256': `${sha256(Buffer.from(json))}\n` })
  },
}
