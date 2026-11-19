import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  checkProject,
  parseCheckLine,
  parseSliceLine,
  runDoctorCommand,
  runInitCommand,
  runMapCommand,
  runSliceCommand,
  runLipiCheck,
} from '../src/check-runner.js'
import { ProjectNotDeployedError } from '../src/project.js'
import { canRunFakeLipi, createFakeLipi, withFakePath } from './helpers.mjs'

const CFG = { lipiPath: '', wslDistro: 'Ubuntu', maxItems: 2 }

/** Skip marker for tests that must start the fake command. */
const EXECUTION_SKIP = !canRunFakeLipi && 'на Windows .cmd не запускается spawnSync без shell'

const CHECKER_JSON = JSON.stringify({
  schema: 1,
  version: '1.0.0',
  errors: [
    { code: 'D1', file: 'docs/a.md', subject: 'ссылка', line: 1, message: 'первая' },
    { code: 'D1', file: 'docs/b.md', subject: 'ссылка', line: 2, message: 'вторая' },
    { code: 'D2', file: 'docs/c.md', subject: 'шапка', line: 3, message: 'третья' },
  ],
  warnings: [],
  summary: { pages: 1, docs: 0, tags: 0, errors: 3, warnings: 0 },
})

/** A successful `lipi slice --format json` answer; `future_field` must survive. */
const SLICE_JSON = {
  schema: 1,
  target: {
    target: 'docs/pricing.md#threshold',
    kind: 'anchor',
    title: 'Порог',
    found: 'exact',
  },
  summary: { errors: 0, warnings: 0, concepts: 1, code: 0 },
  blocks: [{ kind: 'excerpt', items: [{ text: 'порог скидки' }], omitted: 0, hint: [] }],
  incomplete: false,
  notes: [],
  checks: { links: 0 },
  future_field: { kept: true },
}
const SLICE_ANSWER = JSON.stringify(SLICE_JSON)

/**
 * The flags `parseSliceLine` returns when the line carries none.
 * @param {object} [overrides] Fields to replace.
 * @returns {{full: boolean, depth: number | undefined, layer: string[], only: string | undefined}} Expected flags.
 */
function defaultFlags(overrides = {}) {
  return { full: false, depth: undefined, layer: [], only: undefined, staged: false, diff: undefined, ...overrides }
}

/**
 * Create a deployed project: `lipi.json` only, no checker file.
 * @param {string} [prefix] Temporary directory name prefix.
 * @returns {string} Absolute project root.
 */
function deployProject(prefix = 'lipi-check-runner-') {
  const root = resolve(mkdtempSync(join(tmpdir(), prefix)))
  mkdirSync(join(root, '.agents', 'lipi'), { recursive: true })
  writeFileSync(join(root, 'lipi.json'), '{"docs": "docs", "workflow": "workflow"}')
  writeFileSync(join(root, '.agents', 'lipi', 'lipi.lock'), '{"lipi": "1.0.1", "files": {}}')
  return root
}

/**
 * Create a temporary directory that is not a lipi project.
 * @param {string} [prefix] Temporary directory name prefix.
 * @returns {string} Absolute directory.
 */
function bareDirectory(prefix = 'lipi-bare-') {
  return resolve(mkdtempSync(join(tmpdir(), prefix)))
}

/**
 * Clean up a fake command and a temporary project after one test.
 * @param {import('node:test').TestContext} t Test context.
 * @param {{remove: () => void}} fake Fake command fixture.
 * @param {string[]} directories Temporary directories to remove.
 */
function cleanup(t, fake, ...directories) {
  t.after(() => {
    fake.remove()
    for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  })
}

test('checkProject запускает установленную команду lipi и разбирает результат', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: CHECKER_JSON })
  const root = deployProject()
  cleanup(t, fake, root)
  const result = await withFakePath(fake.dir, () => checkProject(root, CFG))
  assert.equal(result.root, root)
  assert.equal(result.schema, 1)
  assert.equal(result.version, '1.0.0')
  assert.equal(result.exitCode, 0)
  assert.equal(result.errors.length, 2, 'обрезка до maxItems')
  assert.equal(result.errors[0].code, 'D1')
  assert.deepEqual(result.summary, { pages: 1, docs: 0, tags: 0, errors: 3, warnings: 0 })
  assert.deepEqual(result.errors[0], { code: 'D1', file: 'docs/a.md', subject: 'ссылка', line: 1, message: 'первая' }, 'находки передаются как есть')
  assert.equal(result.truncated, true)
  assert.equal(result.truncatedCount, 1)
  assert.deepEqual(fake.arguments(), ['check', '--format', 'json'])
})

