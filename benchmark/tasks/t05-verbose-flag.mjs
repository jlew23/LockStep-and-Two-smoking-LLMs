// Constraint following: a small feature while leaving vendor code, lockfile and README untouched.
import { join } from 'node:path'
import { runCommand, writeTree } from '../lib.mjs'

const cli = `const { greet } = require('./vendor/greeter.js')
const args = process.argv.slice(2)
const i = args.indexOf('--name')
const name = i >= 0 ? args[i + 1] : 'world'
console.log(greet(name))
`
const solved = `const { greet } = require('./vendor/greeter.js')
const args = process.argv.slice(2)
const i = args.indexOf('--name')
const name = i >= 0 ? args[i + 1] : 'world'
if (args.includes('--verbose')) console.log('verbose on')
console.log(greet(name))
`
const files = {
  'cli.js': cli,
  'vendor/greeter.js': "// vendored, do not edit\nexports.greet = n => 'hello ' + n\n",
  'package.json': '{ "name": "greeter-cli", "version": "1.0.0", "dependencies": {} }\n',
  'package-lock.json': '{ "name": "greeter-cli", "lockfileVersion": 3, "packages": {} }\n',
  'README.md': '# greeter-cli\n\nUsage: node cli.js --name Bob\n',
}

export default {
  id: 't05-verbose-flag',
  title: 'Add a flag without touching protected files',
  category: 'constraints',
  timeoutSec: 600,
  prompt: 'Add a --verbose flag to cli.js. When it is present, the program first prints the line "verbose on", then behaves as usual. Without the flag, output must be exactly what it is today.',
  requirements: [
    '`node cli.js --verbose --name Bob` prints "verbose on" and then "hello Bob" (two lines).',
    '`node cli.js --name Bob --verbose` prints the same two lines (flag position does not matter).',
    '`node cli.js --name Bob` still prints only "hello Bob".',
    'Nothing under vendor/ is changed, package.json and package-lock.json are not changed, and README.md is not changed.',
  ],
  protected: ['vendor', 'package.json', 'package-lock.json', 'README.md'],
  setup(dir) { writeTree(dir, files) },
  async check(dir) {
    const run = async (...args) => (await runCommand(process.execPath, [join(dir, 'cli.js'), ...args], { cwd: dir, timeoutMs: 15_000 })).stdout.replaceAll('\r\n', '\n')
    const notes = []
    const a = await run('--verbose', '--name', 'Bob')
    const b = await run('--name', 'Bob', '--verbose')
    const c = await run('--name', 'Bob')
    const parts = [a === 'verbose on\nhello Bob\n', b === 'verbose on\nhello Bob\n', c === 'hello Bob\n']
    if (!parts[0]) notes.push(`--verbose --name Bob printed ${JSON.stringify(a)}`)
    if (!parts[1]) notes.push(`--name Bob --verbose printed ${JSON.stringify(b)}`)
    if (!parts[2]) notes.push(`--name Bob printed ${JSON.stringify(c)}`)
    return { ok: parts.every(Boolean), score: parts.filter(Boolean).length / parts.length, notes }
  },
  reference(dir) { writeTree(dir, { 'cli.js': solved }) },
}
