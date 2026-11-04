// Coding from a spec: implement slugify; the grader uses hidden cases that differ from the examples.
import { join } from 'node:path'
import { runNodeJson, writeTree } from '../lib.mjs'

const CASES = [
  ['Hello World', undefined, 'hello-world'],
  ['  Hello   World  ', undefined, 'hello-world'],
  ['Crème Brûlée!', undefined, 'creme-brulee'],
  ['Straße', undefined, 'strasse'],
  ['a--b__c', undefined, 'a-b-c'],
  ['!!!', undefined, ''],
  ['', undefined, ''],
  [null, undefined, ''],
  [123, undefined, ''],
  ['日本語 text', undefined, 'text'],
  ['Version 2.0.1', undefined, 'version-2-0-1'],
  ['hello world', 5, 'hello'],
  ['hello world', 6, 'hello'],
  ['abc-def', 3, 'abc'],
  ['ÀÉÎÕÜ', undefined, 'aeiou'],
  ['x'.repeat(80), undefined, 'x'.repeat(50)],
]

const reference = `function slugify(input, maxLength = 50) {
  if (typeof input !== 'string') return ''
  let s = input.replace(/ß/g, 'ss').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase()
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  s = s.slice(0, maxLength).replace(/-+$/g, '')
  return s
}
module.exports = { slugify }
`

const GRADER = `
const { slugify } = require(process.argv[1])
const cases = JSON.parse(process.argv[2])
const out = cases.map(([input, max, want]) => { try { const got = max === null ? slugify(input) : slugify(input, max); return got === want ? true : got } catch (e) { return 'threw: ' + e.message } })
console.log(JSON.stringify(out))
`

export default {
  id: 't02-slugify',
  title: 'Implement slugify from a spec',
  category: 'coding',
  timeoutSec: 600,
  prompt: 'Implement the function described below in slugify.js (CommonJS: module.exports = { slugify }). Hidden test cases will be run against it, so follow every rule, including edge cases. Examples: slugify("Hello World") is "hello-world"; slugify("  Dr. Strange  ") is "dr-strange"; slugify("hello world", 5) is "hello".',
  requirements: [
    'slugify(input, maxLength = 50) returns a lowercase URL slug.',
    'Accented Latin letters are folded to their base letter (e.g. é becomes e, ü becomes u); ß becomes "ss".',
    'After that, every run of characters that are not ASCII letters or digits becomes a single hyphen. This includes spaces, punctuation, underscores and non-Latin scripts.',
    'The result has no leading or trailing hyphens.',
    'The result is cut to at most maxLength characters, and a hyphen left at the end by the cut is removed.',
    'If input is not a string, or nothing is left, return an empty string. It never throws.',
  ],
  protected: [],
  setup() {},
  async check(dir) {
    const cases = CASES.map(([i, m, w]) => [i, m === undefined ? null : m, w])
    const got = await runNodeJson(GRADER, [join(dir, 'slugify.js'), JSON.stringify(cases)], { cwd: dir })
    if (!Array.isArray(got)) return { ok: false, score: 0, notes: [`could not run slugify.js: ${got.error}`] }
    const notes = got.flatMap((r, i) => (r === true ? [] : [`${JSON.stringify(CASES[i][0])}${CASES[i][1] !== undefined ? ` max ${CASES[i][1]}` : ''}: expected ${JSON.stringify(CASES[i][2])}, got ${JSON.stringify(r)}`]))
    const passed = got.filter(r => r === true).length
    return { ok: passed === got.length, score: passed / got.length, notes }
  },
  reference(dir) { writeTree(dir, { 'slugify.js': reference }) },
}