test('checkProject передаёт режим staged команде lipi', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: '{}' })
  const root = deployProject()
  cleanup(t, fake, root)
  await withFakePath(fake.dir, () => checkProject(root, CFG, 'staged'))
  assert.deepEqual(fake.arguments(), ['check', '--format', 'json', '--staged'])
})

test('checkProject сообщает о неразвёрнутом проекте', (t) => {
  const root = bareDirectory()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.throws(() => checkProject(root, CFG), ProjectNotDeployedError)
})

test('runLipiCheck требует путь и возвращает JSON на успех', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: CHECKER_JSON })
  const root = deployProject()
  cleanup(t, fake, root)
  assert.deepEqual(runLipiCheck('', CFG), { kind: 'error', text: 'укажите папку проекта: /lipi-check /путь/к/проекту [--staged|--audit]' })
  const out = await withFakePath(fake.dir, () => runLipiCheck(` ${root} `, CFG))
  assert.equal(out.kind, 'success')
  const parsed = JSON.parse(out.text)
  assert.equal(parsed.root, root)
  assert.equal(parsed.errors.length, 2)
})

test('parseCheckLine разбирает путь и режим', () => {
  assert.deepEqual(parseCheckLine(' /srv/app '), { path: '/srv/app', mode: 'quick' })
  assert.deepEqual(parseCheckLine('/srv/app --staged'), { path: '/srv/app', mode: 'staged' })
  assert.deepEqual(parseCheckLine('/srv/app staged'), { path: '/srv/app', mode: 'staged' })
  assert.deepEqual(parseCheckLine('/srv/app --audit'), { path: '/srv/app', mode: 'audit' })
  assert.deepEqual(parseCheckLine('/srv/app audit'), { path: '/srv/app', mode: 'audit' })
  assert.deepEqual(parseCheckLine('/папка с пробелами --audit'), { path: '/папка с пробелами', mode: 'audit' })
  assert.deepEqual(parseCheckLine(''), { path: '', mode: 'quick' })
})

test('runLipiCheck передаёт режим установленной команде', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: '{}' })
  const root = deployProject()
  cleanup(t, fake, root)
  await withFakePath(fake.dir, () => runLipiCheck(`${root} --staged`, CFG))
  const argv = fake.arguments()
  assert.deepEqual(argv.slice(0, 2), ['check', '--format'])
  assert.ok(argv.includes('json'), argv.join(' '))
  assert.ok(argv.includes('--staged'), argv.join(' '))
})

test('runLipiCheck возвращает ошибку для неразвёрнутого проекта', (t) => {
  const root = bareDirectory()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const out = runLipiCheck(root, CFG)
  assert.equal(out.kind, 'error')
  assert.match(out.text, /проект не развёрнут по lipi/)
})

test('runLipiCheck сообщает об ошибке, когда lipi вернул не JSON', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: 'Traceback (most recent call last):' })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runLipiCheck(root, CFG))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /lipi вернул не JSON/)
})

test('runLipiCheck сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const out = await withFakePath(root, () => runLipiCheck(root, cfg))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /команда lipi не найдена/)
  assert.match(out.text, /pipx install git\+https:\/\/github\.com\/lipisutra\/lipi/)
})

test('checkProject добавляет minLipiHint, когда установленный lipi старше', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: JSON.stringify({
    schema: 1, version: '0.5.0', errors: [], warnings: [],
    summary: { pages: 1, docs: 0, tags: 0, errors: 0, warnings: 0 },
  }) })
  const root = deployProject()
  cleanup(t, fake, root)
  const result = await withFakePath(fake.dir, () => checkProject(root, { ...CFG, minLipi: '1.0.0' }))
  assert.equal(typeof result.minLipiHint, 'string')
  assert.match(result.minLipiHint, /0\.5\.0/)
  assert.match(result.minLipiHint, /1\.0\.0/)
  assert.match(result.minLipiHint, /pipx upgrade lipi/)
})

test('checkProject не добавляет hint при актуальном lipi', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: CHECKER_JSON })
  const root = deployProject()
  cleanup(t, fake, root)
  const result = await withFakePath(fake.dir, () => checkProject(root, { ...CFG, minLipi: '1.0.0' }))
  assert.equal(result.minLipiHint, undefined)
})

