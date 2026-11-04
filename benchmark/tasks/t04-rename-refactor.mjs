// Multi-file refactor: rename a function everywhere it matters, leave history alone.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runNodeTests, writeTree } from '../lib.mjs'

const names = ['orders', 'invoices', 'quotes', 'refunds', 'subscriptions']

function files(newName) {
  const f = {}
  for (const n of names) {
    f[`src/${n}.js`] = `const { ${newName} } = require('./core.js')\n/** Total for ${n}. Uses ${newName} so rounding stays consistent. */\nfunction ${n}Total(lines) {\n  if (!Array.isArray(lines)) throw new Error('${newName} failed: lines must be a list')\n  return ${newName}(lines)\n}\nmodule.exports = { ${n}Total }\n`
    f[`test/${n}.test.js`] = `const test = require('node:test')\nconst assert = require('node:assert/strict')\nconst { ${n}Total } = require('../src/${n}.js')\ntest('${n} total', () => assert.equal(${n}Total([{ price: 2.5, qty: 2 }, { price: 1, qty: 1 }]), 6))\ntest('${n} rejects non-lists', () => assert.throws(() => ${n}Total(null), /computeTotal failed/))\n`
  }
  f['src/core.js'] = `function ${newName}(lines) {\n  return Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100\n}\nmodule.exports = { ${newName} }\n`
  f['src/index.js'] = `const core = require('./core.js')\n${names.map(n => `const ${n} = require('./${n}.js')`).join('\n')}\nmodule.exports = { ...core, ${names.map(n => `...${n}`).join(', ')} }\n`
  f['docs/api.md'] = `# API\n\n\`${newName}(lines)\` returns the total of a list of {price, qty} lines.\n\n${names.map(n => `\`${n}Total\` wraps \`${newName}\`.`).join('\n')}\n`
  return f
}

const CHANGELOG = '# Changelog\n\n## 1.2.0\n- Added subscriptions.\n\n## 1.0.0\n- First release. Introduced `calcTotal` for all totals.\n'

function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name)
    return statSync(abs).isDirectory() ? listFiles(abs, base) : [abs]
  })
}

export default {
  id: 't04-rename-refactor',
  title: 'Rename a function across a project',
  category: 'refactor',
  timeoutSec: 600,
  prompt: 'This small project uses a function called calcTotal. Rename it to computeTotal everywhere it is used, without changing behavior. The tests in test/ already expect the new name (including in an error message). CHANGELOG.md is history, so leave it exactly as it is.',
  requirements: [
    'The name calcTotal no longer appears in src/, test/ or docs/ (including comments, strings and error messages).',
    'src/index.js still exports computeTotal and all five *Total functions.',
    'All tests pass (run: node --test).',
    'CHANGELOG.md is not modified.',
  ],
  protected: ['CHANGELOG.md'],
  setup(dir) { writeTree(dir, { ...files('calcTotal'), 'CHANGELOG.md': CHANGELOG, ...{ 'package.json': '{ "name": "totals", "version": "1.2.0" }\n' } }) },
  async check(dir) {
    const notes = []
    const leftovers = ['src', 'test', 'docs'].flatMap(d => { try { return listFiles(join(dir, d)) } catch { return [] } })
      .filter(p => /calcTotal/.test(readFileSync(p, 'utf8'))).map(p => p.slice(dir.length + 1))
    if (leftovers.length) notes.push(`calcTotal still in: ${leftovers.join(', ')}`)
    let exportsOk = false
    try {
      const idx = (await import(`${pathToFileURL(join(dir, 'src', 'index.js')).href}?t=${Date.now()}`)).default
      exportsOk = typeof idx.computeTotal === 'function' && names.every(n => typeof idx[`${n}Total`] === 'function')
    } catch (error) { notes.push(`index.js failed to load: ${String(error.message).slice(0, 120)}`) }
    if (!exportsOk) notes.push('index.js exports are wrong')
    const tests = await runNodeTests(dir, [])
    if (!tests.ok) notes.push(`tests: ${tests.failed} failing`)
    const parts = [leftovers.length === 0, exportsOk, tests.ok]
    return { ok: parts.every(Boolean), score: parts.filter(Boolean).length / parts.length, notes }
  },
  reference(dir) { writeTree(dir, files('computeTotal')) },
}
