// Edit precision: change one value in a Windows-style file (BOM, CRLF, tabs, look-alike lines) and nothing else.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeTree } from '../lib.mjs'

function original() {
  const lines = [
    '; service configuration',
    '[server]',
    'host\t=\t127.0.0.1',
    'port\t=\t8080',
    'timeout=30',
    'connect_timeout=30',
    '# timeout=30 (old default)',
    'retries = 3   ',
    '',
    '[client]',
    'name=Zoë',
    'read_timeout=30',
    'timeout_unit=seconds',
  ]
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')])
}

function edited() {
  const text = original().toString('utf8')
  return Buffer.from(text.replace('\r\ntimeout=30\r\n', '\r\ntimeout=45\r\n'), 'utf8')
}

export default {
  id: 't09-config-edit',
  title: 'Change one value, keep every other byte',
  category: 'precision',
  timeoutSec: 600,
  prompt: 'config.ini is a Windows-style file. Change the server timeout from 30 to 45. Only that value may change.',
  requirements: [
    'In config.ini, the line "timeout=30" (the one directly under port) now reads "timeout=45".',
    'Every other byte of config.ini is unchanged: the UTF-8 byte order mark, CRLF line endings, tabs, trailing spaces, and the look-alike lines (connect_timeout, read_timeout, timeout_unit, and the commented line).',
  ],
  protected: [],
  setup(dir) { writeTree(dir, { 'config.ini': original() }) },
  async check(dir) {
    let got
    try { got = readFileSync(join(dir, 'config.ini')) } catch { return { ok: false, score: 0, notes: ['config.ini missing'] } }
    const want = edited()
    if (got.equals(want)) return { ok: true, score: 1, notes: [] }
    const text = got.toString('utf8')
    const changedValue = text.includes('\r\ntimeout=45\r\n')
    const n = Math.min(got.length, want.length)
    let i = 0
    while (i < n && got[i] === want[i]) i++
    return { ok: false, score: changedValue ? 0.5 : 0, notes: [`first byte difference at ${i} (file is ${got.length} bytes, expected ${want.length}); value changed: ${changedValue}`] }
  },
  reference(dir) { writeTree(dir, { 'config.ini': edited() }) },
}