test('parseSliceLine разбирает путь, цель и флаги', () => {
  assert.deepEqual(parseSliceLine(' /srv/app docs/a.md '), {
    path: '/srv/app', target: 'docs/a.md', flags: defaultFlags(),
  })
  assert.deepEqual(parseSliceLine('/srv/app docs/a.md --full'), {
    path: '/srv/app', target: 'docs/a.md', flags: defaultFlags({ full: true }),
  })
  assert.deepEqual(parseSliceLine('/srv/app docs/a.md --depth 2'), {
    path: '/srv/app', target: 'docs/a.md', flags: defaultFlags({ depth: 2 }),
  })
  assert.deepEqual(
    parseSliceLine('/srv/app docs/a.md --full --depth 3 --layer domain --layer ui --only signals,excerpt'),
    {
      path: '/srv/app',
      target: 'docs/a.md',
      flags: defaultFlags({ full: true, depth: 3, layer: ['domain', 'ui'], only: 'signals,excerpt' }),
    },
  )
  assert.deepEqual(parseSliceLine('/srv/app docs/a.md --layer domain,ui'), {
    path: '/srv/app', target: 'docs/a.md', flags: defaultFlags({ layer: ['domain', 'ui'] }),
  })
})

test('parseSliceLine снимает кавычки и разэкранирует путь', () => {
  const quoted = parseSliceLine('"/Users/a b/proj" "docs/pricing.md#threshold" --full')
  assert.equal(quoted.path, '/Users/a b/proj')
  assert.equal(quoted.target, 'docs/pricing.md#threshold')
  assert.equal(quoted.flags.full, true)
  assert.equal(parseSliceLine('"/папка \\"цитата\\"/proj" docs/x.md').path, '/папка "цитата"/proj')
  assert.equal(parseSliceLine('"C:\\\\proj\\\\app" docs/x.md').path, 'C:\\proj\\app')
})

test('parseSliceLine оставляет цель с пробелами в одном значении', () => {
  assert.deepEqual(parseSliceLine('/srv/app docs/my page.md'), {
    path: '/srv/app', target: 'docs/my page.md', flags: defaultFlags(),
  })
  assert.deepEqual(parseSliceLine('"/srv/app" "docs/my page.md"'), {
    path: '/srv/app', target: 'docs/my page.md', flags: defaultFlags(),
  })
  assert.equal(parseSliceLine('"/srv/app docs/a.md').path, '/srv/app docs/a.md', 'незакрытая кавычка не ломает разбор')
})

test('parseSliceLine без аргументов даёт пустые путь и цель', () => {
  assert.deepEqual(parseSliceLine(''), { path: '', target: '', flags: defaultFlags() })
  assert.deepEqual(parseSliceLine('/srv/app'), { path: '/srv/app', target: '', flags: defaultFlags() })
})

test('parseSliceLine отвергает неверные флаги', () => {
  assert.throws(() => parseSliceLine('/srv/app docs/a.md --depth 1'), /глубина среза — 2 или 3/)
  assert.throws(() => parseSliceLine('/srv/app docs/a.md --depth'), /флаг --depth требует значение/)
  assert.throws(() => parseSliceLine('/srv/app docs/a.md --layer'), /флаг --layer требует значение/)
  assert.throws(() => parseSliceLine('/srv/app docs/a.md --direction 2'), /неизвестный флаг среза: «--direction»/)
})

test('runSliceCommand требует путь и цель', () => {
  const noPath = runSliceCommand('', CFG)
  assert.equal(noPath.kind, 'error')
  assert.match(noPath.text, /укажите папку проекта: \/lipi-slice/)
  const noTarget = runSliceCommand('/srv/app', CFG)
  assert.equal(noTarget.kind, 'error')
  assert.match(noTarget.text, /укажите цель среза или --staged\/--diff: \/lipi-slice/)
})

test('runSliceCommand запускает lipi slice с целью и флагами', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: SLICE_ANSWER })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runSliceCommand(
    `${root} docs/pricing.md#threshold --full --depth 3 --layer domain --layer ui --only signals,excerpt`,
    CFG,
  ))
  assert.equal(out.kind, 'success')
  assert.deepEqual(JSON.parse(out.text), SLICE_JSON, 'новые поля проходят как есть')
  assert.deepEqual(fake.arguments(), [
    'slice', 'docs/pricing.md#threshold', '--format', 'json',
    '--full', '--depth', '3', '--layer', 'domain', '--layer', 'ui', '--only', 'signals,excerpt',
  ])
  assert.equal(fake.workingDirectory(), realpathSync(root), 'команда запускается в корне проекта')
})

