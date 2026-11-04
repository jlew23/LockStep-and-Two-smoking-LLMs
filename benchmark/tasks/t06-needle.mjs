// Search at scale: one real value among look-alikes in 150 files.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeTree } from '../lib.mjs'

const VALUE = '2026-07-19T04:12:55Z-r8841'
const REAL_FILE = 97

function build() {
  const f = {}
  for (let n = 1; n <= 150; n++) {
    const id = String(n).padStart(3, '0')
    const lines = [`# build log ${id}`, `host=ci-${n % 7}`, `duration_ms=${1000 + ((n * 7919) % 9000)}`]
    if (n % 5 === 0) lines.push(`BUILD_STAMP_OLD=2025-0${1 + (n % 9)}-1${n % 10}T00:00:00Z-r${1000 + n}`)
    if (n % 7 === 0) lines.push(`build_stamp=2026-01-0${1 + (n % 9)}T09:00:00Z-r${2000 + n}`)
    if (n % 11 === 0) lines.push(`# BUILD_STAMP=2026-03-0${1 + (n % 9)}T12:00:00Z-r${3000 + n} (disabled)`)
    if (n === REAL_FILE) lines.splice(2, 0, `BUILD_STAMP=${VALUE}`)
    lines.push('status=ok')
    f[`logs/build-${id}.txt`] = lines.join('\n') + '\n'
  }
  return f
}

export default {
  id: 't06-needle',
  title: 'Find one value among look-alikes',
  category: 'search',
  timeoutSec: 600,
  prompt: 'The folder logs/ has 150 build logs. Exactly one of them contains an active line that starts with BUILD_STAMP= (upper case, followed directly by an equals sign, not commented out). Other files have look-alikes such as BUILD_STAMP_OLD=, build_stamp= and commented lines.',
  requirements: [
    'answer.txt contains the value after BUILD_STAMP= from that one active line, followed by a single newline, and nothing else.',
    'No file in logs/ is changed.',
  ],
  protected: ['logs'],
  setup(dir) { writeTree(dir, build()) },
  async check(dir) {
    let got
    try { got = readFileSync(join(dir, 'answer.txt'), 'utf8') } catch { return { ok: false, score: 0, notes: ['answer.txt missing'] } }
    const ok = got.replaceAll('\r\n', '\n') === `${VALUE}\n`
    return { ok, score: ok ? 1 : 0, notes: ok ? [] : [`expected ${JSON.stringify(`${VALUE}\n`)}, got ${JSON.stringify(got.slice(0, 80))}`] }
  },
  reference(dir) { writeTree(dir, { 'answer.txt': `${VALUE}\n` }) },
}
