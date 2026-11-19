import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { createMapTool, mapArguments, parseMapResult } from '../src/tools/map.js'
import { canRunFakeLipi, createFakeLipi, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu' }

/**
 * Create a deployed project directory with `lipi.json`.
 * @returns {string} Absolute project root.
 */
function deployProject() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-map-tool-')))
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
 * A real `lipi map --format json` answer: layers, rows with per-layer code
 * counts, a status on a decision row, and the note.
 */
const MAP_JSON = {
  schema: 1,
  layers: ['checks', 'commands'],
  note: '0 means no links were found. An implementation may still exist.',
  rows: [
    {
      target: 'ADR-001',
      title: 'Изменение форматов и переход между версиями lipi',
      kind: 'decision',
      code: { checks: 0, commands: 0 },
      tests: 0,
      status: 'accepted',
    },
    {
      target: 'docs/ru/workflow.md#upgrade',
      title: 'Разложить документы по годам',
      kind: 'section',
      code: { checks: 0, commands: 1 },
      tests: 1,
    },
    {
      target: 'src/lipi/i18n.py',
      title: 'i18n',
      kind: 'code',
      code: { checks: 2, commands: 0 },
      tests: 3,
    },
  ],
}

test('mapArguments запускает map с машинным форматом', () => {
  assert.deepEqual(mapArguments(), ['map', '--format', 'json'])
})

test('parseMapResult разбирает реальный ответ и печатает строки целей', () => {
  const result = parseMapResult(JSON.stringify(MAP_JSON), 0)
  assert.equal(result.error, undefined)
  assert.equal(result.schema, 1)
  assert.deepEqual(result.layers, ['checks', 'commands'])
  assert.equal(result.note, MAP_JSON.note)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(result.rows[0].code, { checks: 0, commands: 0 })
  const lines = result.text.split('\n')
  assert.equal(lines[0], 'карта покрытия: слои — checks, commands; строк — 3')
  assert.equal(lines[1], 'ADR-001 — Изменение форматов и переход между версиями lipi [decision, accepted]: код 0, тесты 0')
  assert.equal(lines[2], 'docs/ru/workflow.md#upgrade — Разложить документы по годам [section]: код 1 (commands 1), тесты 1')
  assert.equal(lines[3], 'src/lipi/i18n.py — i18n [code]: код 2 (checks 2), тесты 3')
  assert.equal(lines[4], MAP_JSON.note)
  assert.equal(lines.length, 5)
})

test('parseMapResult печатает пустую карту с примечанием', () => {
  const result = parseMapResult(JSON.stringify({
    schema: 1,
    layers: [],
    rows: [],
    note: '0 means no links were found.',
  }), 0)
  assert.equal(result.error, undefined)
  assert.equal(result.text, 'карта покрытия: слои — нет слоёв; строк — 0\n0 means no links were found.')
})

test('parseMapResult терпим к новым ключам строк', () => {
  const future = {
    ...MAP_JSON,
    future_top: { nested: true },
    rows: MAP_JSON.rows.map((row) => ({ ...row, future_count: 7 })),
  }
  const result = parseMapResult(JSON.stringify(future), 0)
  assert.equal(result.error, undefined)
  assert.equal(result.rows[0].future_count, 7)
})

test('parseMapResult сообщает о неверных аргументах или настройках', () => {
  const report = {
    schema: 1,
    errors: [{ code: 'C1', file: 'lipi.json', line: 0, subject: '', message: 'ключ «code_layers»: ожидается список' }],
    warnings: [],
    summary: { pages: 0, docs: 0, tags: 0, errors: 1, warnings: 0 },
  }
  const result = parseMapResult(JSON.stringify(report), 2)
  assert.equal(result.error, 'неверные аргументы или настройки')
  assert.equal(result.exitCode, 2)
  assert.match(result.details, /code_layers/)
})

test('parseMapResult сообщает о неизвестном коде возврата', () => {
  const result = parseMapResult('', 3, { stderr: 'boom\n' })
  assert.match(result.error, /lipi map завершился с кодом 3: boom/)
})

test('parseMapResult сообщает о не-JSON ответе', () => {
  const result = parseMapResult('Traceback (most recent call last):\n', 0, { stderr: 'boom' })
  assert.match(result.error, /lipi map вернул не JSON: boom/)
})

test('parseMapResult отвергает неизвестную схему карты', () => {
  const result = parseMapResult(JSON.stringify({ schema: 2, layers: [], rows: [] }), 0)
  assert.match(result.error, /неподдерживаемая схема карты: 2/)
})

test('parseMapResult строг к обязательным полям', () => {
  for (const field of ['schema', 'layers', 'rows']) {
    const broken = { ...MAP_JSON }
    delete broken[field]
    const result = parseMapResult(JSON.stringify(broken), 0)
    assert.match(result.error, /неожиданный ответ lipi map/)
    assert.match(result.error, new RegExp(field))
  }
})

test('lipi_map запускает установленную команду map и отдаёт текст', { skip: !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell' }, async (t) => {
  const fake = createFakeLipi({ stdout: JSON.stringify(MAP_JSON) })
  const root = deployProject()
  t.after(() => {
    fake.remove()
    rmSync(root, { recursive: true, force: true })
  })
  const tool = createMapTool(contextWith(root), CFG)
  const result = await withFakePath(fake.dir, () => tool.execute({}, EXEC))
  assert.equal(result.root, root)
  assert.equal(result.schema, 1)
  assert.deepEqual(result.layers, ['checks', 'commands'])
  assert.equal(result.rows.length, 3)
  assert.match(result.text, /^карта покрытия: слои — checks, commands/)
  assert.deepEqual(fake.arguments(), ['map', '--format', 'json'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('lipi_map сообщает о неразвёрнутом проекте', async (t) => {
  const root = resolve(mkdtempSync(join(tmpdir(), 'lipi-map-bare-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const tool = createMapTool(contextWith(root), CFG)
  const result = await tool.execute({}, EXEC)
  assert.match(result.error, /проект не развёрнут по lipi/)
})

test('lipi_map сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const tool = createMapTool(contextWith(root), cfg)
  const result = await tool.execute({}, EXEC)
  assert.match(result.error, /команда lipi не найдена/)
  assert.match(result.hint, /lipiPath/)
})