test('runSliceCommand принимает путь и цель в кавычках', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: SLICE_ANSWER })
  const root = deployProject('lipi check runner ')
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runSliceCommand(`"${root}" "docs/my page.md" --only excerpt`, CFG))
  assert.equal(out.kind, 'success')
  assert.deepEqual(fake.arguments(), ['slice', 'docs/my page.md', '--format', 'json', '--only', 'excerpt'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runSliceCommand сообщает о ненайденной цели', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({
    stdout: JSON.stringify({ schema: 1, error: 'not-found', query: 'порог', candidates: [] }),
    exitCode: 1,
  })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runSliceCommand(`${root} порог`, CFG))
  assert.equal(out.kind, 'error')
  assert.equal(out.text, 'цель «порог» не найдена')
})

test('runSliceCommand показывает до пяти кандидатов неоднозначной цели', { skip: EXECUTION_SKIP }, async (t) => {
  const candidates = Array.from({ length: 7 }, (_, index) => ({
    target: `docs/c${index + 1}.md`,
    title: `Кандидат ${index + 1}`,
  }))
  const fake = createFakeLipi({
    stdout: JSON.stringify({ schema: 1, error: 'ambiguous', query: 'порог', candidates }),
    exitCode: 1,
  })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runSliceCommand(`${root} порог`, CFG))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /^цель «порог» неоднозначна: кандидаты: /)
  assert.match(out.text, /docs\/c1\.md — Кандидат 1/)
  assert.match(out.text, /docs\/c5\.md — Кандидат 5/)
  assert.doesNotMatch(out.text, /docs\/c6\.md/)
  assert.doesNotMatch(out.text, /docs\/c7\.md/)
})

test('runSliceCommand сообщает о неверных аргументах или настройках', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stderr: 'error: неизвестный флаг\n', exitCode: 2 })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runSliceCommand(`${root} docs/a.md --full`, CFG))
  assert.equal(out.kind, 'error')
  assert.equal(out.text, 'неверные аргументы или настройки: error: неизвестный флаг')
})

test('runSliceCommand сообщает об ошибке, когда lipi вернул не JSON', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: 'Traceback (most recent call last):' })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runSliceCommand(`${root} docs/a.md`, CFG))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /lipi вернул не JSON/)
})

test('runSliceCommand сообщает о неразвёрнутом проекте', (t) => {
  const root = bareDirectory()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const out = runSliceCommand(`${root} docs/a.md`, CFG)
  assert.equal(out.kind, 'error')
  assert.match(out.text, /проект не развёрнут по lipi/)
})

test('runSliceCommand сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const out = await withFakePath(root, () => runSliceCommand(`${root} docs/a.md`, cfg))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /команда lipi не найдена/)
})

test('runInitCommand запускает lipi init и возвращает хвост вывода', { skip: EXECUTION_SKIP }, async (t) => {
  const lines = Array.from({ length: 25 }, (_, index) => `строка ${index + 1}`)
  const fake = createFakeLipi({ stdout: lines.join('\n') + '\n' })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runInitCommand(`${root}`, CFG))
  assert.equal(out.kind, 'success')
  assert.equal(out.text, lines.slice(5).join('\n'), 'последние 20 строк')
  assert.deepEqual(fake.arguments(), ['init'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runInitCommand принимает путь с пробелами в кавычках', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: 'развёрнут\n' })
  const root = deployProject('lipi check runner ')
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runInitCommand(`"${root}"`, CFG))
  assert.equal(out.kind, 'success')
  assert.equal(out.text, 'развёрнут')
  assert.deepEqual(fake.arguments(), ['init'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runInitCommand работает в неразвёрнутой папке', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: 'каркас создан\n' })
  const root = bareDirectory()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runInitCommand(root, CFG))
  assert.equal(out.kind, 'success')
  assert.equal(out.text, 'каркас создан')
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runInitCommand сводит путь внутри проекта к корню', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: 'обновлён\n' })
  const root = deployProject()
  const nested = join(root, 'docs')
  mkdirSync(nested, { recursive: true })
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runInitCommand(nested, CFG))
  assert.equal(out.kind, 'success')
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runInitCommand возвращает вывод при неуспехе', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: 'нет каталога: /nope\n', exitCode: 2 })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runInitCommand(root, CFG))
  assert.equal(out.kind, 'error')
  assert.equal(out.text, 'нет каталога: /nope')
})

