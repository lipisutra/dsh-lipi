import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { createNewTool, newArguments, parseNewResult } from '../src/tools/new.js'
import { canRunFakeLipi, createFakeLipi, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu', maxItems: 50 }

const NEW_JSON = JSON.stringify({ path: 'workflow/plan/pln-001-nazvanie.md', id: 'PLN-001', index_updated: true })

/**
 * Create a deployed project directory with `lipi.json`.
 * @returns {string} Absolute project root.
 */
function deployProject() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-new-tool-')))
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

test('newArguments ставит --format json после аргументов new', () => {
  assert.deepEqual(newArguments({ type: 'pln', title: 'Название' }), ['new', 'pln', 'Название', '--format', 'json'])
  assert.deepEqual(newArguments({ type: 'iss', title: 'Что мешает', kind: 'трение' }), ['new', 'iss', 'Что мешает', 'трение', '--format', 'json'])
  assert.deepEqual(newArguments({ type: 'iss', title: 'Что мешает' }), ['new', 'iss', 'Что мешает', '--format', 'json'])
  assert.deepEqual(newArguments({ type: 'aud', title: 'Аудит', kind: 'баг' }), ['new', 'aud', 'Аудит', '--format', 'json'], 'вид замечания только для iss')
})

test('parseNewResult разбирает JSON и текстовую строку', () => {
  assert.deepEqual(parseNewResult(NEW_JSON), { path: 'workflow/plan/pln-001-nazvanie.md', id: 'PLN-001', index_updated: true })
  assert.deepEqual(
    parseNewResult('создан workflow/plan/pln-002-x.md (PLN-002), указатель обновлён\n'),
    { path: 'workflow/plan/pln-002-x.md', id: 'PLN-002', index_updated: true },
  )
  assert.equal(parseNewResult('не то'), null)
})

test('lipi_new запускает установленную команду new --format json', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: NEW_JSON })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createNewTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({ type: 'pln', title: 'Название' }, EXEC))
  assert.deepEqual(result, { path: 'workflow/plan/pln-001-nazvanie.md', id: 'PLN-001', index_updated: true, exitCode: 0 })
  assert.deepEqual(fake.arguments(), ['new', 'pln', 'Название', '--format', 'json'])
})

test('lipi_new передаёт вид замечания для iss', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: NEW_JSON })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createNewTool(contextWith(root), CFG)
  await withFakePath(fake.dir, () => tool.execute({ type: 'iss', title: 'Что мешает', kind: 'трение' }, EXEC))
  assert.deepEqual(fake.arguments(), ['new', 'iss', 'Что мешает', 'трение', '--format', 'json'])
})

test('lipi_new сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const tool = createNewTool(contextWith(root), cfg)
  const result = await tool.execute({ type: 'pln', title: 'Название' }, EXEC)
  assert.match(result.error, /команда lipi не найдена/)
})
