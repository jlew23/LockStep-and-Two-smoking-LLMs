// Bug fix: a shopping-cart total with several bugs; visible tests fail, hidden cases go further.
import { join } from 'node:path'
import { runNodeJson, runNodeTests, writeTree } from '../lib.mjs'

const SPEC = `# Cart rules
1. total = sum of price * qty over the items whose qty is greater than 0. Items with qty 0 or less are ignored.
2. The coupon "SAVE10" takes 10% off that sum.
3. After the coupon, if the amount is 100 or more, subtract 5 (loyalty credit).
4. The result is rounded to 2 decimal places and returned as a number.
`

const buggy = `function total(items, coupon) {
  let sum = 0
  for (const it of items) sum += it.price * it.qty
  if (sum > 100) sum = sum - 5
  if (coupon === 'SAVE10') sum = sum * 0.9
  return sum
}
module.exports = { total }
`

const fixed = `function total(items, coupon) {
  let sum = 0
  for (const it of items) if (it.qty > 0) sum += it.price * it.qty
  if (coupon === 'SAVE10') sum = sum * 0.9
  if (sum >= 100) sum -= 5
  return Math.round(sum * 100 + 1e-9) / 100
}
module.exports = { total }
`

const visible = `const test = require('node:test')
const assert = require('node:assert/strict')
const { total } = require('./cart.js')
test('sums price * qty', () => assert.equal(total([{ price: 10, qty: 2 }, { price: 5, qty: 1 }]), 25))
test('ignores qty 0 or less', () => assert.equal(total([{ price: 10, qty: 2 }, { price: 99, qty: -1 }]), 20))
test('SAVE10 takes 10% off', () => assert.equal(total([{ price: 40, qty: 1 }], 'SAVE10'), 36))
`

const HIDDEN = [
  [[{ price: 0.1, qty: 3 }], undefined, 0.3],
  [[{ price: 100, qty: 1 }], undefined, 95],
  [[{ price: 50, qty: 2 }], undefined, 95],
  [[{ price: 19.99, qty: 5 }], undefined, 99.95],
  [[{ price: 110, qty: 1 }], 'SAVE10', 99],
  [[{ price: 120, qty: 1 }], 'SAVE10', 103],
  [[{ price: 0.1, qty: 3 }], 'SAVE10', 0.27],
  [[{ price: 10, qty: 0 }], undefined, 0],
  [[], undefined, 0],
  [[{ price: 33.33, qty: 3 }], undefined, 99.99],
]

const GRADER = `
const { total } = require(process.argv[1])
const cases = JSON.parse(process.argv[2])
console.log(JSON.stringify(cases.map(([items, coupon, want]) => { try { const got = coupon === null ? total(items) : total(items, coupon); return got === want ? true : got } catch (e) { return 'threw: ' + e.message } })))
`

export default {
  id: 't03-fix-cart',
  title: 'Fix a buggy cart total',
  category: 'coding',
  timeoutSec: 600,
  prompt: 'The shopping cart in cart.js gives wrong totals. SPEC.md describes the correct rules; cart.test.js has some visible tests. Fix cart.js so it follows SPEC.md exactly. Do not edit cart.test.js or SPEC.md. Hidden tests will also be run.',
  requirements: [
    'cart.js follows every rule in SPEC.md (items with qty of 0 or less ignored, SAVE10 coupon, loyalty credit of 5 at 100 or more applied after the coupon, result rounded to 2 decimals).',
    'All tests in cart.test.js pass (run: node --test).',
    'cart.test.js and SPEC.md are not modified.',
  ],
  protected: ['cart.test.js', 'SPEC.md'],
  setup(dir) { writeTree(dir, { 'SPEC.md': SPEC, 'cart.js': buggy, 'cart.test.js': visible }) },
  async check(dir) {
    const notes = []
    const vis = await runNodeTests(dir, ['cart.test.js'])
    if (!vis.ok) notes.push(`visible tests: ${vis.failed} failing`)
    const cases = HIDDEN.map(([i, c, w]) => [i, c === undefined ? null : c, w])
    const got = await runNodeJson(GRADER, [join(dir, 'cart.js'), JSON.stringify(cases)], { cwd: dir })
    let hidden = 0
    if (Array.isArray(got)) {
      hidden = got.filter(r => r === true).length
      got.forEach((r, i) => { if (r !== true) notes.push(`hidden #${i + 1} ${JSON.stringify(HIDDEN[i][0])} ${HIDDEN[i][1] ?? ''}: expected ${HIDDEN[i][2]}, got ${JSON.stringify(r)}`) })
    } else notes.push(`could not run cart.js: ${got.error}`)
    const score = ((vis.ok ? 1 : 0) + hidden / HIDDEN.length) / 2
    return { ok: vis.ok && hidden === HIDDEN.length, score, notes }
  },
  reference(dir) { writeTree(dir, { 'cart.js': fixed }) },
}
