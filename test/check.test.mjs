import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { createCheckTool, parseCheckResult } from '../src/tools/check.js'
import { canRunFakeLipi, createFakeLipi, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu', maxItems: 50 }

/**
 * Create a deployed project directory with `lipi.json`.
 * @returns {string} Absolute project root.
 */
function deployProject() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-check-tool-')))
  writeFileSync(join(root, 'lipi.json'), '{"docs": "docs", "workflow": "workflow"}')
  return root
}

/**
 * Build a plugin context whose working directory is `root`.
 * @param {string} root Project root.
 * @returns {object} Minimal Cordis-like context.
 */
function contextWith(root) {
  return {
    get(name) {
      return name === 'workingDirectory' ? { get: () => root } : undefined
    },
  }
}

/** Execution context for tool calls. */
const EXEC = { agent: { session: {} } }

/**
 * Build one reported checker item.
 * @param {string} code Checker code.
 * @returns {{code: string, file: string, subject: string, line: number, message: string}} Reported item.
 */
function item(code) {
  return { code, file: 'docs/a.md', subject: 'ссылка', line: 3, message: 'сообщение' }
}

const CHECK_OUTPUT = {
  schema: 1,
  version: '1.0.0',
  errors: [item('E1'), item('E2'), item('E3')],
  warnings: [item('W1'), item('W2')],
  summary: { pages: 1, docs: 2, tags: 0, errors: 3, warnings: 2 },
}

test('parseCheckResult разбирает JSON и обрезает списки до maxItems', () => {
  const result = parseCheckResult(JSON.stringify(CHECK_OUTPUT), {
    root: '/srv/app',
    exitCode: 1,
    maxItems: 2,
  })
  assert.equal(result.root, '/srv/app')
  assert.equal(result.schema, 1)
  assert.equal(result.version, '1.0.0')
  assert.equal(result.exitCode, 1)
  assert.equal(result.errors.length, 2)
  assert.equal(result.warnings.length, 2)
  assert.deepEqual(result.errors[0], { code: 'E1', file: 'docs/a.md', subject: 'ссылка', line: 3, message: 'сообщение' })
  assert.deepEqual(result.summary, CHECK_OUTPUT.summary)
  assert.equal(result.truncated, true)
  assert.equal(result.truncatedCount, 1)
})

test('parseCheckResult не отмечает обрезку, когда всё помещается', () => {
  const result = parseCheckResult(JSON.stringify(CHECK_OUTPUT), {
    root: '/srv/app',
    exitCode: 1,
    maxItems: 50,
  })
  assert.equal(result.errors.length, 3)
  assert.equal(result.warnings.length, 2)
  assert.equal(result.truncated, false)
  assert.equal(result.truncatedCount, 0)
  assert.equal(result.parseError, undefined)
})

test('parseCheckResult без schema в объекте возвращает null', () => {
  const result = parseCheckResult(JSON.stringify({ version: '1.0.0', errors: [], warnings: [] }), {
    root: '/srv/app',
    exitCode: 0,
  })
  assert.equal(result.schema, null)
})

test('parseCheckResult возвращает parseError на не-JSON выводе', () => {
  const result = parseCheckResult('Traceback (most recent call last):\n', {
    root: '/srv/app',
    exitCode: 2,
    maxItems: 50,
    stderr: 'boom',
  })
  assert.equal(result.parseError, true)
  assert.equal(result.exitCode, 2)
  assert.match(result.stdout, /Traceback/)
  assert.equal(result.stderr, 'boom')
})

test('parseCheckResult обрезает не-JSON stdout до 8 КиБ', () => {
  const result = parseCheckResult('x'.repeat(9000), { root: '/srv/app', exitCode: 1 })
  assert.equal(result.parseError, true)
  assert.equal(Buffer.byteLength(result.stdout, 'utf8'), 8192)
})

test('lipi_check запускает установленную команду check --format json', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: JSON.stringify(CHECK_OUTPUT) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createCheckTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({}, EXEC))
  assert.equal(result.root, root)
  assert.equal(result.errors.length, 3)
  assert.deepEqual(fake.arguments(), ['check', '--format', 'json'])
})

test('lipi_check передаёт режим audit команде lipi', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: '{}' })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createCheckTool(contextWith(root), CFG)
  await withFakePath(fake.dir, () => tool.execute({ mode: 'audit' }, EXEC))
  assert.deepEqual(fake.arguments(), ['check', '--format', 'json', '--audit'])
})

test('lipi_check сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const tool = createCheckTool(contextWith(root), cfg)
  const result = await tool.execute({}, EXEC)
  assert.match(result.error, /команда lipi не найдена/)
  assert.match(result.error, /pipx install git\+https:\/\/github\.com\/lipisutra\/lipi/)
})