test('runInitCommand требует путь', () => {
  const out = runInitCommand('', CFG)
  assert.equal(out.kind, 'error')
  assert.equal(out.text, 'укажите папку проекта: /lipi-init /путь/к/проекту [--dry-run]')
})

test('runInitCommand сообщает о несуществующей папке', (t) => {
  const root = bareDirectory()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const out = runInitCommand(join(root, 'нет-такой'), CFG)
  assert.equal(out.kind, 'error')
  assert.match(out.text, /папка не найдена/)
})

test('runInitCommand сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const out = await withFakePath(root, () => runInitCommand(root, cfg))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /команда lipi не найдена/)
})

test('runDoctorCommand возвращает полный вывод и не считает проблемы ошибкой', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({
    stdout: 'Python: 3.12.4 — ок\nlipi: 1.0.0 — ок\nитого: проблем 1 — исправьте и запустите снова\n',
    exitCode: 1,
  })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runDoctorCommand(root, CFG))
  assert.equal(out.kind, 'success')
  assert.equal(out.text, 'Python: 3.12.4 — ок\nlipi: 1.0.0 — ок\nитого: проблем 1 — исправьте и запустите снова\n')
  assert.deepEqual(fake.arguments(), ['doctor'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runDoctorCommand работает в неразвёрнутой папке', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: 'проект: lipi не найден (нет lipi.json) — [проблема] запустите lipi init\n', exitCode: 1 })
  const root = bareDirectory()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runDoctorCommand(root, CFG))
  assert.equal(out.kind, 'success')
  assert.match(out.text, /запустите lipi init/)
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runDoctorCommand требует путь', () => {
  const out = runDoctorCommand('', CFG)
  assert.equal(out.kind, 'error')
  assert.equal(out.text, 'укажите папку проекта: /lipi-doctor /путь/к/проекту')
})

test('runDoctorCommand сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const out = await withFakePath(root, () => runDoctorCommand(root, cfg))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /команда lipi не найдена/)
})

/** A successful `lipi map --format json` answer. */
const MAP_JSON = JSON.stringify({
  schema: 1,
  layers: ['checks', 'commands'],
  note: '0 means no links were found. An implementation may still exist.',
  rows: [
    { target: 'ADR-001', title: 'Решение', kind: 'decision', code: { checks: 1, commands: 0 }, tests: 0, status: 'accepted' },
    { target: 'docs/README.md#start', title: 'С чего начать', kind: 'section', code: { checks: 0, commands: 2 }, tests: 1 },
  ],
})

test('runMapCommand требует путь', () => {
  const out = runMapCommand('', CFG)
  assert.equal(out.kind, 'error')
  assert.equal(out.text, 'укажите папку проекта: /lipi-map /путь/к/проекту')
})

test('runMapCommand запускает lipi map и возвращает текст карты', { skip: EXECUTION_SKIP }, async (t) => {
  const fake = createFakeLipi({ stdout: MAP_JSON })
  const root = deployProject()
  cleanup(t, fake, root)
  const out = await withFakePath(fake.dir, () => runMapCommand(`"${root}"`, CFG))
  assert.equal(out.kind, 'success')
  const parsed = JSON.parse(out.text)
  assert.equal(parsed.schema, 1)
  assert.deepEqual(parsed.layers, ['checks', 'commands'])
  assert.equal(parsed.text.split('\n')[0], 'карта покрытия: слои — checks, commands; строк — 2')
  assert.deepEqual(fake.arguments(), ['map', '--format', 'json'])
  assert.equal(fake.workingDirectory(), realpathSync(root))
})

test('runMapCommand сообщает о неразвёрнутом проекте', (t) => {
  const root = bareDirectory()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const out = runMapCommand(root, CFG)
  assert.equal(out.kind, 'error')
  assert.match(out.text, /проект не развёрнут по lipi/)
})

test('runMapCommand сообщает, что команда lipi не найдена', async (t) => {
  const root = deployProject()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const cfg = { ...CFG, lipiPath: join(root, 'no-such-lipi') }
  const out = await withFakePath(root, () => runMapCommand(root, cfg))
  assert.equal(out.kind, 'error')
  assert.match(out.text, /команда lipi не найдена/)
})
