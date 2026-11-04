// Precision: write files whose exact bytes matter (LF, CRLF, binary, a hash of the binary).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256, writeTree } from '../lib.mjs'

const hello = Buffer.from('Hello, LockStep\n')
const windows = Buffer.from('one\r\ntwo\r\n')
const blob = Buffer.from([0x00, 0xff, 0x10, 0x0a, 0x7f, 0x80])
const blobHash = Buffer.from(`${sha256(blob)}\n`)
const expected = { 'hello.txt': hello, 'windows.txt': windows, 'blob.bin': blob, 'blob.sha256': blobHash }

export default {
  id: 't01-exact-bytes',
  title: 'Write files with exact bytes',
  category: 'precision',
  timeoutSec: 600,
  prompt: 'Create four files in the current directory. Exact bytes matter: a checker compares them byte for byte.',
  requirements: [
    'hello.txt contains exactly the text "Hello, LockStep" followed by a single LF newline and nothing else.',
    'windows.txt contains two lines, "one" and "two", each ending with CRLF (carriage return then line feed).',
    'blob.bin contains exactly these 6 bytes, in hex: 00 ff 10 0a 7f 80.',
    'blob.sha256 contains the lowercase hex SHA-256 digest of blob.bin followed by a single LF newline.',
  ],
  protected: [],
  setup() {},
  async check(dir) {
    const notes = []
    const results = Object.entries(expected).map(([name, want]) => {
      let got
      try { got = readFileSync(join(dir, name)) } catch { notes.push(`${name}: missing`); return false }
      const ok = got.equals(want)
      if (!ok) notes.push(`${name}: expected ${want.toString('hex')}, got ${got.toString('hex').slice(0, 80)}`)
      return ok
    })
    return { ok: results.every(Boolean), score: results.filter(Boolean).length / results.length, notes }
  },
  reference(dir) { writeTree(dir, expected) },
}
